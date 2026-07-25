// app.js — UI・カメラ・デモ画像生成
"use strict";

const $ = (id) => document.getElementById(id);

const state = {
  mode: "demo",        // demo | camera | upload
  stream: null,
  timer: null,
  sourceCanvas: document.createElement("canvas"), // 解析対象の元画像
};

// ---- 解析と描画 ----
function analyze() {
  const src = state.sourceCanvas;
  if (!src.width || !src.height) return;
  const ctx = src.getContext("2d", { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, src.width, src.height);

  const t0 = performance.now();
  const result = window.Vision.detectBraille(imageData, {
    threshC: Number($("thresh").value),
    invert: $("invert").checked,
  });
  const ms = (performance.now() - t0).toFixed(0);

  drawOverlay(result);
  $("output").textContent = result.text || "(点字を検出できませんでした)";
  $("stats").textContent =
    `点: ${result.dots.length} / 行: ${result.lines.length} / 処理時間: ${ms}ms` +
    (result.pitch ? ` / ピッチ: ${result.pitch.toFixed(1)}px` : "");
}

function drawOverlay(result) {
  const src = state.sourceCanvas;
  const view = $("view");
  const maxW = view.parentElement.clientWidth || 640;
  const scale = Math.min(1.5, maxW / src.width);
  view.width = Math.round(src.width * scale);
  view.height = Math.round(src.height * scale);
  const ctx = view.getContext("2d");
  ctx.drawImage(src, 0, 0, view.width, view.height);

  // 検出した点
  ctx.strokeStyle = "rgba(0,200,80,0.9)";
  ctx.lineWidth = 1.5;
  for (const d of result.dots) {
    ctx.beginPath();
    ctx.arc(d.x * scale, d.y * scale, Math.max(3, result.pitch * 0.3) * scale, 0, Math.PI * 2);
    ctx.stroke();
  }
  // セル枠と読み(格子は傾き補正済み座標なので、逆回転して元画像に重ねる)
  ctx.save();
  ctx.translate(result.cx * scale, result.cy * scale);
  ctx.rotate(result.theta || 0);
  ctx.translate(-result.cx * scale, -result.cy * scale);
  ctx.font = `${Math.max(11, result.pitch * 1.1 * scale)}px sans-serif`;
  ctx.textAlign = "center";
  for (const line of result.lines) {
    for (const cell of line.cells) {
      if (cell.x == null) continue;
      const x = cell.x * scale, d = result.pitch * scale;
      const w = d * 2, top = line.top * scale, hgt = (line.bottom - line.top) * scale;
      ctx.strokeStyle = "rgba(30,120,255,0.5)";
      ctx.strokeRect(x - d * 0.6, top, w, hgt);
      if (cell.label && cell.label !== "␣") {
        ctx.fillStyle = "rgba(220,40,40,0.95)";
        ctx.fillText(cell.label, x + d * 0.4, top - 3);
      }
    }
  }
  ctx.restore();
}

// ---- デモ: テキスト → 点字画像 ----
function renderDemoImage(text) {
  const lines = window.Braille.encodeText(text);
  const d = 9;              // 点間隔(px)
  const D = Math.round(d * 2.45); // セル間隔
  const lineH = d * 2 + Math.round(d * 2.2); // 3点行 + 行間
  const margin = 30;
  const maxCells = Math.max(1, ...lines.map((l) => l.length));
  const w = margin * 2 + maxCells * D;
  const h = margin * 2 + lines.length * lineH;

  const c = state.sourceCanvas;
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#f5f2ea";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#333";
  lines.forEach((masks, li) => {
    masks.forEach((mask, ci) => {
      for (let dot = 0; dot < 6; dot++) {
        if (!(mask & (1 << dot))) continue;
        const side = dot < 3 ? 0 : 1;
        const row = dot % 3;
        const x = margin + ci * D + side * d;
        const y = margin + li * lineH + row * d;
        ctx.beginPath();
        ctx.arc(x, y, d * 0.32, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  });
}

// ---- カメラ ----
async function startCamera() {
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 } },
      audio: false,
    });
  } catch (e) {
    $("output").textContent = "カメラを起動できませんでした: " + e.message;
    return;
  }
  const video = $("video");
  video.srcObject = state.stream;
  await video.play();
  const grab = () => {
    if (!state.stream) return;
    const c = state.sourceCanvas;
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw) return;
    const scale = Math.min(1, 800 / vw);
    c.width = Math.round(vw * scale);
    c.height = Math.round(vh * scale);
    c.getContext("2d").drawImage(video, 0, 0, c.width, c.height);
    analyze();
  };
  state.timer = setInterval(grab, 600);
}

function stopCamera() {
  if (state.timer) { clearInterval(state.timer); state.timer = null; }
  if (state.stream) {
    for (const t of state.stream.getTracks()) t.stop();
    state.stream = null;
  }
}

// ---- 画像アップロード ----
function loadImageFile(file) {
  const img = new Image();
  img.onload = () => {
    const c = state.sourceCanvas;
    const scale = Math.min(1, 1000 / img.width);
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    analyze();
    URL.revokeObjectURL(img.src);
  };
  img.src = URL.createObjectURL(file);
}

// ---- モード切替 ----
function setMode(mode) {
  state.mode = mode;
  stopCamera();
  for (const b of document.querySelectorAll(".tab")) {
    b.classList.toggle("active", b.dataset.mode === mode);
  }
  $("demo-panel").style.display = mode === "demo" ? "" : "none";
  $("upload-panel").style.display = mode === "upload" ? "" : "none";
  $("video").style.display = "none";
  if (mode === "camera") startCamera();
  if (mode === "demo") runDemo();
}

function runDemo() {
  renderDemoImage($("demo-text").value);
  analyze();
}

// ---- 初期化 ----
window.addEventListener("DOMContentLoaded", () => {
  for (const b of document.querySelectorAll(".tab")) {
    b.addEventListener("click", () => setMode(b.dataset.mode));
  }
  $("demo-run").addEventListener("click", runDemo);
  $("file").addEventListener("change", (e) => {
    if (e.target.files[0]) loadImageFile(e.target.files[0]);
  });
  $("thresh").addEventListener("input", analyze);
  $("invert").addEventListener("change", analyze);
  setMode("demo");
});
