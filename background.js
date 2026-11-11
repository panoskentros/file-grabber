// Service worker: injects the selector, collects links from every frame, captures the tab,
// asks the offscreen page to OCR, performs downloads (into a subfolder) and keeps multi-screenshot results.

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['WORKERS'],
    justification: 'Run Tesseract OCR (web worker + WebAssembly) on the captured screenshot.'
  });
}

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['match.js', 'content.js'] });
    await chrome.tabs.sendMessage(tab.id, { type: 'fg-start' });
  } catch (e) {
    console.warn('File Grabber cannot run on this page:', e);
  }
});

// Runs inside every frame of the page (must be self-contained).
function collectInPage(rect) {
  let ox = 0, oy = 0, known = true;
  try {
    let w = window;
    while (w !== w.top) {
      const fe = w.frameElement; // null for cross-origin frames
      if (!fe) { known = false; break; }
      const r = fe.getBoundingClientRect();
      ox += r.left + fe.clientLeft;
      oy += r.top + fe.clientTop;
      w = w.parent;
    }
  } catch (e) { known = false; }

  const extRe = /\.[a-z0-9]{2,5}$/i;
  const out = [];
  const seen = new Set();
  for (const a of document.querySelectorAll('a[href]')) {
    if (!/^https?:/i.test(a.href)) continue;
    const text = a.textContent.replace(/\s+/g, ' ').trim();
    let seg = '';
    try { seg = decodeURIComponent(new URL(a.href).pathname.split('/').filter(Boolean).pop() || ''); } catch (e) {}
    const ok = (l) => l && l.length >= 4 && l.length <= 200;
    const hasText = ok(text);
    const labels = [hasText ? text : '', a.getAttribute('download') || '', a.title || '', seg].filter(ok);
    if (!labels.length) continue;
    const key = a.href + '|' + labels[0];
    if (seen.has(key)) continue;
    seen.add(key);
    let inRegion = false;
    if (rect && known) {
      const r = a.getBoundingClientRect();
      const l = r.left + ox, t = r.top + oy, rr = r.right + ox, b = r.bottom + oy;
      inRegion = rr > rect.x && l < rect.x + rect.w && b > rect.y && t < rect.y + rect.h;
    }
    const fileLike =
      extRe.test(text) || /\.[a-z0-9]{2,5}($|[?#])/i.test(a.pathname || '') || /(pluginfile|download|attachment|\/file\b|\/document)/i.test(a.href);
    out.push({ href: a.href, labels, hasText, inRegion, fileLike });
  }
  return out;
}

// Returns { candidates, problem }. One inaccessible frame makes an allFrames call fail as a whole,
// so fall back to the top frame (and per frame) instead of returning nothing.
async function collectCandidates(tabId, rect) {
  const run = (target) => chrome.scripting.executeScript({ target, func: collectInPage, args: [rect || null] });
  let frames = [];
  let problem = '';
  try {
    frames = await run({ tabId, allFrames: true });
  } catch (e) {
    problem = String(e && e.message ? e.message : e);
    console.warn('allFrames link collection failed, trying the top frame only:', e);
    try {
      frames = await run({ tabId });
      problem = ''; // top frame is what matters; iframes were skipped
    } catch (e2) {
      problem = String(e2 && e2.message ? e2.message : e2);
    }
  }
  const seen = new Set();
  const candidates = [];
  for (const f of frames) {
    for (const c of f.result || []) {
      const key = c.href + '|' + c.labels[0];
      if (!seen.has(key)) { seen.add(key); candidates.push(c); }
    }
  }
  if (!candidates.length && !problem) problem = 'the page has no links the extension can see (it may be inside a frame it cannot access)';
  return { candidates, problem };
}

async function runOcr(tab, { rect, viewportWidth, dataUrl }) {
  const tabId = tab.id;
  const send = (msg) => chrome.tabs.sendMessage(tabId, msg).catch(() => {});
  const { candidates, problem } = await collectCandidates(tabId, rect);
  try {
    if (!dataUrl) dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    await ensureOffscreen();
    const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'ocr', dataUrl, rect: rect || null, viewportWidth, candidates });
    if (!res || res.error) throw new Error(res ? res.error : 'No response from OCR page');
    await send({ type: 'fg-ocr-result', lines: res.lines, candidates, problem });
  } catch (e) {
    await send({ type: 'fg-ocr-error', error: String(e && e.message ? e.message : e), candidates, problem });
  }
}

// ---- downloads into a subfolder ----
const pending = new Map(); // url -> { folder, name }

function cleanFolder(f) {
  return String(f || '')
    .replace(/[\\:*?"<>|\u0000-\u001f]/g, '_')
    .split('/')
    .map((s) => s.trim().replace(/[. ]+$/, ''))
    .filter((s) => s && s !== '.' && s !== '..')
    .join('/');
}

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  const key = pending.has(item.url) ? item.url : pending.has(item.finalUrl) ? item.finalUrl : null;
  if (!key) return; // not ours
  const { folder, name } = pending.get(key);
  pending.delete(key);
  const base = name || item.filename.split(/[\\/]/).pop();
  suggest({ filename: folder ? `${folder}/${base}` : base, conflictAction: 'uniquify' });
});

// ---- results collected over several screenshots / pages ----
const ACC = 'fgAcc';
const accGet = async () => (await chrome.storage.session.get(ACC))[ACC] || [];

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target === 'offscreen') return; // handled by offscreen.js

  switch (msg.type) {
    case 'fg-warm':
      ensureOffscreen()
        .then(() => chrome.runtime.sendMessage({ target: 'offscreen', type: 'warm' }))
        .catch(() => {});
      break;
    case 'fg-capture':
      if (sender.tab) runOcr(sender.tab, { rect: msg.rect, viewportWidth: msg.viewportWidth });
      break;
    case 'fg-image':
      if (sender.tab) runOcr(sender.tab, { rect: null, dataUrl: msg.dataUrl });
      break;
    case 'fg-acc-get':
      accGet().then((items) => sendResponse({ items }));
      return true;
    case 'fg-acc-set':
      chrome.storage.session.set({ [ACC]: msg.items }).then(() => sendResponse({ ok: true }));
      return true;
    case 'fg-acc-clear':
      chrome.storage.session.remove(ACC).then(() => sendResponse({ ok: true }));
      return true;
    case 'fg-download': {
      const folder = cleanFolder(msg.folder);
      Promise.all(
        msg.items.map(async ({ url, name }) => {
          try {
            pending.set(url, { folder, name: name || '' });
            await chrome.downloads.download({ url, conflictAction: 'uniquify' });
            return { url, ok: true };
          } catch (e) {
            pending.delete(url);
            return { url, ok: false, error: String(e && e.message ? e.message : e) };
          }
        })
      ).then((results) => sendResponse({ results }));
      return true;
    }
  }
});
