// Service worker: injects the selector, collects links from every frame, captures the tab,
// asks the offscreen page to OCR, performs downloads and keeps multi-screenshot results.

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

// ---- downloads ----
const pendingNames = new Map(); // url -> file name taken from the link label (empty = let Chrome decide)

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  const key = pendingNames.has(item.url) ? item.url : pendingNames.has(item.finalUrl) ? item.finalUrl : null;
  if (!key) return; // not ours
  const name = pendingNames.get(key);
  pendingNames.delete(key);
  chrome.storage.local.set({ downloadsDir: item.filename.replace(/[\\/][^\\/]*$/, '') }); // real default folder, shown in the panel
  suggest(name ? { filename: name, conflictAction: 'uniquify' } : { conflictAction: 'uniquify' });
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
    case 'fg-download':
      Promise.all(
        msg.items.map(async ({ url, name }) => {
          try {
            pendingNames.set(url, name || '');
            await chrome.downloads.download({ url, conflictAction: 'uniquify' });
            return { url, ok: true };
          } catch (e) {
            pendingNames.delete(url);
            return { url, ok: false, error: String(e && e.message ? e.message : e) };
          }
        })
      ).then((results) => sendResponse({ results }));
      return true;
  }
});
