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
  const keys = evaluateTypography([{ ...a, fontSize: 15 }, { ...b, fontSize: 15 }], ctx()).filter((x) => x.rule === 'R1').map((x) => x.key);
  assert.deepEqual(keys, ['button|ตกลง #|0', 'button|ตกลง #|1']);
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

test('fix2: resolveKeys — keyed facts count toward dup, explicit keys verbatim, scoped by kind', () => {
  const keyed = fact({ kind: 'button', text: 'ตกลง', key: 'button|ตกลง|0', fontSize: 15 });
  const keyless = fact({ kind: 'button', text: 'ตกลง', key: undefined, fontSize: 15 });
  const keys = evaluateTypography([keyed, keyless], ctx()).filter((f) => f.rule === 'R1').map((f) => f.key);
  assert.deepEqual(keys, ['button|ตกลง|0', 'button|ตกลง|1']);
  const fixture = fact({ kind: 'button', text: 'ตกลง', key: 'button|ตกลง|3', fontSize: 15 });
  assert.equal(evaluateTypography([fixture], ctx()).find((f) => f.rule === 'R1').key, 'button|ตกลง|3');
  const a = fact({ kind: 'button', text: 'a', key: undefined, fontSize: 15 });
  const b = fact({ kind: 'text', text: 'a', key: undefined, fontSize: 15 });
  assert.deepEqual(evaluateTypography([a, b], ctx()).filter((f) => f.rule === 'R1').map((f) => f.key), ['button|a|0', 'text|a|0']);
});

test('fix2: escalated ranks', () => {
  const mk = (severity) => ({ rule: 'R3', severity, route: '/x', width: 1, theme: 't', role: 'r', key: 'k', text: '', detail: {} });
  const esc = (b, a) => diffFindings([mk(b)], [mk(a)]).escalated.length;
  assert.equal(esc('P2', 'P2'), 0);
  assert.equal(esc('P3', 'P2'), 1);
  assert.equal(esc('P3', 'P1'), 1);
  assert.equal(esc('P1', 'P3'), 0);
});

test('fix2: diffFindings tolerates null/undefined options', () => {
  assert.doesNotThrow(() => diffFindings([], [], null));
  assert.doesNotThrow(() => diffFindings([], [], undefined));
});

test('fix2: R4 ink branch needs finite lineHeight; scroll needs Thai + vertical clip', () => {
  const base = fact({ hasThai: true, overflowClip: 'y', lineHeight: null, inkHeight: 30, scrollOverflowY: false });
  assert.ok(!has([base], ctx(), 'R4'));
  assert.ok(has([{ ...base, overflowClip: 'both', scrollOverflowY: true }], ctx(), 'R4'));
  assert.ok(!has([{ ...base, hasThai: false, scrollOverflowY: true }], ctx(), 'R4'));
});

test('fix2: R10 trusts the numericOnly flag even for truncated text', () => {
  assert.ok(rules([fact({ tag: 'td', text: '1,2…', numericOnly: true })], ctx()).includes('R10:P3'));
});

test('fix2: D1 gated on raw text; differing text still eligible for D2', () => {
  const key = factKey('text', 'ยอด 1,200', 0);
  const b = fact({ key, text: 'ยอด 1,200', inkWidth: 100 });
  assert.equal(compareFacts([b], [{ ...b, text: 'ยอด 1,300', inkWidth: 130 }]).filter((d) => d.rule === 'D1').length, 0);
  assert.equal(compareFacts([b], [{ ...b, inkWidth: 130 }]).filter((d) => d.rule === 'D1').length, 1);
  const btn = (text, textTop) => fact({ kind: 'button', text, key: 'button|k|0', y: 0, h: 40, textTop, textHeight: 18 });
  const out = compareFacts([btn('ยอด 1', 11)], [btn('ยอด 2', 14)]);
  assert.deepEqual(out.map((d) => d.rule), ['D2']);
});

test('fix2: R3 epsilon is float-noise only', () => {
  assert.ok(rules([fact({ fontSize: 14, lineHeight: 19.53 })], ctx()).includes('R3:P2'));
  assert.ok(!has([fact({ fontSize: 12, lineHeight: 12 * 1.4 })], ctx(), 'R3'));
  assert.ok(rules([fact({ fontSize: 20, lineHeight: 23.9, hasThai: true })], ctx()).includes('R3:P1'));
});

test('fix2: D2 fixed-height guard boundary at 0.5px', () => {
  const btn = (h, textTop) => fact({ kind: 'button', text: 'ตกลง', key: 'button|ตกลง|0', y: 0, h, textTop, textHeight: 18 });
  // before: offset 0 (h 40, textTop 11); after offset = textTop + 9 - h/2
  const d2 = (hAfter) => compareFacts([btn(40, 11)], [btn(hAfter, 14 + (hAfter - 40) / 2)]).filter((d) => d.rule === 'D2').length;
  assert.equal(d2(40.5), 1);
  assert.equal(d2(40.51), 0);
});

test('fix2: compareFacts ctx cannot override delta fields', () => {
  const k = 'button|ตกลง|0';
  const b = fact({ kind: 'button', text: 'ตกลง', key: k, y: 0, h: 40, textTop: 11, textHeight: 18, inkWidth: 100 });
  const a = { ...b, inkWidth: 130, textTop: 14 };
  const out = compareFacts([b], [a], { rule: 'X', key: 'K', kind: 'Z', text: 'T', detail: 'D', route: '/r' });
  assert.deepEqual(out.map((d) => d.rule).sort(), ['D1', 'D2']);
  for (const d of out) {
    assert.equal(d.key, k);
    assert.equal(d.kind, 'button');
    assert.equal(d.text, 'ตกลง');
    assert.equal(typeof d.detail, 'object');
    assert.equal(d.route, '/r');
  }
});

// ---- fix round 3: pin D1/D2 thresholds and remaining edges ----
// offset = textTop + textHeight/2 - (y + h/2); with y 0, h 40, textHeight 18: offset = textTop - 11
const ctl = (kind, offset, o = {}) => fact({
  kind, text: 'ตกลง', key: `${kind}|ตกลง|0`, y: 0, h: 40, textTop: 11 + offset, textHeight: 18, ...o,
});
const d2count = (kind, from, to) => compareFacts([ctl(kind, from)], [ctl(kind, to)]).filter((d) => d.rule === 'D2').length;

test('fix3: D2 threshold at 1.5px', () => {
  assert.equal(d2count('button', 0, 1.0), 0);
  assert.equal(d2count('button', 0, 1.6), 1);
});

test('fix3: D2 kind gate (Ruling C)', () => {
  assert.equal(d2count('paragraph', 0, 3), 0);
  assert.equal(d2count('badge', 0, 3), 1);
  assert.equal(d2count('th', 0, 3), 0);
});

test('fix3: D2 uses abs offset and the y term', () => {
  assert.equal(d2count('button', 0, -2), 1);
  const b = ctl('button', 0, { y: 500 });
  const a = ctl('button', 0, { y: 501, textTop: 12 });
  assert.equal(compareFacts([b], [a]).filter((d) => d.rule === 'D2').length, 0);
});

test('fix3: D1 boundary, direction, zero guard', () => {
  const d1 = (from, to) => compareFacts([fact({ key: 'k', inkWidth: from })], [fact({ key: 'k', inkWidth: to })]).filter((d) => d.rule === 'D1').length;
  assert.equal(d1(100, 108), 0);
  assert.equal(d1(100, 91), 1);
  assert.equal(d1(0, 50), 0);
});

test('fix3: R4 requires vertical clip', () => {
  const base = fact({ hasThai: true, scrollOverflowY: true, lineHeight: 22 });
  assert.ok(!has([{ ...base, overflowClip: 'none' }], ctx(), 'R4'));
  assert.ok(!has([{ ...base, overflowClip: 'x' }], ctx(), 'R4'));
});

test('fix3: isNumericOnly rejects mixed text', () => {
  assert.equal(isNumericOnly('ยอด 1'), false);
});

test('fix3: compareFacts pairs keyed + keyless facts by resolved key', () => {
  const keyed = fact({ kind: 'button', text: 'ตกลง', key: 'button|ตกลง|0', inkWidth: 100 });
  const keyless = fact({ kind: 'button', text: 'ตกลง', key: undefined, inkWidth: 100 });
  const out = compareFacts([keyed, keyless], [keyed, { ...keyless, inkWidth: 130 }]).filter((d) => d.rule === 'D1');
  assert.equal(out.length, 1);
  assert.equal(out[0].key, 'button|ตกลง|1');
});

test('fix3: R3 Thai exactly 1.2 passes', () => {
  assert.ok(!has([fact({ fontSize: 20, lineHeight: 24, hasThai: true })], ctx(), 'R3'));
  assert.ok(!has([fact({ fontSize: 30, lineHeight: 36, hasThai: true })], ctx(), 'R3'));
});

test('fix3: R9 detail carries numeric weight', () => {
  const f = evaluateTypography([fact({ fontWeight: '800' })], ctx()).find((x) => x.rule === 'R9');
  assert.equal(f.detail.fontWeight, 800);
});

// ---- Task 2 fix round 1 (Rulings W and item 7) ----

test('fixr1: D2 uses the real ink centre when inkTop/inkBottom are finite (Ruling W)', () => {
  const k = 'button|ตกลง|0';
  const btn = (o) => fact({ kind: 'button', text: 'ตกลง', key: k, y: 0, h: 40, textTop: 11, textHeight: 18, ...o });
  // ink centre (14+26)/2 = 20 = box centre → offset 0; after (16+28)/2 = 22 → offset 2.0; text rects unchanged
  const fired = compareFacts([btn({ inkTop: 14, inkBottom: 26 })], [btn({ inkTop: 16, inkBottom: 28 })]).filter((d) => d.rule === 'D2');
  assert.equal(fired.length, 1);
  assert.equal(fired[0].detail.beforeOffset, 0);
  assert.equal(fired[0].detail.afterOffset, 2);
  // only textTop moves (fallback formula would give offset 4) but the ink stays centred → no D2
  const quiet = compareFacts([btn({ inkTop: 14, inkBottom: 26 })], [btn({ textTop: 15, inkTop: 14, inkBottom: 26 })]);
  assert.equal(quiet.filter((d) => d.rule === 'D2').length, 0);
});

test('fixr1: D2 falls back to the text-rect centre when an ink field is missing or non-finite', () => {
  const k = 'button|ตกลง|0';
  const btn = (o) => fact({ kind: 'button', text: 'ตกลง', key: k, y: 0, h: 40, textTop: 11, textHeight: 18, ...o });
  for (const partial of [{ inkTop: null, inkBottom: 26 }, { inkTop: 14 }, { inkTop: NaN, inkBottom: NaN }]) {
    const out = compareFacts([btn({})], [btn({ textTop: 15, ...partial })]).filter((d) => d.rule === 'D2');
    assert.equal(out.length, 1, JSON.stringify(partial));
    assert.equal(out[0].detail.afterOffset, 4);
  }
});

test('fixr1: UI_FONT_RE / SARABUN_RE accept a lone family and still reject look-alikes (item 7)', () => {
  assert.ok(!has([fact({ fontFamily: "'Noto Sans Thai'" })], ctx(), 'R8'));
  assert.ok(!has([fact({ fontFamily: 'Noto Sans Thai' })], ctx(), 'R8'));
  assert.ok(rules([fact({ fontFamily: '"Noto Sans Thai Looped", sans-serif' })], ctx()).includes('R8:P1'));
  assert.ok(rules([fact({ fontFamily: '"Noto Sans Thai Looped"' })], ctx()).includes('R8:P1'));
  assert.ok(!has([fact({ fontFamily: 'Sarabun', inReadingBlock: true })], ctx({ app: 'shop' }), 'R8'));
  assert.ok(has([fact({ fontFamily: '"Sarabun New", serif', inReadingBlock: true })], ctx({ app: 'shop' }), 'R8'));
});
