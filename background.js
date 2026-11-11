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
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['match.js', 'collect.js', 'content.js'] });
    await chrome.tabs.sendMessage(tab.id, { type: 'fg-start' });
  } catch (e) {
    console.warn('File Grabber cannot run on this page:', e);
  }
});

// Links in sub-frames (iframes), best effort: the top frame is collected by the content script itself.
async function collectSubframes(tabId, rect) {
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['collect.js'] });
    const frames = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: (r) => globalThis.fgCollectInPage(r),
      args: [rect || null]
    });
    return frames.filter((f) => f.frameId !== 0).flatMap((f) => f.result || []);
  } catch (e) {
    console.warn('Could not read links from iframes:', e);
    return [];
  }
}

async function runOcr(tab, { rect, viewportWidth, dataUrl, candidates: top, problem: topProblem }) {
  const tabId = tab.id;
  const send = (msg) => chrome.tabs.sendMessage(tabId, msg).catch(() => {});
  const seen = new Set();
  const candidates = [];
  for (const c of [...(top || []), ...(await collectSubframes(tabId, rect))]) {
    const key = c.href + '|' + c.labels[0];
    if (!seen.has(key)) { seen.add(key); candidates.push(c); }
  }
  const problem = candidates.length ? '' : topProblem || 'no links were found on this page (are the files inside an embedded frame?)';
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
      if (sender.tab) runOcr(sender.tab, { rect: msg.rect, viewportWidth: msg.viewportWidth, candidates: msg.candidates, problem: msg.problem });
      break;
    case 'fg-image':
      if (sender.tab) runOcr(sender.tab, { rect: null, dataUrl: msg.dataUrl, candidates: msg.candidates, problem: msg.problem });
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
