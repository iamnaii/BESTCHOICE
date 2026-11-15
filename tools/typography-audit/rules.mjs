// Typography audit — pure decision layer (no browser, no app imports).
// Consumes Fact[] from the in-page collector; produces Finding[] / DeltaFinding[].

export const SCALE_TOLERANCE_PX = 0.5;
export const PROFILES = {
  web: {
    scale: [12, 13, 14, 16, 18, 20, 22, 24, 30, 36],
    weights: [300, 400, 500, 600, 700],
    sarabunInReadingBlock: false,
  },
  shop: {
    scale: [12, 14, 16, 18, 20, 24, 30, 36, 48],
    weights: [400, 500, 600, 700],
    sarabunInReadingBlock: true,
  },
};

// first family must be exactly this name: followed by ',' or end of the list (a lone family is fine;
// look-alikes such as "Noto Sans Thai Looped" are not)
export const UI_FONT_RE = /^["']?Noto Sans Thai["']?(,|$)/;
export const SARABUN_RE = /^["']?Sarabun["']?(,|$)/;
export const NUMERIC_ONLY_RE = /^[\d,.\s฿%+\-–/]+$/;
// numeric-only = plan regex AND at least one ASCII digit ('-', '/', '–' placeholders are not numbers).
// The collector computes Fact.numericOnly with these semantics; R10 trusts the flag only.
export const isNumericOnly = (text) => NUMERIC_ONLY_RE.test(text) && /[0-9]/.test(text);
// Thai text = Thai letters, vowels, tone marks, signs and Thai digits (U+0E01–U+0E3A, U+0E40–U+0E5B).
// U+0E3F "฿" sits in the Thai block but is a currency sign: "฿12,126.64" is an amount, not Thai text.
// Fact.hasThai (collector, whole Thai block) is still required — Thai-only rules use isThaiText.
export const THAI_TEXT_RE = /[ก-ฺเ-๛]/;
export const isThaiText = (f) => Boolean(f.hasThai) && THAI_TEXT_RE.test(String(f.text ?? ''));
export const NON_DIFF_RULES = ['R8'];
const SEVERITY_RANK = { P3: 1, P2: 2, P1: 3 };

// Thresholds follow the house style (owner decision 2026-11-08, Ruling AF / canvas item 5):
// Thai UI text uses Tailwind `leading-snug` (×1.375, .claude/rules/frontend.md), so R3's small band
// starts just under it; desktop controls are 32–34px (sidebar items 32–34px, shadcn md
// Button/SelectTrigger 34px), so R7's desktop minimum is 32px. Mobile stays 44px; Thai < ×1.2 stays P1.
export const HOUSE_LEADING_SNUG = 1.375;
export const LH_SMALL_MIN_HOUSE_STYLE = 1.35;
export const TOUCH_MIN_DESKTOP_HOUSE_STYLE = 32;

export const LH_SMALL_MAX_FONT = 20; // < 20px uses the small range
export const LH_SMALL_RANGE = [LH_SMALL_MIN_HOUSE_STYLE, 1.8];
export const LH_LARGE_RANGE = [1.2, 1.6];
export const LH_THAI_MIN = 1.2;
export const LH_EPSILON = 1e-6; // float noise only; spec has no tolerance
export const INK_CLIP_SLACK_PX = 1;
// Fact.truncation values (collector) that mean "cut on purpose, with an ellipsis"
export const INTENTIONAL_TRUNCATION = ['clamp', 'ellipsis'];
export const DESKTOP_MIN_WIDTH = 1024; // R5 P1 at/above
export const MOBILE_MAX_WIDTH = 430;
export const TABLET_MIN_WIDTH = 768;
export const TOUCH_MIN_MOBILE = 44;
export const TOUCH_MIN_DESKTOP = TOUCH_MIN_DESKTOP_HOUSE_STYLE;
export const INPUT_MIN_FONT_MOBILE = 16;
export const TNUM_MIN_FONT = 20;
export const ICON_RATIO_RANGE = [0.85, 1.6];
export const MEASURE_MIN_WIDTH = 1280;
export const MEASURE_MAX_EM = 45;
export const D1_INK_WIDTH_CHANGE = 0.08;
export const D2_OFFSET_PX = 1.5;
export const D2_WORSE_BY_PX = 0.5;
export const D2_FIXED_HEIGHT_PX = 0.5;

export const R5_KINDS = ['button', 'badge', 'th', 'nav', 'tab'];
export const R6_KINDS = ['button', 'badge', 'th', 'nav', 'tab', 'label'];
export const R7_KINDS = ['button', 'input'];
export const D2_KINDS = ['button', 'badge', 'input', 'tab'];

// ---- key (reference implementation; the in-page collector must replicate exactly) ----
// normalizeKeyText: collapse whitespace runs to one space, trim, replace EVERY digit (0-9)
// with '#', keep the first 40 characters (UTF-16 code units, i.e. String.slice(0, 40)).
// factKey: `${kind}|${normalizeKeyText(text)}|${dup}` where dup = 0-based index among facts
// on the page with the same kind + normalized text.
export const normalizeKeyText = (text) =>
  String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[0-9]/g, '#')
    .slice(0, 40);
export const factKey = (kind, text, dup) => `${kind}|${normalizeKeyText(text)}|${dup}`;
export const findingKey = (f) => `${f.route}|${f.width}|${f.theme}|${f.role}|${f.rule}|${f.key}`;

// Shared key resolver (evaluateTypography + compareFacts): fact.key when present, else
// factKey(kind, text, dup) with dup = count of earlier facts of same kind + normalized text.
export function resolveKeys(facts) {
  const seen = new Map();
  return facts.map((f) => {
    const base = `${f.kind}|${normalizeKeyText(f.text)}`;
    const dup = seen.get(base) ?? 0;
    seen.set(base, dup + 1);
    return f.key ? f.key : factKey(f.kind, f.text, dup);
  });
}

const inRange = (v, [lo, hi]) => v >= lo - LH_EPSILON && v <= hi + LH_EPSILON;
const finite = (n) => Number.isFinite(n);

export function evaluateTypography(facts, ctx) {
  const profile = PROFILES[ctx.app];
  const out = [];
  const keys = resolveKeys(facts);
  const h1Max = Math.max(0, ...facts.filter((f) => f.headingLevel === 1).map((f) => f.fontSize));

  for (const [i, f] of facts.entries()) {
    const thai = isThaiText(f);
    const emit = (rule, severity, detail) =>
      out.push({
        rule,
        severity,
        route: ctx.route,
        width: ctx.width,
        theme: ctx.theme,
        role: ctx.role,
        key: keys[i],
        text: f.text,
        detail,
      });

    // R1
    if (!profile.scale.some((s) => Math.abs(s - f.fontSize) <= SCALE_TOLERANCE_PX)) {
      emit('R1', 'P3', { fontSize: f.fontSize, scale: profile.scale });
    }
    // R2 (Ruling E)
    if (
      (f.headingLevel === 2 || f.headingLevel === 3) &&
      h1Max > 0 &&
      f.fontSize > h1Max + SCALE_TOLERANCE_PX
    ) {
      emit('R2', 'P2', { headingLevel: f.headingLevel, fontSize: f.fontSize, h1FontSize: h1Max });
    }
    // R3 (Ruling F)
    if (finite(f.lineHeight) && f.fontSize > 0) {
      const ratio = f.lineHeight / f.fontSize;
      const range = f.fontSize < LH_SMALL_MAX_FONT ? LH_SMALL_RANGE : LH_LARGE_RANGE;
      if (thai && ratio < LH_THAI_MIN - LH_EPSILON) {
        emit('R3', 'P1', {
          ratio,
          fontSize: f.fontSize,
          lineHeight: f.lineHeight,
          min: LH_THAI_MIN,
        });
      } else if (!inRange(ratio, range)) {
        emit('R3', 'P2', { ratio, fontSize: f.fontSize, lineHeight: f.lineHeight, range });
      }
    }
    // R4 (Ruling G)
    if (thai && (f.overflowClip === 'y' || f.overflowClip === 'both')) {
      // scroll branch fires even with non-finite lineHeight; only the ink branch needs it
      const inkOverflow = finite(f.lineHeight) && f.inkHeight > f.lineHeight + INK_CLIP_SLACK_PX;
      // intentional truncation with an ellipsis (line-clamp / text-overflow) hides whole lines or
      // the line end, not Thai marks — skip the scroll branch (R6 covers horizontal ellipsis).
      // Facts without the field (older JSON) behave as before.
      const truncated = INTENTIONAL_TRUNCATION.includes(f.truncation);
      if (inkOverflow || (f.scrollOverflowY && !truncated)) {
        emit('R4', 'P1', {
          inkHeight: f.inkHeight,
          lineHeight: f.lineHeight,
          scrollOverflowY: f.scrollOverflowY,
          overflowClip: f.overflowClip,
        });
      }
    }
    // R5 (Ruling D)
    if (R5_KINDS.includes(f.kind) && f.lines >= 2) {
      emit('R5', ctx.width >= DESKTOP_MIN_WIDTH ? 'P1' : 'P2', { kind: f.kind, lines: f.lines });
    }
    // R6
    if (
      R6_KINDS.includes(f.kind) &&
      (f.overflowClip === 'x' || f.overflowClip === 'both') &&
      f.scrollOverflowX
    ) {
      emit('R6', 'P2', { kind: f.kind, overflowClip: f.overflowClip, w: f.w });
    }
    // R7 / R7b (Ruling N)
    if (R7_KINDS.includes(f.kind)) {
      const min =
        ctx.width <= MOBILE_MAX_WIDTH
          ? TOUCH_MIN_MOBILE
          : ctx.width >= TABLET_MIN_WIDTH
            ? TOUCH_MIN_DESKTOP
            : null;
      if (min !== null && f.h < min) emit('R7', 'P2', { kind: f.kind, h: f.h, min });
    }
    if (f.kind === 'input' && ctx.width <= MOBILE_MAX_WIDTH && f.fontSize < INPUT_MIN_FONT_MOBILE) {
      emit('R7b', 'P2', { fontSize: f.fontSize, min: INPUT_MIN_FONT_MOBILE });
    }
    // R8
    const familyOk =
      UI_FONT_RE.test(f.fontFamily) ||
      (profile.sarabunInReadingBlock && f.inReadingBlock && SARABUN_RE.test(f.fontFamily));
    if (!familyOk) emit('R8', 'P1', { fontFamily: f.fontFamily, inReadingBlock: f.inReadingBlock });
    // R9
    const weight = Number(f.fontWeight);
    if (!profile.weights.includes(weight))
      emit('R9', 'P3', { fontWeight: weight, weights: profile.weights });
    // R10 (Ruling M: f.numeric = tabular-nums active; numericOnly flag is the single source)
    if (f.numericOnly && (f.tag === 'td' || f.fontSize >= TNUM_MIN_FONT) && !f.numeric) {
      emit('R10', 'P3', { tag: f.tag, fontSize: f.fontSize });
    }
    // R11
    const badIcons = (f.iconRatios ?? []).filter(
      (r) => r < ICON_RATIO_RANGE[0] || r > ICON_RATIO_RANGE[1],
    );
    if (badIcons.length)
      emit('R11', 'P3', {
        iconRatios: f.iconRatios,
        outOfRange: badIcons,
        range: ICON_RATIO_RANGE,
      });
    // R12
    if (
      f.kind === 'paragraph' &&
      f.lines >= 2 &&
      ctx.width >= MEASURE_MIN_WIDTH &&
      f.w > MEASURE_MAX_EM * f.fontSize
    ) {
      emit('R12', 'P3', {
        w: f.w,
        fontSize: f.fontSize,
        em: f.w / f.fontSize,
        maxEm: MEASURE_MAX_EM,
      });
    }
  }
  return out;
}

// persisting entries = AFTER finding + `before` (matching BEFORE finding).
// escalated = persisting entries whose severity rank rose (P3 < P2 < P1).
export function diffFindings(before, after, options) {
  const excludeRules = options?.excludeRules ?? NON_DIFF_RULES;
  const keep = (list) => list.filter((f) => !excludeRules.includes(f.rule));
  const b = keep(before),
    a = keep(after);
  const bMap = new Map(b.map((f) => [findingKey(f), f]));
  const aKeys = new Set(a.map(findingKey));
  const persisting = a
    .filter((f) => bMap.has(findingKey(f)))
    .map((f) => ({ ...f, before: bMap.get(findingKey(f)) }));
  return {
    added: a.filter((f) => !bMap.has(findingKey(f))),
    resolved: b.filter((f) => !aKeys.has(findingKey(f))),
    persisting,
    escalated: persisting.filter(
      (f) => SEVERITY_RANK[f.severity] > SEVERITY_RANK[f.before.severity],
    ),
  };
}

// DeltaFinding = { rule: 'D1'|'D2', key, kind, text, detail, ...ctx }
// D1 detail: { before, after, change }  (inkWidth px, change = fraction)
// D2 detail: { beforeOffset, afterOffset, beforeH, afterH }
// Ruling W: real ink centre ((inkTop + inkBottom) / 2) when the collector supplied finite ink fields,
// else the text-rect centre (textTop + textHeight / 2) — both measured against the box centre.
const inkCentreOffset = (f) => {
  const centre =
    Number.isFinite(f.inkTop) && Number.isFinite(f.inkBottom)
      ? (f.inkTop + f.inkBottom) / 2
      : f.textTop + f.textHeight / 2;
  return centre - (f.y + f.h / 2);
};

export function compareFacts(beforeFacts, afterFacts, ctx = {}) {
  const bKeys = resolveKeys(beforeFacts),
    aKeys = resolveKeys(afterFacts);
  const byKey = new Map(beforeFacts.map((f, i) => [bKeys[i], f]));
  const out = [];
  for (const [i, a] of afterFacts.entries()) {
    const b = byKey.get(aKeys[i]);
    if (!b) continue;
    const base = { ...ctx, key: aKeys[i], kind: a.kind, text: a.text };
    if (a.text === b.text && b.inkWidth > 0) {
      const change = (a.inkWidth - b.inkWidth) / b.inkWidth;
      if (Math.abs(change) > D1_INK_WIDTH_CHANGE)
        out.push({
          ...base,
          rule: 'D1',
          detail: { before: b.inkWidth, after: a.inkWidth, change },
        });
    }
    if (D2_KINDS.includes(a.kind) && Math.abs(a.h - b.h) <= D2_FIXED_HEIGHT_PX) {
      const beforeOffset = inkCentreOffset(b),
        afterOffset = inkCentreOffset(a);
      if (
        Math.abs(afterOffset) > D2_OFFSET_PX &&
        Math.abs(afterOffset) > Math.abs(beforeOffset) + D2_WORSE_BY_PX
      ) {
        out.push({
          ...base,
          rule: 'D2',
          detail: { beforeOffset, afterOffset, beforeH: b.h, afterH: a.h },
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Field scale (spec docs/superpowers/specs/2026-11-14-dropdown-search-field-scale-design.md §5).
// Consumes FieldFact[] from window.__collectFields (collect.js documents every field) and produces
// Finding[] for F1–F4 with the same shape as evaluateTypography, so findingKey / diffFindings work.
// Keys: F1 <property>@<memberKey> (one per inconsistent member) · F2 placeholder|option|value@<key> ·
// F3 <targetKey>~<targetKey> · F4 left|right<n>@<key>.
// Additive only: nothing above this line reads these exports. F5 is a source-scan unit test.

export const F1_ROW_OVERLAP_MIN = 0.5; // vertical overlap ÷ the shorter control height
export const F1_ROW_LAYOUTS = ['flex-row', 'grid']; // nearest common ancestor layouts that make a row
export const F1_EXCLUDED_KINDS = ['textarea'];
export const F1_HEIGHT_TOLERANCE_PX = 2;
export const F1_RADIUS_TOLERANCE_PX = 1;
export const F1_FONT_TOLERANCE_PX = 0.5;
export const F1_BOTTOM_TOLERANCE_PX = 2;
export const F1_LABEL_FONT_TOLERANCE_PX = 0.5;
export const F1_LABEL_GAP_TOLERANCE_PX = 2;
export const F2_TEXT_SLACK_PX = 1;
export const F3_OVERLAP_MIN_PX = 1;
export const F3_CONTAIN_SLACK_PX = 1;
export const F4_RESERVE_SLACK_PX = 0.5;

const controlFacts = (facts) => facts.filter((f) => f.type === 'control');
const targetFacts = (facts) => facts.filter((f) => f.type === 'target');
const spread = (values) => Math.max(...values) - Math.min(...values);
const round2 = (n) => Math.round(n * 100) / 100;

export function verticalOverlapRatio(a, b) {
  const overlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  const shorter = Math.min(a.h, b.h);
  return shorter > 0 ? Math.max(0, overlap) / shorter : 0;
}

// first entry of a.ancestors (nearest first) that is also an ancestor of b
export function nearestCommonAncestor(a, b) {
  const ids = new Set((b.ancestors ?? []).map((n) => n.id));
  return (a.ancestors ?? []).find((n) => ids.has(n.id)) ?? null;
}

export function sameFieldRow(a, b) {
  if (a.scope !== b.scope) return false;
  if (verticalOverlapRatio(a, b) < F1_ROW_OVERLAP_MIN) return false;
  const common = nearestCommonAncestor(a, b);
  return common !== null && F1_ROW_LAYOUTS.includes(common.layout);
}

const f1Eligible = (c) => !c.largeText && !F1_EXCLUDED_KINDS.includes(c.kind);

// rows = connected components of sameFieldRow over F1-eligible controls; members keep DOM order
export function groupFieldRows(facts) {
  const controls = controlFacts(facts).filter(f1Eligible);
  const parent = controls.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < controls.length; i++) {
    for (let j = i + 1; j < controls.length; j++) {
      if (sameFieldRow(controls[i], controls[j])) parent[find(j)] = find(i);
    }
  }
  const rows = new Map();
  controls.forEach((c, i) => {
    const root = find(i);
    if (!rows.has(root)) rows.set(root, []);
    rows.get(root).push(c);
  });
  return [...rows.values()].filter((row) => row.length >= 2);
}

const hasLabelAbove = (c) => Boolean(c.label && c.label.above);
const F1_CHECKS = [
  { property: 'height', value: (c) => c.h, tolerance: F1_HEIGHT_TOLERANCE_PX },
  { property: 'radius', value: (c) => c.borderRadius, tolerance: F1_RADIUS_TOLERANCE_PX },
  { property: 'fontSize', value: (c) => c.fontSize, tolerance: F1_FONT_TOLERANCE_PX },
  { property: 'borderColor', value: (c) => c.borderColor, distinct: true },
  // ReadOnlyField is darker on purpose (spec §4.1) — its fill must not count as a mismatch.
  { property: 'background', value: (c) => c.backgroundColor, distinct: true, skipReadonly: true },
  { property: 'bottom', value: (c) => c.y + c.h, tolerance: F1_BOTTOM_TOLERANCE_PX },
  {
    property: 'labelFontSize',
    value: (c) => c.label.fontSize,
    tolerance: F1_LABEL_FONT_TOLERANCE_PX,
    labelled: true,
  },
  {
    property: 'labelGap',
    value: (c) => c.label.gap,
    tolerance: F1_LABEL_GAP_TOLERANCE_PX,
    labelled: true,
  },
];

// The row decides WHETHER a property is inconsistent (spread > tolerance, or values differ); the
// members decide WHO is reported. A member agrees with another when their values are equal
// (distinct checks) or within the tolerance; the best-agreed members are the row's majority and
// every other member is inconsistent. No majority (every member agrees with as many as any other,
// e.g. two members that differ) ⇒ every member is reported. Each finding is keyed by its own member
// only (`<property>@<memberKey>`), so --compare keeps an unfixed member's key when another member of
// the row is fixed, relabelled or changes kind.
function inconsistentMembers(values, check) {
  const agrees = (a, b) => (check.distinct ? a === b : Math.abs(a - b) <= check.tolerance);
  const support = values.map((v) => values.filter((w) => agrees(v, w)).length);
  const best = Math.max(...support);
  return values.map((_, i) => support[i] < best || support.every((s) => s === best));
}

function evaluateF1(facts, emit) {
  for (const row of groupFieldRows(facts)) {
    for (const check of F1_CHECKS) {
      const members = (check.labelled ? row.filter(hasLabelAbove) : row).filter(
        (c) => !(check.skipReadonly && c.kind === 'readonly'),
      );
      if (members.length < 2) continue;
      const values = members.map(check.value);
      const differs = check.distinct ? new Set(values).size > 1 : spread(values) > check.tolerance;
      if (!differs) continue;
      const keys = members.map((c) => c.key);
      const rowDetail = {
        ...(check.distinct ? {} : { spread: round2(spread(values)), tolerance: check.tolerance }),
        members: members.map((c, i) => ({ key: c.key, value: values[i] })),
      };
      inconsistentMembers(values, check).forEach((odd, i) => {
        if (!odd) return;
        emit('F1', 'P2', `${check.property}@${keys[i]}`, `${keys[i]} (row: ${keys.join(' / ')})`, {
          property: check.property,
          value: values[i],
          ...rowDetail,
        });
      });
    }
  }
}

function evaluateF2(facts, emit) {
  for (const c of controlFacts(facts)) {
    const room = c.contentWidth + F2_TEXT_SLACK_PX;
    const contentWidth = round2(c.contentWidth);
    if (
      c.kind !== 'textarea' &&
      Number.isFinite(c.placeholderInkWidth) &&
      c.placeholderInkWidth > room
    ) {
      emit('F2', 'P2', `placeholder@${c.key}`, c.key, {
        sub: 'placeholder',
        inkWidth: round2(c.placeholderInkWidth),
        contentWidth,
      });
    }
    if (
      c.kind === 'native-select' &&
      Number.isFinite(c.longestOptionInkWidth) &&
      c.longestOptionInkWidth > room
    ) {
      emit('F2', 'P2', `option@${c.key}`, c.key, {
        sub: 'option',
        inkWidth: round2(c.longestOptionInkWidth),
        contentWidth,
        optionCount: c.optionCount,
      });
    }
    if (c.valueOverflowX || c.valueOverflowY) {
      emit('F2', 'P2', `value@${c.key}`, c.key, {
        sub: 'value',
        overflowX: Boolean(c.valueOverflowX),
        overflowY: Boolean(c.valueOverflowY),
      });
    }
  }
}

const inDialog = (t) => String(t.scope).startsWith('dialog:');
const containsBox = (outer, inner) =>
  inner.x >= outer.x - F3_CONTAIN_SLACK_PX &&
  inner.y >= outer.y - F3_CONTAIN_SLACK_PX &&
  inner.x + inner.w <= outer.x + outer.w + F3_CONTAIN_SLACK_PX &&
  inner.y + inner.h <= outer.y + outer.h + F3_CONTAIN_SLACK_PX;

function evaluateF3(facts, emit) {
  const targets = targetFacts(facts);
  for (let i = 0; i < targets.length; i++) {
    for (let j = i + 1; j < targets.length; j++) {
      const a = targets[i];
      const b = targets[j];
      if ((a.scroller ?? null) !== (b.scroller ?? null)) continue;
      if (a.scope !== b.scope && (inDialog(a) || inDialog(b))) continue;
      if ((a.targetAncestors ?? []).includes(b.id) || (b.targetAncestors ?? []).includes(a.id))
        continue;
      const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (overlapX <= F3_OVERLAP_MIN_PX || overlapY <= F3_OVERLAP_MIN_PX) continue;
      const covered = a.coveredBy === b.id || b.coveredBy === a.id;
      // a target inside another (clear button in a field) belongs to F4 unless it covers the other
      if (!covered && (containsBox(a, b) || containsBox(b, a))) continue;
      emit('F3', covered ? 'P1' : 'P2', `${a.key}~${b.key}`, `${a.key} / ${b.key}`, {
        overlapX: round2(overlapX),
        overlapY: round2(overlapY),
        covered,
      });
    }
  }
}

function evaluateF4(facts, emit) {
  for (const c of controlFacts(facts)) {
    const textInk = Math.max(c.placeholderInkWidth ?? 0, c.longestOptionInkWidth ?? 0);
    const inkRight = c.contentLeft + Math.min(textInk, Math.max(0, c.contentWidth));
    const perSide = { left: 0, right: 0 };
    for (const ad of c.adornments ?? []) {
      const n = perSide[ad.side]++;
      const reserveShort = ad.side === 'left' ? ad.x + ad.w - c.contentLeft : c.contentRight - ad.x;
      const inkOverlap =
        textInk > 0
          ? Math.max(0, Math.min(inkRight, ad.x + ad.w) - Math.max(c.contentLeft, ad.x))
          : 0;
      if (reserveShort <= F4_RESERVE_SLACK_PX && inkOverlap <= F4_RESERVE_SLACK_PX) continue;
      emit('F4', 'P2', `${ad.side}${n}@${c.key}`, c.key, {
        side: ad.side,
        reserveShort: round2(Math.max(0, reserveShort)),
        inkOverlap: round2(inkOverlap),
      });
    }
  }
}

// ctx = { width, route?, theme?, role? } — copied onto every finding (findingKey needs them)
export function evaluateFields(facts, ctx = {}) {
  const out = [];
  const emit = (rule, severity, key, text, detail) =>
    out.push({
      rule,
      severity,
      route: ctx.route,
      width: ctx.width,
      theme: ctx.theme,
      role: ctx.role,
      key,
      text,
      detail,
    });
  evaluateF1(facts, emit);
  evaluateF2(facts, emit);
  evaluateF3(facts, emit);
  evaluateF4(facts, emit);
  return out;
}
