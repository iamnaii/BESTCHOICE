// Field scale rules (spec docs/superpowers/specs/2026-11-14-dropdown-search-field-scale-design.md §5):
// pure evaluateFields tests with hand-made FieldFact fixtures (shape: collect.js __collectFields header).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateFields,
  evaluateTypography,
  findingKey,
  groupFieldRows,
  nearestCommonAncestor,
  sameFieldRow,
  verticalOverlapRatio,
} from './rules.mjs';

const GRID = { id: 1, layout: 'grid' };
const ctl = (o = {}) => ({
  type: 'control',
  id: 0,
  key: 'input|ชื่อลูกค้า|0',
  kind: 'input',
  tag: 'input',
  scope: 'main',
  ancestors: [{ id: 10, layout: 'other' }, GRID, { id: 2, layout: 'other' }],
  x: 0,
  y: 100,
  w: 200,
  h: 44,
  borderRadius: 8,
  borderWidth: 1,
  borderColor: 'rgb(212, 212, 216)',
  backgroundColor: 'rgb(255, 255, 255)',
  fontSize: 14,
  largeText: false,
  label: { fontSize: 14, gap: 12, above: true },
  contentLeft: 13,
  contentRight: 187,
  contentWidth: 174,
  placeholderInkWidth: null,
  optionCount: null,
  longestOptionInkWidth: null,
  valueOverflowX: false,
  valueOverflowY: false,
  adornments: [],
  ...o,
});
// two controls side by side in one grid (S1-04-like row)
const pair = (a = {}, b = {}) => [
  ctl({ id: 0, ancestors: [{ id: 10, layout: 'other' }, GRID], ...a }),
  ctl({
    id: 1,
    key: 'native-select|สาขา|0',
    kind: 'native-select',
    tag: 'select',
    x: 216,
    contentLeft: 229,
    contentRight: 375,
    contentWidth: 146,
    ancestors: [{ id: 11, layout: 'other' }, GRID],
    ...b,
  }),
];
const CTX = { route: '/x', width: 1440, theme: 'light', role: 'owner' };
const rulesOf = (facts) => evaluateFields(facts, CTX).map((f) => `${f.rule}:${f.severity}`);
const f1Findings = (facts) => evaluateFields(facts, CTX).filter((f) => f.rule === 'F1');
// properties that fired (one finding per inconsistent member, so a property can repeat)
const f1 = (facts) => [...new Set(f1Findings(facts).map((f) => f.detail.property))];
const f1Keys = (facts) => f1Findings(facts).map((f) => f.key);
const tgt = (o = {}) => ({
  type: 'target',
  id: 0,
  key: 'target-button|บันทึก|0',
  role: 'button',
  scope: 'main',
  scroller: null,
  targetAncestors: [],
  x: 0,
  y: 0,
  w: 100,
  h: 44,
  coveredBy: null,
  ...o,
});
const two = (a = {}, b = {}) => [
  tgt({ id: 0, ...a }),
  tgt({ id: 1, key: 'target-button|ยกเลิก|0', x: 90, y: 10, ...b }),
];

test('a matched row has no findings', () => {
  assert.deepEqual(evaluateFields(pair(), CTX), []);
  assert.deepEqual(evaluateFields([], CTX), []);
});

test('row = same scope + ≥50% vertical overlap + nearest common ancestor flex-row or grid', () => {
  const [a, b] = pair();
  assert.equal(nearestCommonAncestor(a, b).id, 1);
  assert.equal(sameFieldRow(a, b), true);
  const withLayout = (layout) => {
    const common = { id: 1, layout };
    return sameFieldRow(
      { ...a, ancestors: [{ id: 10, layout: 'other' }, common] },
      { ...b, ancestors: [{ id: 11, layout: 'other' }, common] },
    );
  };
  assert.equal(withLayout('flex-row'), true);
  assert.equal(withLayout('flex-col'), false);
  assert.equal(withLayout('other'), false);
  assert.equal(sameFieldRow(a, { ...b, scope: 'dialog:0' }), false);
  assert.equal(sameFieldRow(a, { ...b, ancestors: [{ id: 99, layout: 'grid' }] }), false);
  // 22px of 44px overlap = exactly 50% ⇒ row; 21px ⇒ not
  assert.equal(verticalOverlapRatio(a, { ...b, y: 122 }), 0.5);
  assert.equal(sameFieldRow(a, { ...b, y: 122 }), true);
  assert.equal(sameFieldRow(a, { ...b, y: 123 }), false);
});

test('F1 height > 2px and bottom edge > 2px (S2-07: 31px beside 44px)', () => {
  assert.deepEqual(f1(pair({}, { h: 31 })), ['height', 'bottom']);
  assert.deepEqual(f1(pair({}, { h: 42 })), [], '2px is within tolerance');
  // same height, shifted 5px (S3-04 bottom misaligned)
  assert.deepEqual(f1(pair({}, { y: 105 })), ['bottom']);
});

test('F1 radius > 1px and font size > 0.5px', () => {
  assert.deepEqual(f1(pair({}, { borderRadius: 6 })), ['radius']);
  assert.deepEqual(f1(pair({}, { borderRadius: 7 })), []);
  assert.deepEqual(f1(pair({}, { fontSize: 13 })), ['fontSize']);
  assert.deepEqual(f1(pair({}, { fontSize: 14.5 })), []);
});

test('F1 border colour differs and background differs (S1-01 bg-input, S1-04)', () => {
  assert.deepEqual(f1(pair({}, { borderColor: 'rgb(161, 161, 170)' })), ['borderColor']);
  assert.deepEqual(f1(pair({}, { borderColor: 'none', borderWidth: 0 })), ['borderColor']);
  assert.deepEqual(f1(pair({}, { backgroundColor: 'rgba(0, 0, 0, 0)' })), ['background']);
  // ReadOnlyField's intended darker fill is not a background mismatch (its height/radius still are).
  assert.deepEqual(f1(pair({}, { kind: 'readonly', backgroundColor: 'rgb(240, 240, 240)' })), []);
});

test('F1 label font > 0.5px or label gap > 2px; labels not above or missing are skipped', () => {
  assert.deepEqual(f1(pair({}, { label: { fontSize: 12, gap: 6, above: true } })), [
    'labelFontSize',
    'labelGap',
  ]);
  assert.deepEqual(f1(pair({}, { label: { fontSize: 14, gap: 14, above: true } })), []);
  assert.deepEqual(f1(pair({}, { label: { fontSize: 12, gap: -20, above: false } })), []);
  assert.deepEqual(f1(pair({}, { label: null })), []);
});

test('F1 exclusions: text-lg+ control, textarea', () => {
  assert.deepEqual(f1(pair({}, { h: 56, fontSize: 18, largeText: true })), []);
  assert.deepEqual(f1(pair({}, { kind: 'textarea', tag: 'textarea', h: 96 })), []);
});

test('F1 groups a row; one finding per inconsistent member, row context in text/detail', () => {
  const third = ctl({
    id: 2,
    key: 'field-frame|ราคา|0',
    kind: 'field-frame',
    tag: 'div',
    x: 432,
    h: 31,
    ancestors: [{ id: 12, layout: 'other' }, GRID],
  });
  const facts = [...pair(), third];
  assert.deepEqual(
    groupFieldRows(facts).map((row) => row.map((c) => c.id)),
    [[0, 1, 2]],
  );
  // 44 / 44 / 31: only the odd member is reported, for height and for its bottom edge
  assert.deepEqual(f1Keys(facts), ['height@field-frame|ราคา|0', 'bottom@field-frame|ราคา|0']);
  const height = f1Findings(facts).find((f) => f.detail.property === 'height');
  assert.equal(height.rule, 'F1');
  assert.equal(height.severity, 'P2');
  assert.equal(
    height.text,
    'field-frame|ราคา|0 (row: input|ชื่อลูกค้า|0 / native-select|สาขา|0 / field-frame|ราคา|0)',
  );
  assert.deepEqual(height.detail, {
    property: 'height',
    value: 31,
    spread: 13,
    tolerance: 2,
    members: [
      { key: 'input|ชื่อลูกค้า|0', value: 44 },
      { key: 'native-select|สาขา|0', value: 44 },
      { key: 'field-frame|ราคา|0', value: 31 },
    ],
  });
  assert.equal(findingKey(height), '/x|1440|light|owner|F1|height@field-frame|ราคา|0');
  // distinct checks carry the member's value and the row, no spread/tolerance
  const border = f1Findings([...pair(), { ...third, h: 44, borderColor: 'rgb(1, 2, 3)' }]);
  assert.deepEqual(
    border.map((f) => f.key),
    ['borderColor@field-frame|ราคา|0'],
  );
  assert.deepEqual(border[0].detail, {
    property: 'borderColor',
    value: 'rgb(1, 2, 3)',
    members: [
      { key: 'input|ชื่อลูกค้า|0', value: 'rgb(212, 212, 216)' },
      { key: 'native-select|สาขา|0', value: 'rgb(212, 212, 216)' },
      { key: 'field-frame|ราคา|0', value: 'rgb(1, 2, 3)' },
    ],
  });
  // a second row further down is its own group
  const lower = pair({ id: 3, y: 300 }, { id: 4, y: 300 });
  assert.equal(groupFieldRows([...facts, ...lower]).length, 2);
});

test('F1 with no majority reports every member; a tolerance cluster is the majority', () => {
  // two members that disagree: either could be the odd one, so both are reported
  assert.deepEqual(f1Keys(pair({}, { borderRadius: 6 })), [
    'radius@input|ชื่อลูกค้า|0',
    'radius@native-select|สาขา|0',
  ]);
  // 44 / 45 / 31: 44 and 45 agree within 2px, 31 is the odd one
  const row = [
    ...pair({}, { h: 45 }),
    ctl({
      id: 2,
      key: 'input|ราคา|0',
      x: 432,
      h: 31,
      ancestors: [{ id: 12, layout: 'other' }, GRID],
    }),
  ];
  assert.deepEqual(
    f1Keys(row).filter((k) => k.startsWith('height@')),
    ['height@input|ราคา|0'],
  );
});

test('F1 keys of unchanged members survive fixing or relabelling another member (--compare)', () => {
  const at = (id, x, o) =>
    ctl({ id, x, ancestors: [{ id: 10 + id, layout: 'other' }, GRID], ...o });
  // A, B match; C is a fake 31px field-frame with a light border; D is a 38px input
  const A = at(0, 0, { key: 'input|ชื่อลูกค้า|0' });
  const B = at(1, 216, { key: 'native-select|สาขา|0', kind: 'native-select', tag: 'select' });
  const C = at(2, 432, {
    key: 'field-frame|ก่อนภาษี|0',
    kind: 'field-frame',
    tag: 'div',
    h: 31,
    borderColor: 'rgb(228, 228, 231)',
  });
  const D = at(3, 648, { key: 'input|ส่วนลด|0', h: 38 });
  const before = f1Keys([A, B, C, D]);
  assert.deepEqual(before, [
    'height@field-frame|ก่อนภาษี|0',
    'height@input|ส่วนลด|0',
    'borderColor@field-frame|ก่อนภาษี|0',
    'bottom@field-frame|ก่อนภาษี|0',
    'bottom@input|ส่วนลด|0',
  ]);
  // C becomes a ReadOnlyField: new kind, new key, 44px, same border ⇒ C's findings are gone and
  // D's still-unfixed findings keep exactly the same keys (not reported as new by --compare)
  const fixedC = {
    ...C,
    key: 'readonly|ก่อนภาษี|0',
    kind: 'readonly',
    tag: 'input',
    h: 44,
    borderColor: A.borderColor,
    backgroundColor: 'rgb(244, 244, 245)',
  };
  const afterFix = f1Keys([A, B, fixedC, D]);
  assert.deepEqual(afterFix, ['height@input|ส่วนลด|0', 'bottom@input|ส่วนลด|0']);
  assert.ok(
    afterFix.every((k) => before.includes(k)),
    'no unchanged member gets a new key',
  );
  // renaming B's label and changing its kind does not touch the other members' keys either
  const renamedB = {
    ...B,
    key: 'select-trigger|สาขาที่ขาย|0',
    kind: 'select-trigger',
    tag: 'button',
  };
  assert.deepEqual(f1Keys([A, renamedB, C, D]), before);
});

test('F2 placeholder wider than the content box (canvas ink vs content width + 1)', () => {
  const [a] = pair({ placeholderInkWidth: 180 });
  assert.deepEqual(rulesOf([a]), ['F2:P2']);
  assert.deepEqual(evaluateFields([a], CTX)[0].detail, {
    sub: 'placeholder',
    inkWidth: 180,
    contentWidth: 174,
  });
  assert.deepEqual(rulesOf([{ ...a, placeholderInkWidth: 175 }]), []);
  assert.deepEqual(rulesOf([{ ...a, kind: 'textarea', placeholderInkWidth: 500 }]), []);
});

test('F2 native select: longest option wider than the content box (numbers only)', () => {
  const [, b] = pair({}, { longestOptionInkWidth: 200, optionCount: 12 });
  const [finding] = evaluateFields([b], CTX);
  assert.equal(finding.key, 'option@native-select|สาขา|0');
  assert.deepEqual(finding.detail, {
    sub: 'option',
    inkWidth: 200,
    contentWidth: 146,
    optionCount: 12,
  });
  assert.deepEqual(rulesOf([{ ...b, longestOptionInkWidth: 147 }]), []);
  assert.deepEqual(rulesOf([{ ...b, kind: 'input' }]), [], 'only native selects');
});

test('F2 Radix select-value overflow on either axis', () => {
  const trigger = ctl({ kind: 'select-trigger', tag: 'button', key: 'select-trigger|สถานะ|0' });
  assert.deepEqual(rulesOf([{ ...trigger, valueOverflowX: true }]), ['F2:P2']);
  assert.deepEqual(rulesOf([{ ...trigger, valueOverflowY: true }]), ['F2:P2']);
  assert.deepEqual(evaluateFields([{ ...trigger, valueOverflowY: true }], CTX)[0].detail, {
    sub: 'value',
    overflowX: false,
    overflowY: true,
  });
  assert.deepEqual(rulesOf([trigger]), []);
});

test('F3 two interactive boxes overlap > 1px: P2, P1 when one covers the other centre', () => {
  assert.deepEqual(rulesOf(two()), ['F3:P2']);
  assert.deepEqual(evaluateFields(two(), CTX)[0].detail, {
    overlapX: 10,
    overlapY: 34,
    covered: false,
  });
  assert.deepEqual(rulesOf(two({ coveredBy: 1 })), ['F3:P1']);
  assert.deepEqual(rulesOf(two({}, { coveredBy: 0 })), ['F3:P1']);
  assert.deepEqual(rulesOf(two({}, { x: 99 })), [], 'exactly 1px is not an overlap');
});

test('F3 skips ancestor/descendant, other scroll containers, dialog vs page, contained boxes', () => {
  assert.deepEqual(rulesOf(two({}, { targetAncestors: [0] })), []);
  assert.deepEqual(rulesOf(two({ scroller: 3 })), []);
  assert.deepEqual(rulesOf(two({ scope: 'dialog:0' })), []);
  assert.deepEqual(rulesOf(two({ scope: 'page' })), ['F3:P2'], 'page chrome vs #main still counts');
  const inner = { x: 70, y: 10, w: 24, h: 24 };
  assert.deepEqual(rulesOf(two({}, inner)), [], 'contained: left to F4');
  assert.deepEqual(rulesOf(two({ coveredBy: 1 }, inner)), ['F3:P1'], 'contained but covering');
});

test('F4 absolute adornment inside the content box or over the text ink', () => {
  // NativeSelect geometry: pr-10 ⇒ content right at 159; chevron at 171..187 ⇒ no finding
  const select = ctl({
    kind: 'native-select',
    contentLeft: 13,
    contentRight: 159,
    contentWidth: 146,
    longestOptionInkWidth: 120,
    adornments: [{ x: 171, y: 114, w: 16, h: 16, side: 'right' }],
  });
  assert.deepEqual(rulesOf([select]), []);
  // clear button at 150..174 with pr-3 ⇒ 9px short; placeholder ink to 158 overlaps 8px
  const cleared = ctl({
    contentLeft: 13,
    contentRight: 159,
    contentWidth: 146,
    placeholderInkWidth: 145,
    adornments: [{ x: 150, y: 110, w: 24, h: 24, side: 'right' }],
  });
  const [right] = evaluateFields([cleared], CTX);
  assert.equal(right.key, 'right0@input|ชื่อลูกค้า|0');
  assert.deepEqual(right.detail, { side: 'right', reserveShort: 9, inkOverlap: 8 });
  // leading icon 12..28 with pl-9 (content from 37) ⇒ fine; with pl-3 (content from 13) ⇒ F4
  const icon = { x: 12, y: 114, w: 16, h: 16, side: 'left' };
  assert.deepEqual(rulesOf([ctl({ contentLeft: 37, adornments: [icon] })]), []);
  assert.deepEqual(evaluateFields([ctl({ contentLeft: 13, adornments: [icon] })], CTX)[0].detail, {
    side: 'left',
    reserveShort: 15,
    inkOverlap: 0,
  });
});

test('evaluateFields ignores typography facts and leaves evaluateTypography alone', () => {
  assert.deepEqual(evaluateFields([{ kind: 'text', text: 'ข้อความ' }], CTX), []);
  assert.equal(typeof evaluateTypography, 'function');
});
