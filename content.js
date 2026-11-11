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
  const PREF_DEFAULTS = { autoDownload: false, autoMode: 'files', downloadsDir: '' };
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
    if ((await getPrefs()).autoDownload) {
      const off = el('button', { textContent: 'Auto-download is on — turn it off' });
      off.style.cssText = 'position:fixed;top:56px;left:50%;transform:translateX(-50%);z-index:2147483647;';
      off.onclick = async (e) => { e.stopPropagation(); await setPrefs({ autoDownload: false }); off.remove(); };
      off.onmousedown = (e) => e.stopPropagation();
      root.append(off);
    }
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
  const cleanDir = (d) => d.split('/').map((p) => p.replace(SAFE, '_').trim()).filter(Boolean).join('/');
  const fileName = (m) => {
    const n = downloadName(m.label);
    return m.dir && n ? cleanDir(m.dir) + '/' + n : n;
  };
  const downloadName = (label) => {
    const t = label.trim().replace(SAFE, '_');
    return FGMatch.EXT_RE.test(t) ? t : '';
  };
  const zipBaseName = () => document.title.replace(SAFE, '_').replace(/\s+/g, ' ').trim().replace(/^\.+|[. ]+$/g, '').slice(0, 60);

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

  // ---- "Save all": fetch every file and hand Chrome ONE zip to save ----
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function buildZip(files) { // files: [{ name, data: Uint8Array }], stored (no compression: PDFs are compressed already)
    const enc = new TextEncoder();
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const parts = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(lh.buffer, name, f.data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(ch.buffer, name);
      offset += 30 + name.length + size;
    }
    const cdSize = central.reduce((n, p) => n + (p.byteLength !== undefined ? p.byteLength : p.length), 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
  }
  function nameFromResponse(res) {
    const cd = res.headers.get('content-disposition') || '';
    let m = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(cd);
    if (m) { try { return decodeURIComponent(m[1]).replace(SAFE, '_'); } catch (e) {} }
    m = /filename\s*=\s*"?([^";]+)"?/i.exec(cd);
    if (m) return m[1].trim().replace(SAFE, '_');
    try { return decodeURIComponent(new URL(res.url).pathname.split('/').filter(Boolean).pop() || '').replace(SAFE, '_'); } catch (e) { return ''; }
  }
  function uniqueIn(used, name) {
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
    let n = 0, cand = name;
    while (used.has(cand.toLowerCase())) cand = `${stem} (${++n})${ext}`;
    used.add(cand.toLowerCase());
    return cand;
  }
  async function saveAllAsZip(items) {
    const files = [], failed = [], used = new Set();
    for (let i = 0; i < items.length; i++) {
      showStatus(`Fetching ${i + 1} of ${items.length}…`);
      try {
        const res = await fetch(items[i].href, { credentials: 'include' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = new Uint8Array(await res.arrayBuffer());
        const base = downloadName(items[i].label) || nameFromResponse(res) || 'file';
        files.push({ name: uniqueIn(used, items[i].dir ? cleanDir(items[i].dir) + '/' + base : base), data });
      } catch (e) {
        failed.push(items[i]); // e.g. a link on another site: Chrome downloads it separately below
      }
    }
    if (files.length) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(buildZip(files));
      a.download = (zipBaseName() || 'files') + '.zip';
      (document.body || document.documentElement).append(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 10000);
    }
    if (failed.length) await bg({ type: 'fg-download', items: failed.map((m) => ({ url: m.href, name: fileName(m) })) });
    await bg({ type: 'fg-acc-clear' });
    showStatus(
      files.length
        ? `Saved ${files.length} file${files.length > 1 ? 's' : ''} in one zip` + (failed.length ? `; ${failed.length} downloaded separately` : '')
        : failed.length ? `Could not fetch the files; started ${failed.length} normal downloads` : 'Nothing to save',
      []
    );
  }

  async function doDownload(items) {
    showStatus('Starting downloads…');
    const res = await bg({ type: 'fg-download', items: items.map((m) => ({ url: m.href, name: fileName(m) })) });
    await bg({ type: 'fg-acc-clear' });
    const failed = ((res && res.results) || []).filter((r) => !r.ok);
    const ok = items.length - failed.length;
    showStatus(
      failed.length ? `Started ${ok}, failed ${failed.length}: ${failed[0].error}` : `Started ${ok} download${ok > 1 ? 's' : ''}`,
      []
    );
  }

  // ---- folders: a matched link that opens a folder page is replaced by the files inside it ----
  const isFolderPage = (url) => /[?&]openDir=|\/modules\/document\//i.test(url);
  async function probe(url) {
    const ctl = new AbortController();
    try {
      const res = await fetch(url, { credentials: 'include', signal: ctl.signal });
      if (!res.ok || !/text\/html/i.test(res.headers.get('content-type') || '')) { ctl.abort(); return null; } // a real file
      return { html: await res.text(), url: res.url };
    } catch (e) {
      return null; // other site / blocked: treat as a plain file link
    }
  }
  async function listFolder(page, dirName, depth, seen, budget) {
    const doc = new DOMParser().parseFromString(page.html, 'text/html');
    const here = new URL(page.url).searchParams.get('openDir') || '';
    const files = [], subs = [];
    for (const a of doc.querySelectorAll('a[href]')) {
      let href;
      try { href = new URL(a.getAttribute('href'), page.url).href; } catch (e) { continue; }
      if (!/^https?:/i.test(href) || seen.has(href)) continue;
      const text = a.textContent.replace(/\s+/g, ' ').trim();
      if (text && text.length <= 200 && FGMatch.EXT_RE.test(text)) {
        seen.add(href);
        files.push({ href, label: text, dir: dirName, sub: `in folder “${dirName}”` });
      } else if (text && depth < 3) {
        const dir = new URL(href).searchParams.get('openDir');
        if (dir && dir.startsWith(here + '/')) subs.push({ href, text }); // only deeper, never back up
      }
    }
    for (const sub of subs) {
      if (seen.has(sub.href) || budget.left <= 0) continue;
      seen.add(sub.href);
      budget.left--;
      const p = await probe(sub.href);
      if (p) files.push(...(await listFolder(p, dirName + '/' + sub.text, depth + 1, seen, budget)));
    }
    return files;
  }
  async function expandFolders(items) {
    const out = [];
    const seen = new Set();
    const budget = { left: 40 }; // folder pages to open, at most
    for (const m of items) {
      if (FGMatch.EXT_RE.test(m.label.trim())) { out.push(m); continue; } // has an extension: a file
      const page = await probe(m.href);
      const files = page && isFolderPage(page.url) ? await listFolder(page, m.label, 0, seen, budget) : [];
      if (files.length) out.push(...files);
      else out.push(m); // a file without extension, or an empty/unreadable folder
    }
    return out;
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

    if (fresh.some((m) => !FGMatch.EXT_RE.test(m.label.trim()))) {
      showStatus('Checking for folders…');
      fresh = await expandFolders(fresh);
    }

    const prev = ((await bg({ type: 'fg-acc-get' })) || {}).items || [];
    const byHref = new Map(prev.map((i) => [i.href, { ...i, sub: 'from an earlier screenshot' }]));
    for (const m of fresh) byHref.set(m.href, m);
    const items = [...byHref.values()];
    const prefs = await getPrefs();

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

    if (prefs.autoDownload) return prefs.autoMode === 'zip' ? saveAllAsZip(items) : doDownload(items);

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

    const path = el('div', { className: 'path', textContent: 'Save to: ' + (/[\\/]/.test(prefs.downloadsDir || '') ? prefs.downloadsDir : 'Downloads') + ' (default)' });
    const auto = el('input', { type: 'checkbox', checked: !!prefs.autoDownload });
    auto.onchange = () => setPrefs({ autoDownload: auto.checked }); // saved at once, whatever button is pressed later
    panel.append(
      el('div', { className: 'opts' },
        path,
        el('label', {}, auto, ' Download without asking next time')
      )
    );

    const dl = el('button', { className: 'primary', textContent: 'Download selected' });
    dl.onclick = async () => {
      const chosen = items.filter((_, i) => boxes[i].checked);
      if (!chosen.length) return;
      dl.disabled = true;
      await setPrefs({ autoMode: 'files' });
      doDownload(chosen);
    };
    const zipBtn = el('button', { textContent: 'Save all as ZIP' });
    zipBtn.onclick = async () => {
      const chosen = items.filter((_, i) => boxes[i].checked);
      if (!chosen.length) return;
      zipBtn.disabled = dl.disabled = true;
      await setPrefs({ autoMode: 'zip' });
      saveAllAsZip(chosen);
    };
    const more = el('button', { textContent: 'Add another screenshot', onclick: startSelection });
    const cancel = el('button', { textContent: 'Cancel', onclick: async () => { await bg({ type: 'fg-acc-clear' }); unmount(); } });
    panel.append(el('div', { className: 'btns' }, dl, zipBtn, more, cancel));
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'fg-start') bg({ type: 'fg-acc-clear' }).then(startSelection); // a new run never reuses old results
    else if (msg.type === 'fg-ocr-result') showResults(msg.lines, msg.candidates, null, msg.problem);
    else if (msg.type === 'fg-ocr-error') showResults([], msg.candidates, msg.error, msg.problem);
  });
})();
