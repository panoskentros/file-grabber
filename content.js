// Injected on demand: area selector, link matching and the review panel (in a shadow root).
(function () {
  if (window.__fgLoaded) return;
  window.__fgLoaded = true;

  let host = null; // element holding the shadow root
  let lastRect = null;

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, Segoe UI, sans-serif; }
    .shade { position: fixed; inset: 0; z-index: 2147483647; cursor: crosshair; background: rgba(0,0,0,.25); }
    .box { position: fixed; border: 2px solid #2f7df6; background: rgba(47,125,246,.15); pointer-events: none; }
    .hint { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 2147483647;
      background: #111; color: #fff; padding: 8px 14px; border-radius: 8px; font-size: 14px; pointer-events: none; }
    .panel { position: fixed; top: 16px; right: 16px; width: 380px; max-height: 80vh; overflow: auto; z-index: 2147483647;
      background: #fff; color: #111; border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,.35); padding: 14px; font-size: 14px; }
    h2 { margin: 0 0 8px; font-size: 15px; }
    label.row { display: flex; gap: 8px; align-items: flex-start; padding: 5px 0; border-top: 1px solid #eee; word-break: break-all; }
    .sub { color: #666; font-size: 12px; }
    .miss { color: #a15c00; font-size: 12px; margin-top: 8px; word-break: break-all; }
    .btns { display: flex; gap: 8px; margin-top: 12px; }
    button { border: 0; border-radius: 8px; padding: 8px 12px; font-size: 14px; cursor: pointer; background: #e8e8e8; color: #111; }
    button.primary { background: #2f7df6; color: #fff; }
    button:disabled { opacity: .5; cursor: default; }
  `;

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

  // ---------- 1. select an area ----------
  function startSelection() {
    const root = mount();
    const shade = el('div', { className: 'shade' });
    const hint = el('div', { className: 'hint', textContent: 'Drag over the list of file names — Esc to cancel' });
    root.append(shade, hint);
    let box = null;
    let x0 = 0, y0 = 0;

    const onKey = (e) => {
      if (e.key === 'Escape') {
        cleanup();
        unmount();
      }
    };
    const cleanup = () => document.removeEventListener('keydown', onKey, true);
    document.addEventListener('keydown', onKey, true);

    shade.addEventListener('mousedown', (e) => {
      e.preventDefault();
      x0 = e.clientX;
      y0 = e.clientY;
      box = el('div', { className: 'box' });
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
        chrome.runtime.sendMessage({ type: 'fg-capture', rect, viewportWidth: window.innerWidth });
      };
      window.addEventListener('mousemove', move, true);
      window.addEventListener('mouseup', up, true);
    });
  }

  function showStatus(text, withClose = false) {
    const root = mount();
    const panel = el('div', { className: 'panel' }, el('h2', { textContent: text }));
    if (withClose) panel.append(el('div', { className: 'btns' }, el('button', { textContent: 'Close', onclick: unmount })));
    root.append(panel);
  }

  // ---------- 2. link candidates ----------
  function lastSegment(href) {
    try {
      const u = new URL(href);
      const seg = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
      return seg;
    } catch (e) {
      return '';
    }
  }

  function collectCandidates(rect) {
    const seen = new Set();
    const out = [];
    for (const a of document.querySelectorAll('a[href]')) {
      if (!/^https?:/i.test(a.href) || seen.has(a.href + '|' + a.textContent)) continue;
      const text = a.textContent.replace(/\s+/g, ' ').trim();
      const labels = [text, a.getAttribute('download') || '', a.title || '', lastSegment(a.href)].filter(
        (l) => l && l.length >= 4 && l.length <= 200
      );
      if (!labels.length) continue;
      seen.add(a.href + '|' + a.textContent);
      const r = a.getBoundingClientRect();
      const inRegion = r.right > rect.x && r.left < rect.x + rect.w && r.bottom > rect.y && r.top < rect.y + rect.h;
      out.push({ href: a.href, labels, inRegion });
    }
    return out;
  }

  const SAFE_NAME = /[\\/:*?"<>|\u0000-\u001f]/g;
  function downloadName(label) {
    const t = label.trim().replace(SAFE_NAME, '_');
    return FGMatch.EXT_RE.test(t) ? t : '';
  }

  // ---------- 3. review panel ----------
  function showResults(lines) {
    const { matches, unmatched } = FGMatch.matchLines(lines, collectCandidates(lastRect));
    const root = mount();
    const panel = el('div', { className: 'panel' });
    root.append(panel);

    if (!matches.length) {
      panel.append(
        el('h2', { textContent: 'No matching links found' }),
        el('div', { className: 'sub', textContent: 'Text read from the screenshot:' }),
        el('div', { className: 'miss', textContent: lines.join(' · ') || '(nothing recognised)' }),
        el('div', { className: 'btns' }, el('button', { textContent: 'Close', onclick: unmount }))
      );
      return;
    }

    panel.append(el('h2', { textContent: `Found ${matches.length} file${matches.length > 1 ? 's' : ''}` }));
    const boxes = matches.map((m) => {
      const cb = el('input', { type: 'checkbox', checked: true });
      panel.append(
        el(
          'label',
          { className: 'row' },
          cb,
          el('span', {}, m.label, el('div', { className: 'sub', textContent: `read as “${m.line}” · ${Math.round(m.score * 100)}%` }))
        )
      );
      return cb;
    });
    if (unmatched.length) {
      panel.append(el('div', { className: 'miss', textContent: 'No link found for: ' + unmatched.join(' · ') }));
    }

    const dl = el('button', { className: 'primary', textContent: 'Download selected' });
    dl.onclick = async () => {
      const items = matches
        .filter((_, i) => boxes[i].checked)
        .map((m) => ({ url: m.href, filename: downloadName(m.label) }));
      if (!items.length) return;
      dl.disabled = true;
      dl.textContent = 'Starting downloads…';
      const res = await chrome.runtime.sendMessage({ type: 'fg-download', items });
      const failed = (res && res.results ? res.results : []).filter((r) => !r.ok);
      showStatus(
        failed.length ? `Started ${items.length - failed.length}, failed ${failed.length}: ${failed[0].error}` : `Started ${items.length} download${items.length > 1 ? 's' : ''}`,
        true
      );
    };
    panel.append(el('div', { className: 'btns' }, dl, el('button', { textContent: 'Cancel', onclick: unmount })));
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'fg-start') startSelection();
    else if (msg.type === 'fg-ocr-result') showResults(msg.lines);
    else if (msg.type === 'fg-ocr-error') showStatus('Could not read the screenshot: ' + msg.error, true);
  });
})();
