// Service worker: injects the selector, captures the tab, asks the offscreen page to OCR, performs downloads.

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

async function runOcr(tab, rect, viewportWidth) {
  const tabId = tab.id;
  const send = (msg) => chrome.tabs.sendMessage(tabId, msg).catch(() => {});
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    await ensureOffscreen();
    const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'ocr', dataUrl, rect, viewportWidth });
    if (!res || res.error) throw new Error(res ? res.error : 'No response from OCR page');
    await send({ type: 'fg-ocr-result', lines: res.lines });
  } catch (e) {
    await send({ type: 'fg-ocr-error', error: String(e && e.message ? e.message : e) });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target === 'offscreen') return; // handled by offscreen.js

  if (msg.type === 'fg-capture' && sender.tab) {
    runOcr(sender.tab, msg.rect, msg.viewportWidth);
    sendResponse({ ok: true });
  } else if (msg.type === 'fg-download') {
    Promise.all(
      msg.items.map(async ({ url, filename }) => {
        try {
          const opts = { url, conflictAction: 'uniquify' };
          if (filename) opts.filename = filename;
          await chrome.downloads.download(opts);
          return { url, ok: true };
        } catch (e) {
          return { url, ok: false, error: String(e && e.message ? e.message : e) };
        }
      })
    ).then((results) => sendResponse({ results }));
    return true; // async response
  }
});
