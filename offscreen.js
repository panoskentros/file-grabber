// Offscreen page: crops the screenshot, preprocesses it and runs Tesseract (all local, nothing leaves the browser).

let workerPromise = null;
function getWorker() {
  if (!workerPromise) {
    workerPromise = Tesseract.createWorker('eng', 1, {
      workerPath: chrome.runtime.getURL('lib/worker.min.js'),
      corePath: chrome.runtime.getURL('lib/'),
      langPath: chrome.runtime.getURL('lib/lang/'),
      workerBlobURL: false
    }).catch((e) => {
      workerPromise = null;
      throw e;
    });
  }
  return workerPromise;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode the screenshot'));
    img.src = src;
  });
}

async function prepareCanvas({ dataUrl, rect, viewportWidth }) {
  const img = await loadImage(dataUrl);
  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight; // pasted image: use all of it
  if (rect) {
    const k = img.naturalWidth / viewportWidth; // screenshot pixels per CSS pixel
    sx = Math.max(0, Math.round(rect.x * k));
    sy = Math.max(0, Math.round(rect.y * k));
    sw = Math.min(img.naturalWidth - sx, Math.round(rect.w * k));
    sh = Math.min(img.naturalHeight - sy, Math.round(rect.h * k));
  }
  if (sw < 10 || sh < 10) throw new Error('The selected area is too small');

  // Upscale small crops (Tesseract likes ~30px tall text); keep a white margin around the text.
  const scale = Math.max(1, Math.min(3, 1600 / sw));
  const pad = 20;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale) + pad * 2;
  canvas.height = Math.round(sh * scale) + pad * 2;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, pad, pad, Math.round(sw * scale), Math.round(sh * scale));

  // Dark theme? Invert so the text is dark on light.
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let sum = 0;
  for (let i = 0; i < data.data.length; i += 16) sum += data.data[i] * 0.3 + data.data[i + 1] * 0.59 + data.data[i + 2] * 0.11;
  if (sum / (data.data.length / 16) < 110) {
    for (let i = 0; i < data.data.length; i += 4) {
      data.data[i] = 255 - data.data[i];
      data.data[i + 1] = 255 - data.data[i + 1];
      data.data[i + 2] = 255 - data.data[i + 2];
    }
    ctx.putImageData(data, 0, 0);
  }
  return canvas;
}

async function ocr(job) {
  const canvas = await prepareCanvas(job);
  const worker = await getWorker();
  const candidates = job.candidates || [];
  // Links the page shows inside the selection: once OCR has found all of them there is no need for more passes.
  const expected = candidates.filter((c) => c.inRegion && c.fileLike);
  const seen = new Set();
  const lines = [];
  // Different layout modes miss different lines (e.g. the first row of a list), so union them.
  for (const psm of ['6', '4', '11']) {
    await worker.setParameters({ tessedit_pageseg_mode: psm });
    const { data } = await worker.recognize(canvas);
    for (const l of data.text.split('\n')) {
      const t = l.trim();
      if (t && !seen.has(t)) {
        seen.add(t);
        lines.push(t);
      }
    }
    if (expected.length) {
      const found = new Set(FGMatch.matchLines(lines, candidates).matches.map((m) => m.href));
      if (expected.every((c) => found.has(c.href))) break;
    }
  }
  return lines;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== 'offscreen') return;
  if (msg.type === 'warm') {
    getWorker().catch(() => {}); // preload the OCR engine while the user is still selecting
    return;
  }
  if (msg.type !== 'ocr') return;
  ocr(msg)
    .then((lines) => sendResponse({ lines }))
    .catch((e) => sendResponse({ error: String(e && e.message ? e.message : e) }));
  return true;
});
