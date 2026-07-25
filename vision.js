// vision.js — 画像から点字の点を検出し、マス(セル)に組み立てる
//
// パイプライン:
//   1. グレースケール化
//   2. 適応的二値化(局所平均との差)
//   3. 連結成分ラベリング → 点候補(ブロブ)抽出
//   4. 点間ピッチ推定 → 行・列クラスタリング → セル格子への当てはめ
//   5. 各セルの6点パターン(マスク)を出力

"use strict";

// ---- 二値化 ----
function toBinary(imageData, { threshC = 12, invert = false } = {}) {
  const { width: w, height: h, data } = imageData;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  // 積分画像で局所平均を高速計算
  const integ = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += gray[y * w + x];
      integ[(y + 1) * (w + 1) + (x + 1)] = integ[y * (w + 1) + (x + 1)] + rowSum;
    }
  }
  const win = Math.max(15, Math.floor(w / 16)) | 1;
  const r = win >> 1;
  const bin = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum = integ[(y1 + 1) * (w + 1) + (x1 + 1)] - integ[y0 * (w + 1) + (x1 + 1)]
                - integ[(y1 + 1) * (w + 1) + x0] + integ[y0 * (w + 1) + x0];
      const mean = sum / area;
      const v = gray[y * w + x];
      const fg = invert ? v > mean + threshC : v < mean - threshC;
      if (fg) bin[y * w + x] = 1;
    }
  }
  return bin;
}

// ---- 連結成分 → ブロブ ----
function findBlobs(bin, w, h) {
  const labels = new Int32Array(w * h);
  const blobs = [];
  const stack = [];
  let nextLabel = 0;
  for (let start = 0; start < w * h; start++) {
    if (!bin[start] || labels[start]) continue;
    nextLabel++;
    let area = 0, sx = 0, sy = 0;
    let minX = w, maxX = 0, minY = h, maxY = 0;
    stack.length = 0;
    stack.push(start);
    labels[start] = nextLabel;
    while (stack.length) {
      const p = stack.pop();
      const px = p % w, py = (p / w) | 0;
      area++; sx += px; sy += py;
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
      if (px > 0 && bin[p - 1] && !labels[p - 1]) { labels[p - 1] = nextLabel; stack.push(p - 1); }
      if (px < w - 1 && bin[p + 1] && !labels[p + 1]) { labels[p + 1] = nextLabel; stack.push(p + 1); }
      if (py > 0 && bin[p - w] && !labels[p - w]) { labels[p - w] = nextLabel; stack.push(p - w); }
      if (py < h - 1 && bin[p + w] && !labels[p + w]) { labels[p + w] = nextLabel; stack.push(p + w); }
    }
    blobs.push({
      x: sx / area, y: sy / area, area,
      bw: maxX - minX + 1, bh: maxY - minY + 1,
    });
  }
  return blobs;
}

// 点らしい形のブロブだけ残す
function filterDotBlobs(blobs, w, h) {
  const maxDim = Math.max(6, w * 0.05);
  let dots = blobs.filter((b) => {
    if (b.area < 5) return false;
    if (b.bw > maxDim || b.bh > maxDim) return false;
    const aspect = b.bw / b.bh;
    if (aspect < 0.35 || aspect > 2.8) return false;
    const fill = b.area / (b.bw * b.bh);
    return fill > 0.35;
  });
  if (dots.length < 4) return dots;
  // サイズの中央値から大きく外れるものを除去(ノイズ・文字など)
  const sizes = dots.map((b) => Math.max(b.bw, b.bh)).sort((a, b) => a - b);
  const medSize = sizes[sizes.length >> 1];
  dots = dots.filter((b) => {
    const s = Math.max(b.bw, b.bh);
    return s > medSize * 0.4 && s < medSize * 2.2;
  });
  return dots;
}

// 各点の最近傍距離
function nearestNeighborDists(dots) {
  return dots.map((a) => {
    let best = Infinity;
    for (const b of dots) {
      if (a === b) continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < best) best = d;
    }
    return best;
  });
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[s.length >> 1];
}

// 傾き推定: 近接する点同士のベクトル角度を90°周期で折りたたみ、中央値をとる。
// 点字の格子は水平・垂直に並ぶため、±45°以内の傾きを検出できる。
function estimateRotation(dots, pitch) {
  const angles = [];
  const HALF_PI = Math.PI / 2;
  for (let i = 0; i < dots.length; i++) {
    for (let j = i + 1; j < dots.length; j++) {
      const dx = dots[j].x - dots[i].x, dy = dots[j].y - dots[i].y;
      const dist = Math.hypot(dx, dy);
      if (dist < pitch * 0.6 || dist > pitch * 1.45) continue;
      let ang = Math.atan2(dy, dx);
      ang = ((ang % HALF_PI) + HALF_PI) % HALF_PI; // [0, 90°)
      if (ang > Math.PI / 4) ang -= HALF_PI;       // [-45°, 45°)
      angles.push(ang);
    }
  }
  if (angles.length < 4) return 0;
  return median(angles);
}

// 座標値を許容差 tol でクラスタリング(1次元)
function cluster1d(values, tol) {
  const sorted = [...values].sort((a, b) => a.v - b.v);
  const clusters = [];
  for (const item of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && item.v - last.mean <= tol) {
      last.items.push(item);
      last.mean = last.items.reduce((s, it) => s + it.v, 0) / last.items.length;
    } else {
      clusters.push({ mean: item.v, items: [item] });
    }
  }
  return clusters;
}

// 1行(最大3点行)の点集合をセル列に組み立てる
function buildCellsForLine(lineDots, rowIndexOf, pitch, cellPitch) {
  // 列クラスタリング(傾き補正済み座標を使う)
  const colClusters = cluster1d(lineDots.map((d) => ({ v: d.rx, d })), pitch * 0.45);
  if (!colClusters.length) return [];

  // 列を格子(セル番号+左右)に割り当てる。最初の列が左列か右列か(パリティ)は
  // 両方試して、解読できる文字が多い方を採用する。
  const d = pitch, D = cellPitch;
  const results = [];
  for (const parity of [0, 1]) {
    const x0 = colClusters[0].mean - (parity === 1 ? d : 0);
    const cells = new Map(); // cellIdx -> {mask, dots:[], x}
    let fitErr = 0; // 格子への当てはめ誤差の合計(ピッチ単位)
    for (const col of colClusters) {
      const rel = col.mean - x0;
      // 候補の格子位置から最も近いものを選ぶ
      const cGuess = Math.round(rel / D);
      let best = null;
      for (let c = Math.max(0, cGuess - 2); c <= cGuess + 2; c++) {
        for (let side = 0; side <= 1; side++) {
          const gx = c * D + side * d;
          const err = Math.abs(rel - gx);
          if (!best || err < best.err) best = { c, side, err };
        }
      }
      if (!best) continue;
      fitErr += best.err / d;
      if (!cells.has(best.c)) cells.set(best.c, { mask: 0, dots: [], x: x0 + best.c * D });
      const cell = cells.get(best.c);
      for (const { d: dot } of col.items) {
        const row = rowIndexOf.get(dot);
        if (row == null) continue;
        const dotNum = best.side === 0 ? row + 1 : row + 4;
        cell.mask |= 1 << (dotNum - 1);
        cell.dots.push(dot);
      }
    }
    results.push({ parity, cells, fitErr });
  }

  // 各パリティを「格子の当てはめ誤差 + 解読できた文字数」で比較。
  // 誤ったパリティでは列が斜めに吸着して誤差が大きくなるため、これが決定打になる。
  const scored = results.map((r) => {
    const masks = cellListToMasks(r.cells);
    const { perCell } = window.Braille.decodeCells(masks.map((c) => c.mask));
    let valid = 0, unknown = 0;
    for (const pc of perCell) {
      if (pc.label === "?") unknown++;
      else if (pc.label && pc.label !== "␣") valid++;
    }
    const score = valid - 2 * unknown - 3 * r.fitErr;
    return { r, score, masks };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].masks;
}

// cells Map → 空白マスを補完したセル配列
function cellListToMasks(cellsMap) {
  const idxs = [...cellsMap.keys()].sort((a, b) => a - b);
  if (!idxs.length) return [];
  const out = [];
  let prev = null;
  for (const idx of idxs) {
    if (prev != null) {
      const gap = idx - prev - 1;
      for (let k = 0; k < Math.min(gap, 2); k++) out.push({ mask: 0, x: null, dots: [] });
    }
    out.push(cellsMap.get(idx));
    prev = idx;
  }
  return out;
}

// メイン: ImageData → 検出結果
function detectBraille(imageData, opts = {}) {
  const { width: w, height: h } = imageData;
  const bin = toBinary(imageData, opts);
  const allBlobs = findBlobs(bin, w, h);
  let dots = filterDotBlobs(allBlobs, w, h);
  const empty = { dots, lines: [], pitch: 0, theta: 0, cx: w / 2, cy: h / 2, text: "" };
  if (dots.length < 4) return empty;

  // --- 孤立点(ノイズ)の除去: 最近傍距離が飛び抜けている点を捨てる ---
  let nn = nearestNeighborDists(dots);
  const nnMed = median(nn);
  dots = dots.filter((_, i) => nn[i] <= nnMed * 2.6);
  if (dots.length < 4) return empty;
  nn = nearestNeighborDists(dots);
  const pitch = median(nn);
  if (!pitch || pitch < 3) return empty;

  // --- 傾き補正: 推定角度で座標を回転してから格子に当てはめる ---
  const theta = estimateRotation(dots, pitch);
  const cx = w / 2, cy = h / 2;
  const cosT = Math.cos(theta), sinT = Math.sin(theta);
  for (const d of dots) {
    d.rx = (d.x - cx) * cosT + (d.y - cy) * sinT + cx;
    d.ry = -(d.x - cx) * sinT + (d.y - cy) * cosT + cy;
  }

  // --- 行クラスタリング(点の行)---
  const rowClusters = cluster1d(dots.map((d) => ({ v: d.ry, d })), pitch * 0.45);

  // --- 点行を「行(3点行のまとまり)」にグループ化 ---
  const lineGroups = [];
  for (const rc of rowClusters) {
    const last = lineGroups[lineGroups.length - 1];
    if (last && rc.mean - last.rows[last.rows.length - 1].mean <= pitch * 1.7 && last.rows.length < 3) {
      last.rows.push(rc);
    } else {
      lineGroups.push({ rows: [rc] });
    }
  }

  // --- セル間ピッチ(横方向)の推定 ---
  const xs = dots.map((d) => d.rx).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < xs.length; i++) {
    const g = xs[i] - xs[i - 1];
    if (g > pitch * 1.25 && g < pitch * 2.6) gaps.push(g);
  }
  gaps.sort((a, b) => a - b);
  const interGap = gaps.length ? gaps[gaps.length >> 1] : pitch * 1.45;
  const cellPitch = interGap + pitch;

  // --- 各行のセル組み立てと行内の点→行番号の対応 ---
  const lines = [];
  for (const lg of lineGroups) {
    const rowIndexOf = new Map();
    const n = lg.rows.length;
    let rowIdxs;
    if (n === 3) rowIdxs = [0, 1, 2];
    else if (n === 2) {
      const gap = lg.rows[1].mean - lg.rows[0].mean;
      rowIdxs = gap > pitch * 1.55 ? [0, 2] : [0, 1];
    } else rowIdxs = [0];
    lg.rows.forEach((rc, i) => {
      for (const { d } of rc.items) rowIndexOf.set(d, rowIdxs[i]);
    });
    const lineDots = lg.rows.flatMap((rc) => rc.items.map((it) => it.d));
    const cells = buildCellsForLine(lineDots, rowIndexOf, pitch, cellPitch);
    if (cells.length) {
      lines.push({
        y: lg.rows[0].mean,
        cells,
        top: lg.rows[0].mean - pitch * 0.7,
        bottom: lg.rows[lg.rows.length - 1].mean + pitch * 0.7,
      });
    }
  }

  // --- 解読と品質ゲート ---
  // 解読できたマスの割合が低い「行」はノイズとみなして出力しない。
  const accepted = [];
  const texts = [];
  for (const line of lines) {
    const { text, perCell } = window.Braille.decodeCells(line.cells.map((c) => c.mask));
    line.cells.forEach((c, i) => { c.label = perCell[i] ? perCell[i].label : ""; });
    let valid = 0, total = 0;
    for (const pc of perCell) {
      if (!pc.label || pc.label === "␣") continue;
      total++;
      if (!pc.label.startsWith("?")) valid++;
    }
    if (total >= 2 && valid / total >= 0.6) {
      accepted.push(line);
      texts.push(text);
    }
  }

  return { dots, lines: accepted, pitch, cellPitch, theta, cx, cy, text: texts.join("\n") };
}

window.Vision = { detectBraille };
