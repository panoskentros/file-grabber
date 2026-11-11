// Matches OCR'd text lines against links on the page. Classic script, also loadable from Node for tests.
(function (root) {
  const EXT_RE = /\.[a-z0-9]{2,5}$/i;

  // Lowercase, keep only [a-z0-9]; fold look-alike characters OCR commonly mixes up.
  function norm(s) {
    return s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[|!]/g, 'l')
      .replace(/[^a-z0-9]/g, '');
  }

  // Best edit distance of `pattern` against any substring of `text` (Sellers' algorithm).
  function approxContains(pattern, text) {
    const m = pattern.length;
    if (!m) return m;
    let prev = new Array(m + 1);
    for (let i = 0; i <= m; i++) prev[i] = i;
    let best = m;
    for (let j = 1; j <= text.length; j++) {
      const cur = new Array(m + 1);
      cur[0] = 0;
      for (let i = 1; i <= m; i++) {
        const cost = pattern[i - 1] === text[j - 1] ? 0 : 1;
        cur[i] = Math.min(prev[i - 1] + cost, prev[i] + 1, cur[i - 1] + 1);
      }
      if (cur[m] < best) best = cur[m];
      prev = cur;
    }
    return best;
  }

  // 0..1 similarity of a link label to an OCR line, extension ignored (it is often not shown).
  function score(label, line) {
    const base = norm(label.replace(EXT_RE, ''));
    const hay = norm(line);
    if (base.length < 4 || hay.length < 4) return 0;
    return 1 - approxContains(base, hay) / base.length;
  }

  // candidates: [{ href, labels: string[], inRegion: boolean }]
  // Returns { matches: [{ href, label, line, score }], unmatched: string[] }
  function matchLines(lines, candidates, threshold = 0.85) {
    const byHref = new Map();
    const unmatched = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (norm(line).length < 4) continue;
      let best = null;
      for (const c of candidates) {
        for (const label of c.labels) {
          const s = score(label, line);
          const better =
            !best ||
            s > best.score + 1e-9 ||
            (Math.abs(s - best.score) < 1e-9 && c.inRegion && !best.inRegion);
          if (s >= threshold && better) best = { href: c.href, label, line, score: s, inRegion: c.inRegion };
        }
      }
      if (best) {
        const old = byHref.get(best.href);
        if (!old || best.score > old.score) byHref.set(best.href, best);
      } else {
        unmatched.push(line);
      }
    }
    return { matches: [...byHref.values()], unmatched };
  }

  const api = { norm, score, matchLines, EXT_RE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FGMatch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
