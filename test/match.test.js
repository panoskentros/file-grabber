const test = require('node:test');
const assert = require('node:assert');
const { matchLines, looksLikeFileName } = require('../match.js');

const cand = (name, extra = {}) => ({ href: 'https://x/' + name, labels: [name], hasText: true, inRegion: true, ...extra });

test('matches names inside noisy OCR lines, ignoring extension and OCR junk', () => {
  const r = matchLines(['BE. 02_graphreptransv.pdf 937', 'E. 10a_greedy_notes og'], [cand('02_graphreptransv.pdf'), cand('10a_greedy_notes'), cand('10_greedalg.pdf')]);
  assert.deepStrictEqual(r.matches.map((m) => m.label).sort(), ['02_graphreptransv.pdf', '10a_greedy_notes']);
});

test('tolerates small OCR mistakes', () => {
  const r = matchLines(['04_graphtransexcr.pdf'], [cand('04_graphtransexer.pdf')]);
  assert.strictEqual(r.matches.length, 1);
});

test('header noise is not reported as unmatched, file-like lines are', () => {
  const r = matchLines(['a Apxeilo', '~ Apxelo', '99_missing_file.pdf'], [cand('01_graphsintro.pdf')]);
  assert.deepStrictEqual(r.unmatched, ['99_missing_file.pdf']);
  assert.ok(!looksLikeFileName('Apxeio M'));
});

test('prefers the visible-text link over an icon link to the same file', () => {
  const icon = { href: 'https://x/dl/1', labels: ['01_graphsintro.pdf'], hasText: false, inRegion: true };
  const text = { href: 'https://x/view/1', labels: ['01_graphsintro.pdf'], hasText: true, inRegion: true };
  const r = matchLines(['01_graphsintro.pdf'], [icon, text]);
  assert.deepStrictEqual(r.matches.map((m) => m.href), ['https://x/view/1']);
});

test('does not match unrelated names', () => {
  const r = matchLines(['11_greedyexer.pdf'], [cand('10_greedalg.pdf')]);
  assert.strictEqual(r.matches.length, 0);
});
