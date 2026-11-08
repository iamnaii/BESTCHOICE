import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROFILES, isNumericOnly, evaluateTypography, findingKey, diffFindings, compareFacts, factKey, normalizeKeyText,
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
const has = (facts, c, id) => evaluateTypography(facts, c).some((f) => f.rule === id);

test('profiles expose scales and weights', () => {
  assert.deepEqual(PROFILES.web.scale, [12, 13, 14, 16, 18, 20, 22, 24, 30, 36]);
  assert.deepEqual(PROFILES.shop.weights, [400, 500, 600, 700]);
});

test('R1 off-scale', () => {
  assert.ok(rules([fact({ fontSize: 15, lineHeight: 24 })], ctx()).includes('R1:P3'));
  assert.ok(!has([fact({ fontSize: 14 })], ctx(), 'R1'));
});

test('R2 h2 larger than h1', () => {
  const h1 = fact({ kind: 'heading', text: 'หัว', headingLevel: 1, fontSize: 24, lineHeight: 32 });
  const h2 = fact({ kind: 'heading', text: 'รอง', headingLevel: 2, fontSize: 30, lineHeight: 40 });
  assert.ok(rules([h1, h2], ctx()).includes('R2:P2'));
  assert.ok(!rules([h2], ctx()).some((r) => r.startsWith('R2:')));
});

test('R3 Thai cramped', () => {
  assert.ok(rules([fact({ hasThai: true, lineHeight: 15.4 })], ctx()).includes('R3:P1'));
  assert.ok(rules([fact({ lineHeight: 15.4 })], ctx()).includes('R3:P2'));
  assert.ok(!rules([fact({ lineHeight: 22 })], ctx()).some((r) => r.startsWith('R3:')));
});

test('R4 ink overflow', () => {
  const clipped = fact({ overflowClip: 'y', inkHeight: 19, lineHeight: 16, hasThai: true });
  assert.ok(rules([clipped], ctx()).includes('R4:P1'));
  assert.ok(!rules([{ ...clipped, overflowClip: 'none' }], ctx()).some((r) => r.startsWith('R4:')));
});

test('R5 wrapped button', () => {
  const b = fact({ kind: 'button', lines: 2 });
  assert.ok(rules([b], ctx({ width: 1440 })).includes('R5:P1'));
  assert.ok(rules([b], ctx({ width: 390 })).includes('R5:P2'));
  assert.ok(!rules([{ ...b, lines: 1 }], ctx()).some((r) => r.startsWith('R5:')));
});

test('R6 truncated', () => {
  const th = fact({ kind: 'th', overflowClip: 'x', scrollOverflowX: true });
  assert.ok(rules([th], ctx()).includes('R6:P2'));
});

test('R7 touch', () => {
  const b = fact({ kind: 'button', h: 40 });
  assert.ok(rules([b], ctx({ width: 390 })).includes('R7:P2'));
  assert.ok(!rules([b], ctx({ width: 1440 })).some((r) => r.startsWith('R7:')));
});

test('R7b input font <16 on mobile', () => {
  const i = fact({ kind: 'input', h: 48, fontSize: 14 });
  assert.ok(rules([i], ctx({ width: 390 })).includes('R7b:P2'));
  assert.ok(!rules([i], ctx({ width: 1440 })).some((r) => r.startsWith('R7b:')));
});

test('R8 wrong family', () => {
  assert.ok(rules([fact({ fontFamily: '"Noto Sans Thai Looped", sans-serif' })], ctx()).includes('R8:P1'));
  assert.ok(rules([fact({ fontFamily: '"Sarabun", serif' })], ctx()).includes('R8:P1'));
  const reading = fact({ fontFamily: '"Sarabun", serif', inReadingBlock: true });
  assert.ok(!rules([reading], ctx({ app: 'shop' })).some((r) => r.startsWith('R8:')));
  assert.ok(rules([reading], ctx({ app: 'web' })).includes('R8:P1'));
});

test('R9 weight, R10 tnum, R11 icon, R12 measure', () => {
  assert.ok(rules([fact({ fontWeight: 800 })], ctx({ app: 'shop' })).includes('R9:P3'));
  assert.ok(rules([fact({ tag: 'td', text: '1,200', numericOnly: true })], ctx()).includes('R10:P3'));
  assert.ok(!rules([fact({ tag: 'td', text: '1,200', numericOnly: true, numeric: true })], ctx()).some((r) => r.startsWith('R10:')));
  assert.ok(rules([fact({ iconRatios: [2] })], ctx()).includes('R11:P3'));
  assert.ok(rules([fact({ kind: 'paragraph', w: 800, fontSize: 16, lineHeight: 26, lines: 3 })], ctx()).includes('R12:P3'));
  assert.ok(!rules([fact({ kind: 'paragraph', w: 800, fontSize: 16, lineHeight: 26, lines: 3 })], ctx({ width: 1024 })).some((r) => r.startsWith('R12:')));
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

test('fix1: diffFindings escalation keeps before and flags severity rise', () => {
  const mk = (severity) => ({ rule: 'R3', severity, route: '/x', width: 1, theme: 't', role: 'r', key: 'k', text: '', detail: {} });
  const d = diffFindings([mk('P2')], [mk('P1')]);
  assert.equal(d.added.length, 0);
  assert.equal(d.persisting[0].before.severity, 'P2');
  assert.equal(d.escalated.length, 1);
  assert.equal(diffFindings([mk('P1')], [mk('P2')]).escalated.length, 0);
  const r8 = { ...mk('P1'), rule: 'R8' };
  assert.equal(diffFindings([], [r8]).added.length, 0, 'R8 excluded by default');
  assert.equal(diffFindings([], [r8], { excludeRules: [] }).added.length, 1);
});

test('fix1: isNumericOnly requires a digit; R10 trusts the flag', () => {
  assert.equal(isNumericOnly('-'), false);
  assert.equal(isNumericOnly('–'), false);
  assert.equal(isNumericOnly('1,234.50'), true);
  assert.equal(isNumericOnly('฿ 1,200'), true);
  assert.ok(!has([fact({ tag: 'td', text: '1,200', numericOnly: false })], ctx(), 'R10'));
  assert.ok(has([fact({ tag: 'span', text: '12', fontSize: 20, lineHeight: 28, numericOnly: true })], ctx(), 'R10'));
});

test('fix1: R4 scroll branch with null lineHeight, and ink boundary', () => {
  const base = fact({ hasThai: true, overflowClip: 'y' });
  assert.ok(has([{ ...base, lineHeight: null, scrollOverflowY: true }], ctx(), 'R4'));
  assert.ok(!has([{ ...base, lineHeight: 16, inkHeight: 17 }], ctx(), 'R4'));
  assert.ok(has([{ ...base, lineHeight: 16, inkHeight: 17.5 }], ctx(), 'R4'));
  assert.ok(has([{ ...base, lineHeight: 22, inkHeight: 10, scrollOverflowY: true }], ctx(), 'R4'));
  assert.ok(!has([{ ...base, lineHeight: null }], ctx(), 'R3'));
});

test('fix1: R9 coerces string weights; web 300 ok, shop 300 flagged', () => {
  assert.ok(!has([fact({ fontWeight: '400' })], ctx(), 'R9'));
  assert.ok(!has([fact({ fontWeight: 300 })], ctx(), 'R9'));
  assert.ok(has([fact({ fontWeight: 300 })], ctx({ app: 'shop' }), 'R9'));
});

test('fix1: keyless facts get dup-indexed keys, shared by compareFacts', () => {
  const a = fact({ key: undefined, kind: 'button', text: 'ตกลง 1' });
  const b = fact({ key: undefined, kind: 'button', text: 'ตกลง 2' });
  const f = evaluateTypography([a, b], ctx()).filter((x) => x.rule === 'R1' || x.rule === 'R7');
  const keys = evaluateTypography([{ ...a, fontSize: 15 }, { ...b, fontSize: 15 }], ctx()).filter((x) => x.rule === 'R1').map((x) => x.key);
  assert.deepEqual(keys, ['button|ตกลง #|0', 'button|ตกลง #|1']);
  assert.ok(Array.isArray(f));
  const out = compareFacts([{ ...a, inkWidth: 100 }, { ...b, inkWidth: 100 }], [{ ...a, inkWidth: 100 }, { ...b, inkWidth: 130, text: 'ตกลง 2' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].key, 'button|ตกลง #|1');
});

test('fix1: D1 needs identical text; D2 thresholds', () => {
  const k = factKey('text', 'ยอด 1,200', 0);
  const b = fact({ key: k, text: 'ยอด 1,200', inkWidth: 100 });
  assert.equal(compareFacts([b], [{ ...b, text: 'ยอด 13,300', inkWidth: 130 }]).filter((d) => d.rule === 'D1').length, 0);
  const mkBtn = (textTop, h = 40) => fact({ kind: 'button', text: 'ตกลง', key: factKey('button', 'ตกลง', 0), y: 0, h, textTop, textHeight: 18 });
  // offset = textTop + 9 - h/2 ; before 2.0 -> after 2.4 (not worse by >0.5)
  assert.equal(compareFacts([mkBtn(13)], [mkBtn(13.4)]).filter((d) => d.rule === 'D2').length, 0);
  assert.equal(compareFacts([mkBtn(11)], [mkBtn(14, 41)]).filter((d) => d.rule === 'D2').length, 0);
  assert.equal(compareFacts([mkBtn(11)], [mkBtn(14)]).filter((d) => d.rule === 'D2').length, 1);
});

test('fix1: mutant-killers for R1/R2/R3/R6/R7', () => {
  assert.ok(!has([fact({ fontSize: 14.5, lineHeight: 22 })], ctx(), 'R1'));
  const h1 = fact({ kind: 'heading', text: 'a', headingLevel: 1, fontSize: 24, lineHeight: 32 });
  const h2 = fact({ kind: 'heading', text: 'b', headingLevel: 2, fontSize: 24, lineHeight: 32 });
  assert.ok(!has([h1, h2], ctx(), 'R2'));
  assert.ok(!has([fact({ fontSize: 24, lineHeight: 30 })], ctx(), 'R3'));
  assert.ok(!has([fact({ fontSize: 30, lineHeight: 39 })], ctx(), 'R3'));
  assert.ok(rules([fact({ fontSize: 24, lineHeight: 40 })], ctx()).includes('R3:P2'));
  assert.ok(rules([fact({ fontSize: 24, lineHeight: 27, hasThai: true })], ctx()).includes('R3:P1'));
  assert.ok(rules([fact({ kind: 'button', h: 32 })], ctx({ width: 1440 })).includes('R7:P2'));
  assert.ok(!has([fact({ kind: 'button', h: 20 })], ctx({ width: 600 }), 'R7'));
  assert.ok(!has([fact({ kind: 'th', overflowClip: 'none', scrollOverflowX: true })], ctx(), 'R6'));
  assert.ok(!has([fact({ kind: 'th', overflowClip: 'x', scrollOverflowX: false })], ctx(), 'R6'));
});
