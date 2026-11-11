// Matches OCR'd text lines against links on the page. Classic script, also loadable from Node for tests.
(function (root) {
  const EXT_RE = /\.[a-z0-9]{2,5}$/i;

  // Lowercase, keep only [a-z0-9]; fold look-alike characters OCR commonly mixes up.
  function norm(s) {
    return s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '') // accents (incl. Greek tonos)
      .replace(/\u03c2/g, '\u03c3') // final sigma
      .replace(/[|!]/g, 'l')
      .replace(/[^a-z0-9\u03b1-\u03c9]/g, '');
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
    if (base.replace(/[0-9]/g, '').length < 3) return 0; // a label that is mostly digits (e.g. a year) is not distinctive
    return 1 - approxContains(base, hay) / base.length;
  }

  // A line that plausibly is a file name (has an extension or snake_case words); used to hide OCR noise.
  function looksLikeFileName(line) {
    return /[\w-]{3,}\.[a-z0-9]{2,5}\b/i.test(line) || /[a-z0-9]+_[a-z0-9]+/i.test(line);
  }

  // candidates: [{ href, labels: string[], hasText?: boolean, inRegion: boolean }]
  // labels[0] is the visible link text when hasText is true (preferred over e.g. an icon link to the same file).
  // Matching is one-to-one (each OCR line serves one file), best scores first, so rows that differ by one
  // misread character (e.g. "2023" read as "2025") do not both claim the same line.
  // Returns { matches: [{ href, label, line, score }], unmatched: string[] } (unmatched = file-like lines only)
  function matchLines(lines, candidates, threshold = 0.85) {
    const clean = lines.map((l) => l.trim());
    const anyInRegion = candidates.some((c) => c.inRegion);
    const pairs = [];
    const lineHasCandidate = new Array(clean.length).fill(false);
    candidates.forEach((c, ci) => {
      // Links outside the selected area need a (near) exact match so look-alike links elsewhere are not grabbed.
      const need = !anyInRegion || c.inRegion ? threshold : Math.max(threshold, 0.97);
      clean.forEach((line, li) => {
        if (norm(line).length < 4) return;
        c.labels.forEach((label, idx) => {
          const s = score(label, line);
          if (s < threshold) return;
          lineHasCandidate[li] = true;
          if (s < need) return;
          const rank = s + (c.hasText && idx === 0 ? 1e-3 : 0) + (c.inRegion ? 1e-4 : 0);
          pairs.push({ ci, li, label, s, rank });
        });
      });
    });
    pairs.sort((x, y) => y.rank - x.rank);
    const usedLines = new Set(), usedHrefs = new Set(), usedKeys = new Set();
    const matches = [];
    for (const p of pairs) {
      const c = candidates[p.ci];
      const key = norm(p.label.replace(EXT_RE, '')); // icon link + text link to the same file share a label
      if (usedLines.has(p.li) || usedHrefs.has(c.href) || usedKeys.has(key)) continue;
      usedLines.add(p.li);
      usedHrefs.add(c.href);
      usedKeys.add(key);
      matches.push({ href: c.href, label: p.label, line: clean[p.li], score: p.s });
    }
    const unmatched = clean.filter((l, i) => !lineHasCandidate[i] && norm(l).length >= 4 && looksLikeFileName(l));
    return { matches, unmatched };
  }

  const api = { norm, score, matchLines, looksLikeFileName, EXT_RE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FGMatch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
