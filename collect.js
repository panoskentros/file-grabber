// Collects link candidates in the current frame. Shared by the content script (top frame) and the background (sub-frames).
globalThis.fgCollectInPage = function (rect) {
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
      inRegion = r.right + ox > rect.x && r.left + ox < rect.x + rect.w && r.bottom + oy > rect.y && r.top + oy < rect.y + rect.h;
    }
    const fileLike =
      extRe.test(text) || /\.[a-z0-9]{2,5}($|[?#])/i.test(a.pathname || '') || /(pluginfile|download|attachment|\/file\b|\/document)/i.test(a.href);
    out.push({ href: a.href, labels, hasText, inRegion, fileLike });
  }
  return out;
};
