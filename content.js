// Injected on demand: area selector (or pasted/dropped screenshot), link matching and the review panel (shadow root).
(function () {
  if (window.__fgLoadedV2) return;
  window.__fgLoadedV2 = true;

  let host = null; // element holding the shadow root
  let lastRect = null;

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, Segoe UI, sans-serif; }
    .shade { position: fixed; inset: 0; z-index: 2147483647; cursor: crosshair; background: rgba(0,0,0,.25); }
    .box { position: fixed; border: 2px solid #2f7df6; background: rgba(47,125,246,.15); pointer-events: none; }
    .hint { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 2147483647; text-align: center;
      background: #111; color: #fff; padding: 8px 14px; border-radius: 8px; font-size: 14px; pointer-events: none; }
    .panel { position: fixed; top: 16px; right: 16px; width: 380px; max-height: 80vh; overflow: auto; z-index: 2147483647;
      background: #fff; color: #111; border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,.35); padding: 14px; font-size: 14px; }
    h2 { margin: 0 0 8px; font-size: 15px; }
    label.row { display: flex; gap: 8px; align-items: flex-start; padding: 5px 0; border-top: 1px solid #eee; word-break: break-all; }
    .sub { color: #666; font-size: 12px; }
    .note { color: #444; font-size: 12px; margin-bottom: 6px; }
    .miss { color: #a15c00; font-size: 12px; margin-top: 8px; word-break: break-all; }
    .opts { margin-top: 10px; display: grid; gap: 6px; font-size: 13px; }
    .opts select, .opts input[type=text] { width: 100%; padding: 5px 7px; border: 1px solid #ccc; border-radius: 6px; font-size: 13px; }
    .path { font-size: 12px; color: #444; word-break: break-all; background: #f3f5f8; border-radius: 6px; padding: 6px 8px; margin-top: 10px; }
    .menu { display: grid; gap: 4px; }
    .menu button { text-align: left; background: #f3f5f8; padding: 6px 10px; font-size: 13px; }
    .menu button:hover { background: #e3e8f0; }
    .btns { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
    button { border: 0; border-radius: 8px; padding: 8px 12px; font-size: 14px; cursor: pointer; background: #e8e8e8; color: #111; }
    button.primary { background: #2f7df6; color: #fff; }
    button:disabled { opacity: .5; cursor: default; }
  `;

  // Top-frame links, read here (reliable); the background adds links from iframes.
  function topLinks(rect) {
    try {
      return { candidates: globalThis.fgCollectInPage(rect), problem: '' };
    } catch (e) {
      return { candidates: [], problem: String(e && e.message ? e.message : e) };
    }
  }

  const bg = (msg) => chrome.runtime.sendMessage(msg).catch(() => null);
  const PREF_DEFAULTS = { autoDownload: false, folderMode: 'title', customFolder: '', recentFolders: [], downloadsDir: '' };
  const getPrefs = () => chrome.storage.local.get(PREF_DEFAULTS).catch(() => PREF_DEFAULTS);
  const setPrefs = (o) => chrome.storage.local.set(o).catch(() => {});

  function mount() {
    unmount();
    host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    root.append(style);
    (document.body || document.documentElement).append(host);
    return root;
  }
  function unmount() {
    if (host) host.remove();
    host = null;
  }
  const el = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids);
    return n;
  };

  function showStatus(text, buttons = null) {
    const root = mount();
    const panel = el('div', { className: 'panel' }, el('h2', { textContent: text }));
    if (buttons) {
      const row = el('div', { className: 'btns' });
      for (const b of buttons) row.append(el('button', { textContent: b.label, onclick: b.onclick }));
      row.append(el('button', { textContent: 'Close', onclick: unmount }));
      panel.append(row);
    }
    panel.append(el('div', { className: 'sub', textContent: 'File Grabber v' + chrome.runtime.getManifest().version }));
    root.append(panel);
  }

  // ---------- 1. select an area, or paste / drop a screenshot ----------
  async function startSelection() {
    bg({ type: 'fg-warm' }); // preload the OCR engine
    const collected = ((await bg({ type: 'fg-acc-get' })) || {}).items || [];
    const root = mount();
    const shade = el('div', { className: 'shade' });
    const hint = el('div', {
      className: 'hint',
      textContent:
        'Drag over the list of file names — or paste / drop a screenshot (⌘V / Ctrl+V) — Esc to cancel' +
        (collected.length ? ` · ${collected.length} collected so far` : '')
    });
    root.append(shade, hint);
    let x0 = 0, y0 = 0;

    const cleanup = () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('paste', onPaste, true);
    };
    function onKey(e) {
      if (e.key === 'Escape') {
        cleanup();
        unmount();
      }
    }
    function takeImage(file) {
      if (!file || !file.type.startsWith('image/')) return false;
      const fr = new FileReader();
      fr.onload = () => {
        cleanup();
        lastRect = null;
        showStatus('Reading the screenshot…');
        bg({ type: 'fg-image', dataUrl: fr.result, ...topLinks(null) });
      };
      fr.readAsDataURL(file);
      return true;
    }
    function onPaste(e) {
      const item = [...((e.clipboardData && e.clipboardData.items) || [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'));
      if (item && takeImage(item.getAsFile())) e.preventDefault();
    }
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('paste', onPaste, true);
    shade.addEventListener('dragover', (e) => e.preventDefault());
    shade.addEventListener('drop', (e) => {
      e.preventDefault();
      takeImage(e.dataTransfer && e.dataTransfer.files[0]);
    });

    shade.addEventListener('mousedown', (e) => {
      e.preventDefault();
      x0 = e.clientX;
      y0 = e.clientY;
      const box = el('div', { className: 'box' });
      root.append(box);
      const move = (ev) => {
        const x = Math.min(x0, ev.clientX), y = Math.min(y0, ev.clientY);
        Object.assign(box.style, { left: x + 'px', top: y + 'px', width: Math.abs(ev.clientX - x0) + 'px', height: Math.abs(ev.clientY - y0) + 'px' });
      };
      const up = async (ev) => {
        window.removeEventListener('mousemove', move, true);
        window.removeEventListener('mouseup', up, true);
        cleanup();
        const rect = {
          x: Math.min(x0, ev.clientX),
          y: Math.min(y0, ev.clientY),
          w: Math.abs(ev.clientX - x0),
          h: Math.abs(ev.clientY - y0)
        };
        if (rect.w < 20 || rect.h < 12) return unmount();
        lastRect = rect;
        unmount(); // keep our overlay out of the screenshot
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        await new Promise((r) => setTimeout(r, 60));
        showStatus('Reading the screenshot…');
        bg({ type: 'fg-capture', rect, viewportWidth: window.innerWidth, ...topLinks(rect) });
      };
      window.addEventListener('mousemove', move, true);
      window.addEventListener('mouseup', up, true);
    });
  }

  // ---------- 2. helpers ----------
  const SAFE = /[\\/:*?"<>|\u0000-\u001f]/g;
  const SAFE_PATH = /[\\:*?"<>|\u0000-\u001f]/g; // like SAFE but keeps / for nested folders
  const downloadName = (label) => {
    const t = label.trim().replace(SAFE, '_');
    return FGMatch.EXT_RE.test(t) ? t : '';
  };
  const titleFolder = () => document.title.replace(SAFE, '_').replace(/\s+/g, ' ').trim().replace(/^\.+|[. ]+$/g, '').slice(0, 60);

  // No OCR match: fall back to the file-like links that sit inside the selected area.
  function domFallback(candidates) {
    const byHref = new Map();
    for (const c of candidates) {
      if (!c.inRegion || !c.fileLike) continue;
      const label = c.hasText ? c.labels[0] : c.labels[c.labels.length - 1];
      if (!byHref.has(c.href) || (c.hasText && !byHref.get(c.href).hasText)) byHref.set(c.href, { href: c.href, label, hasText: c.hasText });
    }
    return [...byHref.values()].map((m) => ({ href: m.href, label: m.label, sub: 'link inside your selection (not read from the screenshot)' }));
  }

  // ---- a folder chosen with the native (Finder) picker; the handle is remembered in this site's IndexedDB ----
  let dirHandle = null;
  const idb = () => new Promise((res, rej) => {
    const r = indexedDB.open('file-grabber', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  async function idbGet(k) {
    try {
      const db = await idb();
      return await new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); });
    } catch (e) { return null; }
  }
  async function idbSet(k, v) {
    try {
      const db = await idb();
      await new Promise((res) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = res; });
    } catch (e) {}
  }

  function nameFromResponse(res) {
    const cd = res.headers.get('content-disposition') || '';
    let m = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(cd);
    if (m) { try { return decodeURIComponent(m[1]).replace(SAFE, '_'); } catch (e) {} }
    m = /filename\s*=\s*"?([^";]+)"?/i.exec(cd);
    if (m) return m[1].trim().replace(SAFE, '_');
    try { return decodeURIComponent(new URL(res.url).pathname.split('/').filter(Boolean).pop() || '').replace(SAFE, '_'); } catch (e) { return ''; }
  }
  async function uniqueName(handle, name) {
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
    for (let n = 0; n < 100; n++) {
      const candidate = n ? `${stem} (${n})${ext}` : name;
      try { await handle.getFileHandle(candidate); } catch (e) { return candidate; } // not found = free
    }
    return name;
  }
  async function saveToDir(items, handle) {
    const saved = [], failed = [];
    for (const m of items) {
      try {
        const res = await fetch(m.href, { credentials: 'include' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const name = await uniqueName(handle, downloadName(m.label) || nameFromResponse(res) || 'file');
        const w = await (await handle.getFileHandle(name, { create: true })).createWritable();
        await res.body.pipeTo(w);
        saved.push(name);
      } catch (e) {
        failed.push(m);
      }
    }
    return { saved, failed };
  }

  // handle: chosen folder (or null = Chrome's normal Downloads folder)
  async function doDownload(items, prefs, handle) {
    showStatus('Starting downloads…');
    let saved = 0, viaChrome = items, where = 'your Downloads folder';
    if (handle) {
      const r = await saveToDir(items, handle);
      saved = r.saved.length;
      viaChrome = r.failed; // e.g. links on another site: let Chrome download those normally
      where = `“${handle.name}”`;
    }
    const res = viaChrome.length ? await bg({ type: 'fg-download', items: viaChrome.map((m) => ({ url: m.href, name: downloadName(m.label) })), folder: '' }) : { results: [] };
    await bg({ type: 'fg-acc-clear' });
    const failed = ((res && res.results) || []).filter((r) => !r.ok);
    const total = saved + viaChrome.length - failed.length;
    const extra = handle && viaChrome.length ? ` (${viaChrome.length} went to Downloads instead)` : '';
    showStatus(
      failed.length
        ? `Saved ${total}, failed ${failed.length}: ${failed[0].error}`
        : `Saved ${total} file${total > 1 ? 's' : ''} to ${where}${extra}`,
      (await getPrefs()).autoDownload
        ? [{ label: 'Ask me before downloading', onclick: async () => { await setPrefs({ autoDownload: false }); unmount(); } }]
        : []
    );
  }

  // ---------- 3. review panel ----------
  async function showResults(lines, candidates, error, problem) {
    let { matches, unmatched } = FGMatch.matchLines(lines, candidates || []);
    let note = '';
    let fresh = matches.map((m) => ({ href: m.href, label: m.label, sub: `read as “${m.line}” · ${Math.round(m.score * 100)}%` }));
    if (!fresh.length && lastRect) {
      fresh = domFallback(candidates || []);
      if (fresh.length) note = (error ? `Could not read the screenshot (${error}). ` : 'No file names recognised. ') + 'Using the links inside your selection instead.';
    }

    const prev = ((await bg({ type: 'fg-acc-get' })) || {}).items || [];
    const byHref = new Map(prev.map((i) => [i.href, { ...i, sub: 'from an earlier screenshot' }]));
    for (const m of fresh) byHref.set(m.href, m);
    const items = [...byHref.values()];
    const prefs = await getPrefs();
    dirHandle = await idbGet('dir');

    if (!items.length) {
      showStatus(error ? 'Could not read the screenshot: ' + error : 'No matching links found', [
        { label: 'Try again', onclick: startSelection }
      ]);
      const panel = host.shadowRoot.querySelector('.panel');
      const btns = panel.querySelector('.btns');
      if (problem) panel.insertBefore(el('div', { className: 'note', textContent: 'Could not read the links on this page: ' + problem }), btns);
      if (lines.length) panel.insertBefore(el('div', { className: 'miss', textContent: 'Text read: ' + lines.join(' · ') }), btns);
      return;
    }

    if (prefs.autoDownload) {
      const usable = dirHandle && (await dirHandle.queryPermission({ mode: 'readwrite' }).catch(() => 'denied')) === 'granted';
      return doDownload(items, prefs, usable ? dirHandle : null);
    }

    await bg({ type: 'fg-acc-set', items });
    const root = mount();
    const panel = el('div', { className: 'panel' });
    root.append(panel);
    panel.append(el('h2', { textContent: `Found ${items.length} file${items.length > 1 ? 's' : ''}` }));
    if (note) panel.append(el('div', { className: 'note', textContent: note }));
    const boxes = items.map((m) => {
      const cb = el('input', { type: 'checkbox', checked: true });
      panel.append(el('label', { className: 'row' }, cb, el('span', {}, m.label, el('div', { className: 'sub', textContent: m.sub || '' }))));
      return cb;
    });
    if (unmatched.length) panel.append(el('div', { className: 'miss', textContent: 'No link found for: ' + unmatched.join(' · ') }));

    // Save-to field + native folder picker (opens Finder / Explorer).
    const base = prefs.downloadsDir || 'Downloads';
    const path = el('div', { className: 'path' });
    const useDefault = el('button', { textContent: 'Use default', onclick: async () => { dirHandle = null; await idbSet('dir', null); refreshPath(); } });
    const refreshPath = () => {
      path.textContent = 'Save to: ' + (dirHandle ? dirHandle.name : `${base} (default)`);
      useDefault.style.display = dirHandle ? '' : 'none';
    };
    const hint = el('div', { className: 'sub' });
    const selectBtn = el('button', { textContent: 'Select folder…' });
    if (typeof window.showDirectoryPicker !== 'function') {
      selectBtn.disabled = true;
      hint.textContent = 'The folder picker needs a secure (https) page.';
    }
    selectBtn.onclick = async () => {
      try {
        dirHandle = await window.showDirectoryPicker({ id: 'file-grabber', mode: 'readwrite', startIn: 'downloads' });
        await idbSet('dir', dirHandle);
        hint.textContent = '';
      } catch (e) {
        if (e && e.name !== 'AbortError') hint.textContent = 'Could not use that folder: ' + e.message;
      }
      refreshPath();
    };
    refreshPath();
    const auto = el('input', { type: 'checkbox' });
    panel.append(
      el('div', { className: 'opts' },
        path,
        el('div', { className: 'btns', style: 'margin-top:0' }, selectBtn, useDefault),
        hint,
        el('label', {}, auto, ' Download without asking next time')
      )
    );

    const dl = el('button', { className: 'primary', textContent: 'Download selected' });
    dl.onclick = async () => {
      const chosen = items.filter((_, i) => boxes[i].checked);
      if (!chosen.length) return;
      dl.disabled = true;
      let handle = dirHandle;
      // must be the first await so the click still counts as a user gesture for the permission prompt
      if (handle && (await handle.requestPermission({ mode: 'readwrite' }).catch(() => 'denied')) !== 'granted') handle = null;
      if (auto.checked) await setPrefs({ autoDownload: true });
      doDownload(chosen, prefs, handle);
    };
    const more = el('button', { textContent: 'Add another screenshot', onclick: startSelection });
    const cancel = el('button', { textContent: 'Cancel', onclick: async () => { await bg({ type: 'fg-acc-clear' }); unmount(); } });
    panel.append(el('div', { className: 'btns' }, dl, more, cancel));
    panel.append(el('div', { className: 'sub', textContent: 'File Grabber v' + chrome.runtime.getManifest().version }));
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'fg-start') startSelection();
    else if (msg.type === 'fg-ocr-result') showResults(msg.lines, msg.candidates, null, msg.problem);
    else if (msg.type === 'fg-ocr-error') showResults([], msg.candidates, msg.error, msg.problem);
  });
})();
