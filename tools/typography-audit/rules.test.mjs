import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROFILES, evaluateTypography, findingKey, diffFindings, compareFacts, factKey, normalizeKeyText,
} from './rules.mjs';

const NOTO = '"Noto Sans Thai", "Inter", sans-serif';
const fact = (o = {}) => ({
  key: factKey(o.kind ?? 'text', o.text ?? 'ข้อความ', 0),
  tag: 'div', kind: 'text', text: 'ข้อความ', fontSize: 14, lineHeight: 22, fontWeight: 400,
  fontFamily: NOTO, numeric: false, x: 0, y: 0, w: 100, h: 22, lines: 1, textTop: 0, textHeight: 22,
  inkWidth: 80, inkHeight: 14, overflowClip: 'none', scrollOverflowX: false, scrollOverflowY: false,
  hasThai: false, numericOnly: false, inReadingBlock: false, iconRatios: [], headingLevel: null, ...o,
});
const ctx = (o = {}) => ({ app: 'web', width: 1440, theme: 'light', role: 'admin', route: '/x', ...o });
const rules = (facts, c) => evaluateTypography(facts, c).map((f) => `${f.rule}:${f.severity}`);

test('profiles expose scales and weights', () => {
  assert.deepEqual(PROFILES.web.scale, [12, 13, 14, 16, 18, 20, 22, 24, 30, 36]);
  assert.deepEqual(PROFILES.shop.weights, [400, 500, 600, 700]);
});

test('R1 off-scale', () => {
  assert.ok(rules([fact({ fontSize: 15, lineHeight: 24 })], ctx()).includes('R1:P3'));
  assert.ok(!rules([fact({ fontSize: 14 })], ctx()).some((r) => r.startsWith('R1')));
});

test('R2 h2 larger than h1', () => {
  const h1 = fact({ kind: 'heading', text: 'หัว', headingLevel: 1, fontSize: 24, lineHeight: 32 });
  const h2 = fact({ kind: 'heading', text: 'รอง', headingLevel: 2, fontSize: 30, lineHeight: 40 });
  assert.ok(rules([h1, h2], ctx()).includes('R2:P2'));
  assert.ok(!rules([h2], ctx()).some((r) => r.startsWith('R2')));
});

test('R3 Thai cramped', () => {
  assert.ok(rules([fact({ hasThai: true, lineHeight: 15.4 })], ctx()).includes('R3:P1'));
  assert.ok(rules([fact({ lineHeight: 15.4 })], ctx()).includes('R3:P2'));
  assert.ok(!rules([fact({ lineHeight: 22 })], ctx()).some((r) => r.startsWith('R3')));
});

test('R4 ink overflow', () => {
  const clipped = fact({ overflowClip: 'y', inkHeight: 19, lineHeight: 16, hasThai: true });
  assert.ok(rules([clipped], ctx()).includes('R4:P1'));
  assert.ok(!rules([{ ...clipped, overflowClip: 'none' }], ctx()).some((r) => r.startsWith('R4')));
});

test('R5 wrapped button', () => {
  const b = fact({ kind: 'button', lines: 2 });
  assert.ok(rules([b], ctx({ width: 1440 })).includes('R5:P1'));
  assert.ok(rules([b], ctx({ width: 390 })).includes('R5:P2'));
  assert.ok(!rules([{ ...b, lines: 1 }], ctx()).some((r) => r.startsWith('R5')));
});

test('R6 truncated', () => {
  const th = fact({ kind: 'th', overflowClip: 'x', scrollOverflowX: true });
  assert.ok(rules([th], ctx()).includes('R6:P2'));
});

test('R7 touch', () => {
  const b = fact({ kind: 'button', h: 40 });
  assert.ok(rules([b], ctx({ width: 390 })).includes('R7:P2'));
  assert.ok(!rules([b], ctx({ width: 1440 })).some((r) => r.startsWith('R7')));
});

test('R7b input font <16 on mobile', () => {
  const i = fact({ kind: 'input', h: 48, fontSize: 14 });
  assert.ok(rules([i], ctx({ width: 390 })).includes('R7b:P2'));
  assert.ok(!rules([i], ctx({ width: 1440 })).some((r) => r.startsWith('R7b')));
});

test('R8 wrong family', () => {
  assert.ok(rules([fact({ fontFamily: '"Noto Sans Thai Looped", sans-serif' })], ctx()).includes('R8:P1'));
  assert.ok(rules([fact({ fontFamily: '"Sarabun", serif' })], ctx()).includes('R8:P1'));
  const reading = fact({ fontFamily: '"Sarabun", serif', inReadingBlock: true });
  assert.ok(!rules([reading], ctx({ app: 'shop' })).some((r) => r.startsWith('R8')));
  assert.ok(rules([reading], ctx({ app: 'web' })).includes('R8:P1'));
});

test('R9 weight, R10 tnum, R11 icon, R12 measure', () => {
  assert.ok(rules([fact({ fontWeight: 800 })], ctx({ app: 'shop' })).includes('R9:P3'));
  assert.ok(rules([fact({ tag: 'td', text: '1,200', numericOnly: true })], ctx()).includes('R10:P3'));
  assert.ok(!rules([fact({ tag: 'td', text: '1,200', numericOnly: true, numeric: true })], ctx()).some((r) => r.startsWith('R10')));
  assert.ok(rules([fact({ iconRatios: [2] })], ctx()).includes('R11:P3'));
  assert.ok(rules([fact({ kind: 'paragraph', w: 800, fontSize: 16, lineHeight: 26, lines: 3 })], ctx()).includes('R12:P3'));
  assert.ok(!rules([fact({ kind: 'paragraph', w: 800, fontSize: 16, lineHeight: 26, lines: 3 })], ctx({ width: 1024 })).some((r) => r.startsWith('R12')));
});

test('findingKey ignores class changes', () => {
  const a = fact({ kind: 'text', text: 'ยอด 1,200', className: 'text-sm', fontSize: 15, key: factKey('text', 'ยอด 1,200', 0) });
  const b = fact({ kind: 'text', text: 'ยอด 1,300', className: 'reading-block', fontSize: 15, key: factKey('text', 'ยอด 1,300', 0) });
  const [fa] = evaluateTypography([a], ctx()).filter((f) => f.rule === 'R1');
  const [fb] = evaluateTypography([b], ctx()).filter((f) => f.rule === 'R1');
  assert.equal(findingKey(fa), findingKey(fb));
  assert.equal(normalizeKeyText('  ยอด   1,200 '), 'ยอด #,###');
  assert.equal(findingKey(fa), '/x|1440|light|admin|R1|text|ยอด #,###|0');
});

test('diffFindings excludes R8 and splits added/resolved/persisting', () => {
  const mk = (rule, key) => ({ rule, severity: 'P3', route: '/x', width: 1, theme: 't', role: 'r', key, text: '', detail: {} });
  const before = [mk('R1', 'a'), mk('R1', 'b'), mk('R8', 'c')];
  const after = [mk('R1', 'b'), mk('R1', 'd'), mk('R8', 'e')];
  const d = diffFindings(before, after, { excludeRules: ['R8'] });
  assert.deepEqual(d.added.map((f) => f.key), ['d']);
  assert.deepEqual(d.resolved.map((f) => f.key), ['a']);
  assert.deepEqual(d.persisting.map((f) => f.key), ['b']);
});

test('compareFacts flags D1 width change >8% and D2 vertical offset >1.5px', () => {
  const b = fact({ kind: 'button', text: 'ตกลง', inkWidth: 100, y: 0, h: 40, textTop: 11, textHeight: 18 });
  const a = { ...b, inkWidth: 110, textTop: 14 };
  const out = compareFacts([b], [a], { route: '/x' });
  assert.deepEqual(out.map((d) => d.rule).sort(), ['D1', 'D2']);
  assert.equal(out[0].route, '/x');
  assert.equal(compareFacts([b], [{ ...b, inkWidth: 104 }]).length, 0);
});
