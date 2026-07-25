// vision.js — 画像から点字の点を検出し、マス(セル)に組み立てる
//
// 検出モード:
//   print   : 印刷された点字(暗い点)。適応的二値化 → ブロブ検出
//   print-light: 明るい点(白点字の印刷など)
//   emboss  : 実物の浮き出し点字。斜め光で「点の片側が明るく反対側が暗く」
//             写る性質(点字OCR研究の定石)を使い、ハイライトと影のペアで
//             点を検出する。逆向きペア(両面印刷の裏点)は除外する。
//   auto    : print と emboss を両方試し、解読スコアが高い方を採用
//
// 共通パイプライン:
//   点検出 → 孤立点除去 → ピッチ推定 → 傾き推定・回転補正
//   → 行・セル格子当てはめ → 6点位置サンプリングで点の有無を確定 → 解読

"use strict";

// ---- 二値化 ----
function toBinary(imageData, { threshC = 12, invert = false } = {}) {
  const { width: w, height: h, data } = imageData;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
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
    blobs.push({ x: sx / area, y: sy / area, area, bw: maxX - minX + 1, bh: maxY - minY + 1 });
  }
  return blobs;
}

function filterDotBlobs(blobs, w, h) {
  const maxDim = Math.max(6, w * 0.05);
  let dots = blobs.filter((b) => {
    if (b.area < 5) return false;
    if (b.bw > maxDim || b.bh > maxDim) return false;
    const aspect = b.bw / b.bh;
    if (aspect < 0.3 || aspect > 3.2) return false;
    return b.area / (b.bw * b.bh) > 0.3;
  });
  if (dots.length < 4) return dots;

  // サイズ分布を確認。点字一覧表のように「空き位置の小点 + 実点の大点」の
  // 2群に分かれる場合は両群とも残す(格子推定に使い、点の有無は後段の
  // サンプリングで大きさから判定する)。単峰なら中央値まわりだけ残す。
  const sizes = dots.map((b) => Math.max(b.bw, b.bh)).sort((a, b) => a - b);
  const med = sizes[sizes.length >> 1];
  let splitIdx = -1, bestRatio = 1.7;
  for (let i = Math.ceil(sizes.length * 0.2); i <= Math.floor(sizes.length * 0.85); i++) {
    const ratio = sizes[i] / Math.max(1, sizes[i - 1]);
    if (ratio > bestRatio) { bestRatio = ratio; splitIdx = i; }
  }
  let lo, hi;
  if (splitIdx > 0) {
    const smallMed = sizes[splitIdx >> 1];
    const bigMed = sizes[(splitIdx + sizes.length) >> 1];
    lo = smallMed * 0.4;
    hi = bigMed * 2.2;
  } else {
    lo = med * 0.4;
    hi = med * 2.2;
  }
  return dots.filter((b) => {
    const s = Math.max(b.bw, b.bh);
    return s > lo && s < hi;
  });
}

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

// 傾き推定: 近接点ペアの角度を90°周期で折りたたんで中央値
function estimateRotation(dots, pitch) {
  const angles = [];
  const HALF_PI = Math.PI / 2;
  for (let i = 0; i < dots.length; i++) {
    for (let j = i + 1; j < dots.length; j++) {
      const dx = dots[j].x - dots[i].x, dy = dots[j].y - dots[i].y;
      const dist = Math.hypot(dx, dy);
      if (dist < pitch * 0.6 || dist > pitch * 1.45) continue;
      let ang = Math.atan2(dy, dx);
      ang = ((ang % HALF_PI) + HALF_PI) % HALF_PI;
      if (ang > Math.PI / 4) ang -= HALF_PI;
      angles.push(ang);
    }
  }
  if (angles.length < 4) return 0;
  return median(angles);
}

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

// ---- カバレッジ(円板内の前景率)ヘルパ ----
function makeBinCoverage(bin, w, h) {
  return (ox, oy, r) => {
    const ri = Math.ceil(r);
    let fg = 0, n = 0;
    for (let dy = -ri; dy <= ri; dy++) {
      for (let dx = -ri; dx <= ri; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const px = Math.round(ox + dx), py = Math.round(oy + dy);
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        n++;
        fg += bin[py * w + px];
      }
    }
    return n ? fg / n : 0;
  };
}

// ---- 印刷点字: 単純なブロブ検出 ----
function detectPrintDots(imageData, opts, invert) {
  const { width: w, height: h } = imageData;
  const bin = toBinary(imageData, { threshC: opts.threshC, invert });
  const dots = filterDotBlobs(findBlobs(bin, w, h), w, h);
  return { dots, coverage: makeBinCoverage(bin, w, h), kind: invert ? "print-light" : "print" };
}

// ---- 浮き出し点字: ハイライト+影のペア検出 ----
function detectEmbossDots(imageData, opts) {
  const { width: w, height: h } = imageData;
  const brightBin = toBinary(imageData, { threshC: opts.threshC, invert: true });
  const darkBin = toBinary(imageData, { threshC: opts.threshC, invert: false });
  const brights = filterDotBlobs(findBlobs(brightBin, w, h), w, h);
  const darks = filterDotBlobs(findBlobs(darkBin, w, h), w, h);
  if (brights.length < 4 || darks.length < 4) return null;

  const ms = median(brights.map((b) => Math.max(b.bw, b.bh)));
  const maxD = ms * 2.6;

  // 各ハイライトに最近傍の影を対応付け
  const rawPairs = [];
  for (const b of brights) {
    let best = null;
    for (const d of darks) {
      const dist = Math.hypot(d.x - b.x, d.y - b.y);
      if (dist < maxD && (!best || dist < best.dist)) best = { b, d, dist };
    }
    if (best) rawPairs.push(best);
  }
  if (rawPairs.length < 4) return null;

  // 支配的なペア方向 = 照明の向き。方向がバラバラなら浮き出しではない
  let sx = 0, sy = 0;
  for (const p of rawPairs) {
    sx += (p.d.x - p.b.x) / p.dist;
    sy += (p.d.y - p.b.y) / p.dist;
  }
  const norm = Math.hypot(sx, sy);
  if (norm < rawPairs.length * 0.45) return null;
  const ux = sx / norm, uy = sy / norm;

  // 支配方向に沿ったペアだけ採用(逆向き = 裏点は除外)。点中心はペアの中点
  const dots = [];
  const pairDists = [];
  for (const p of rawPairs) {
    const vx = p.d.x - p.b.x, vy = p.d.y - p.b.y;
    if ((vx * ux + vy * uy) / p.dist < 0.6) continue;
    dots.push({
      x: (p.b.x + p.d.x) / 2, y: (p.b.y + p.d.y) / 2,
      area: p.b.area, bw: p.b.bw, bh: p.b.bh,
    });
    pairDists.push(p.dist);
  }
  if (dots.length < 4) return null;

  const pd = median(pairDists);
  const vx = ux * pd / 2, vy = uy * pd / 2;
  const bCov = makeBinCoverage(brightBin, w, h);
  const dCov = makeBinCoverage(darkBin, w, h);
  // 点中心の座標から、ハイライト側と影側の両方に前景があるかを見る
  const coverage = (ox, oy, r) => Math.min(bCov(ox - vx, oy - vy, r), dCov(ox + vx, oy + vy, r));
  return { dots, coverage, kind: "emboss" };
}

// ---- 1つの連続区間(run)を格子に当てはめる(左右列パリティは両方試して良い方) ----
function fitRun(colClusters, rowIndexOf, pitch, cellPitch) {
  const d = pitch, D = cellPitch;
  const results = [];
  for (const parity of [0, 1]) {
    const x0 = colClusters[0].mean - (parity === 1 ? d : 0);
    const cells = new Map();
    let fitErr = 0;
    for (const col of colClusters) {
      const rel = col.mean - x0;
      const cGuess = Math.round(rel / D);
      let best = null;
      for (let c = Math.max(0, cGuess - 2); c <= cGuess + 2; c++) {
        for (let side = 0; side <= 1; side++) {
          const err = Math.abs(rel - (c * D + side * d));
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
        cell.mask |= 1 << ((best.side === 0 ? row + 1 : row + 4) - 1);
        cell.dots.push(dot);
      }
    }
    results.push({ cells, fitErr });
  }
  const scored = results.map((r) => {
    const masks = cellListToMasks(r.cells, D);
    const { perCell } = window.Braille.decodeCells(masks.map((c) => c.mask));
    let valid = 0, unknown = 0;
    for (const pc of perCell) {
      if (pc.label === "?" ) unknown++;
      else if (pc.label && pc.label !== "␣") valid++;
    }
    return { score: valid - 2 * unknown - 3 * r.fitErr, masks, fitErr: r.fitErr };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0];
}

// ---- 1行のセル組み立て ----
// 格子間隔として説明できない隙間(表のグループ間余白など)が出たら、
// そこで格子を仕切り直して空白マスを挟む。
function buildCellsForLine(lineDots, rowIndexOf, pitch, cellPitch) {
  const colClusters = cluster1d(lineDots.map((d) => ({ v: d.rx, d })), pitch * 0.45);
  if (!colClusters.length) return { cells: [], fitErrAvg: 9 };
  const d = pitch, D = cellPitch;
  // 連続した列同士として説明できる間隔(セル内 d、セル間 D-d、空列・空マスを含む)
  const gapCands = [d, D - d, D, D + d];
  const runs = [];
  let current = [colClusters[0]];
  for (let i = 1; i < colClusters.length; i++) {
    const gap = colClusters[i].mean - colClusters[i - 1].mean;
    const err = Math.min(...gapCands.map((g) => Math.abs(gap - g)));
    // 大きな隙間(語間・グループ間)や格子で説明できない間隔では仕切り直す。
    // 仕切り直しは「空白マス+独立の格子当てはめ」なので、連続していた場合も壊さない
    if (gap > D * 1.6 || err > d * 0.35) { runs.push(current); current = []; }
    current.push(colClusters[i]);
  }
  runs.push(current);

  const cells = [];
  let totalErr = 0, totalCols = 0;
  for (const run of runs) {
    const fit = fitRun(run, rowIndexOf, pitch, cellPitch);
    if (cells.length && fit.masks.length) cells.push({ mask: 0, x: null, dots: [] });
    cells.push(...fit.masks);
    totalErr += fit.fitErr;
    totalCols += run.length;
  }
  return { cells, fitErrAvg: totalCols ? totalErr / totalCols : 9 };
}

function cellListToMasks(cellsMap, D) {
  const idxs = [...cellsMap.keys()].sort((a, b) => a - b);
  if (!idxs.length) return [];
  const out = [];
  let prev = null;
  for (const idx of idxs) {
    if (prev != null) {
      const gap = idx - prev - 1;
      const prevX = cellsMap.get(prev).x;
      for (let k = 0; k < Math.min(gap, 2); k++) {
        out.push({ mask: 0, x: prevX + (k + 1) * D, dots: [] });
      }
    }
    out.push(cellsMap.get(idx));
    prev = idx;
  }
  return out;
}

// ---- 6点サンプリング: 格子位置ごとに点の有無を判定し直す ----
// 「6点のうちどこが目立っているか」を行内の相対比較で決めるのが肝。
function refineCellMasks(lines, coverage, pitch, rot) {
  const r = Math.max(1.5, pitch * 0.32);
  const cov = (gx, gy) => {
    const ox = (gx - rot.cx) * rot.cosT - (gy - rot.cy) * rot.sinT + rot.cx;
    const oy = (gx - rot.cx) * rot.sinT + (gy - rot.cy) * rot.cosT + rot.cy;
    return coverage(ox, oy, r);
  };
  for (const line of lines) {
    const samples = [];
    for (const cell of line.cells) {
      if (cell.x == null) continue;
      for (let side = 0; side <= 1; side++) {
        for (let row = 0; row < 3; row++) {
          samples.push({ cell, bit: side * 3 + row, cov: cov(cell.x + side * pitch, line.rowYs[row]) });
        }
      }
    }
    if (!samples.length) continue;
    const cMax = Math.max(...samples.map((s) => s.cov));
    for (const cell of line.cells) if (cell.x != null) cell.mask = 0;
    if (cMax < 0.15) continue;
    const th = Math.max(0.12, cMax * 0.4);
    for (const s of samples) if (s.cov >= th) s.cell.mask |= 1 << s.bit;
  }
}

// ---- 共通パイプライン ----
function runPipeline(det, w, h) {
  const empty = { dots: det.dots, lines: [], pitch: 0, theta: 0, cx: w / 2, cy: h / 2, text: "", score: 0, kind: det.kind };
  let dots = det.dots;
  if (dots.length < 4) return empty;

  let nn = nearestNeighborDists(dots);
  const nnMed = median(nn);
  dots = dots.filter((_, i) => nn[i] <= nnMed * 2.6);
  if (dots.length < 4) return empty;
  nn = nearestNeighborDists(dots);
  const pitch = median(nn);
  if (!pitch || pitch < 3) return empty;

  const theta = estimateRotation(dots, pitch);
  const cx = w / 2, cy = h / 2;
  const cosT = Math.cos(theta), sinT = Math.sin(theta);
  for (const d of dots) {
    d.rx = (d.x - cx) * cosT + (d.y - cy) * sinT + cx;
    d.ry = -(d.x - cx) * sinT + (d.y - cy) * cosT + cy;
  }

  const rowClusters = cluster1d(dots.map((d) => ({ v: d.ry, d })), pitch * 0.45);
  const lineGroups = [];
  for (const rc of rowClusters) {
    const last = lineGroups[lineGroups.length - 1];
    if (last && rc.mean - last.rows[last.rows.length - 1].mean <= pitch * 1.7 && last.rows.length < 3) {
      last.rows.push(rc);
    } else {
      lineGroups.push({ rows: [rc] });
    }
  }

  const xs = dots.map((d) => d.rx).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < xs.length; i++) {
    const g = xs[i] - xs[i - 1];
    if (g > pitch * 1.25 && g < pitch * 2.6) gaps.push(g);
  }
  const interGap = gaps.length ? median(gaps) : pitch * 1.45;
  const cellPitch = interGap + pitch;

  const lines = [];
  for (const lg of lineGroups) {
    const rowIndexOf = new Map();
    const n = lg.rows.length;
    let rowIdxs;
    if (n === 3) rowIdxs = [0, 1, 2];
    else if (n === 2) {
      rowIdxs = lg.rows[1].mean - lg.rows[0].mean > pitch * 1.55 ? [0, 2] : [0, 1];
    } else rowIdxs = [0];
    lg.rows.forEach((rc, i) => {
      for (const { d } of rc.items) rowIndexOf.set(d, rowIdxs[i]);
    });
    const lineDots = lg.rows.flatMap((rc) => rc.items.map((it) => it.d));
    const { cells, fitErrAvg } = buildCellsForLine(lineDots, rowIndexOf, pitch, cellPitch);
    if (cells.length) {
      const rowYs = [null, null, null];
      lg.rows.forEach((rc, i) => { rowYs[rowIdxs[i]] = rc.mean; });
      if (rowYs[1] == null) rowYs[1] = rowYs[2] != null ? (rowYs[0] + rowYs[2]) / 2 : rowYs[0] + pitch;
      if (rowYs[2] == null) rowYs[2] = rowYs[1] + pitch;
      // 点行の間隔がピッチ(または2ピッチ)に合っているか = 点字の行らしさ
      let rowSpacErr = 0;
      for (let i = 1; i < lg.rows.length; i++) {
        const gap = lg.rows[i].mean - lg.rows[i - 1].mean;
        rowSpacErr = Math.max(rowSpacErr, Math.min(Math.abs(gap - pitch), Math.abs(gap - 2 * pitch)) / pitch);
      }
      lines.push({
        y: rowYs[0], cells, rowYs, fitErrAvg,
        nRows: lg.rows.length, rowSpacErr,
        top: rowYs[0] - pitch * 0.7, bottom: rowYs[2] + pitch * 0.7,
      });
    }
  }

  refineCellMasks(lines, det.coverage, pitch, { cosT, sinT, cx, cy });

  // 解読と品質ゲート(解読率60%未満の行はノイズとして捨てる)
  const accepted = [];
  const texts = [];
  let score = 0;
  for (const line of lines) {
    const { text, perCell } = window.Braille.decodeCells(line.cells.map((c) => c.mask));
    line.cells.forEach((c, i) => { c.label = perCell[i] ? perCell[i].label : ""; });
    let valid = 0, total = 0;
    for (const pc of perCell) {
      if (!pc.label || pc.label === "␣") continue;
      total++;
      if (!pc.label.startsWith("?")) valid++;
    }
    // 解読率が低い行、格子への当てはめ誤差が大きい行、点字の行構造
    // (点行2段以上・行間隔がピッチに一致)を持たない行はノイズとして捨てる
    if (total >= 2 && valid / total >= 0.6 && line.fitErrAvg <= 0.3 &&
        line.nRows >= 2 && line.rowSpacErr <= 0.3) {
      accepted.push(line);
      texts.push(text);
      score += valid;
    }
  }
  return { dots, lines: accepted, pitch, cellPitch, theta, cx, cy, text: texts.join("\n"), score, kind: det.kind };
}

// ---- メイン ----
function detectBraille(imageData, opts = {}) {
  const { width: w, height: h } = imageData;
  const mode = opts.mode || "auto";
  const candidates = [];
  if (mode === "print" || mode === "auto") candidates.push(detectPrintDots(imageData, opts, false));
  if (mode === "print-light") candidates.push(detectPrintDots(imageData, opts, true));
  if (mode === "emboss" || mode === "auto") {
    const e = detectEmbossDots(imageData, opts);
    if (e) candidates.push(e);
  }
  let best = null, bestEmboss = null;
  for (const det of candidates) {
    const r = runPipeline(det, w, h);
    if (!best || r.score > best.score) best = r;
    if (r.kind === "emboss" && (!bestEmboss || r.score > bestEmboss.score)) bestEmboss = r;
  }
  // 明暗ペアの整合が取れた=浮き出し点字の強い証拠。影だけを「印刷の点」と
  // 誤解した候補が同点程度で勝つのを防ぐため、僅差ならエンボスを優先する。
  if (bestEmboss && best && bestEmboss.score >= best.score * 0.8) best = bestEmboss;
  return best || { dots: [], lines: [], pitch: 0, theta: 0, cx: w / 2, cy: h / 2, text: "", score: 0, kind: mode };
}

window.Vision = { detectBraille };
