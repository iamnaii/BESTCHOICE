import { describe, expect, it } from 'vitest';
import { filterAndRank, normalizeThai, rankMatch, type Searchable } from './thai-search';

// Code points spelled out where an editor could silently re-compose them.
const NAM = '\u0E19\u0E49\u0E33'; // น้ำ = NO NU + MAI THO + SARA AM
const NAM_NIKHAHIT_FIRST = '\u0E19\u0E4D\u0E49\u0E32'; // spec "น ํ ้ า": what a Thai keyboard gives for น้ำ
const NAM_TONE_FIRST = '\u0E19\u0E49\u0E4D\u0E32'; // the other typing order: น + ้ + ํ + า
const DOUBLE_SARA_E = '\u0E40\u0E40'; // เ + เ typed instead of แ
const ZWSP = '\u200B';
const BOM = '\uFEFF';

// The 77 provinces exactly as AddressForm lists them: the unique province names of
// data/thai-address-data.ts sorted with the default .sort() (AddressForm.tsx:133).
// prettier-ignore
const PROVINCES = [
  'กระบี่', 'กรุงเทพมหานคร', 'กาญจนบุรี', 'กาฬสินธุ์', 'กำแพงเพชร', 'ขอนแก่น', 'จันทบุรี',
  'ฉะเชิงเทรา', 'ชลบุรี', 'ชัยนาท', 'ชัยภูมิ', 'ชุมพร', 'ตรัง', 'ตราด', 'ตาก', 'นครนายก',
  'นครปฐม', 'นครพนม', 'นครราชสีมา', 'นครศรีธรรมราช', 'นครสวรรค์', 'นนทบุรี', 'นราธิวาส',
  'น่าน', 'บึงกาฬ', 'บุรีรัมย์', 'ปทุมธานี', 'ประจวบคีรีขันธ์', 'ปราจีนบุรี', 'ปัตตานี',
  'พระนครศรีอยุธยา', 'พะเยา', 'พังงา', 'พัทลุง', 'พิจิตร', 'พิษณุโลก', 'ภูเก็ต', 'มหาสารคาม',
  'มุกดาหาร', 'ยะลา', 'ยโสธร', 'ระนอง', 'ระยอง', 'ราชบุรี', 'ร้อยเอ็ด', 'ลพบุรี', 'ลำปาง',
  'ลำพูน', 'ศรีสะเกษ', 'สกลนคร', 'สงขลา', 'สตูล', 'สมุทรปราการ', 'สมุทรสงคราม', 'สมุทรสาคร',
  'สระบุรี', 'สระแก้ว', 'สิงห์บุรี', 'สุพรรณบุรี', 'สุราษฎร์ธานี', 'สุรินทร์', 'สุโขทัย',
  'หนองคาย', 'หนองบัวลำภู', 'อำนาจเจริญ', 'อุดรธานี', 'อุตรดิตถ์', 'อุทัยธานี', 'อุบลราชธานี',
  'อ่างทอง', 'เชียงราย', 'เชียงใหม่', 'เพชรบุรี', 'เพชรบูรณ์', 'เลย', 'แพร่', 'แม่ฮ่องสอน',
];

// Real FINANCE expense accounts (finance-coa.csv), passed the way the account pickers pass them:
// label = account name, the code only as a keyword.
const EXPENSE_ACCOUNTS = [
  { label: 'ค่าคอมฯ พนักงาน', keywords: ['52-1101'] },
  { label: 'ค่าส่งเสริมการขาย', keywords: ['52-1102'] },
  { label: 'ค่าบริการส่ง SMS', keywords: ['52-1103'] },
  { label: 'ส่วนลดไม่จ่ายเศษสตางค์', keywords: ['52-1104'] },
  { label: 'เงินเดือน ค่าจ้าง', keywords: ['53-1101'] },
  { label: 'ค่าน้ำ', keywords: ['53-1301'] },
  { label: 'ค่าไฟฟ้า', keywords: ['53-1302'] },
];

const asItems = (labels: readonly string[]) => labels.map((label) => ({ label }));
const labelsOf = (items: readonly Searchable[]) => items.map((item) => item.label);

describe('normalizeThai', () => {
  it('folds nikhahit + sara aa into sara am in both typing orders', () => {
    expect(normalizeThai(NAM_NIKHAHIT_FIRST)).toBe(NAM);
    expect(normalizeThai(NAM_TONE_FIRST)).toBe(NAM);
    expect(normalizeThai('\u0E01\u0E4D\u0E32')).toBe('\u0E01\u0E33'); // ก + ํ + า → กำ (no tone)
    expect(normalizeThai(NAM)).toBe(NAM);
  });

  it('uses NFC as the spec says: composes, keeps sara am, leaves compatibility characters', () => {
    expect(normalizeThai('\u0E33')).toBe('\u0E33');
    expect(normalizeThai('e\u0301')).toBe('\u00E9');
    expect(normalizeThai('\u2460')).toBe('\u2460'); // ① — NFKC would turn it into "1"
  });

  it('removes the zero-width characters U+200B–U+200D and U+FEFF', () => {
    expect(normalizeThai(`ชล${ZWSP}บุ\u200Cรี\u200D${BOM}`)).toBe('ชลบุรี');
  });

  it('turns a doubled sara e into sara ae', () => {
    expect(normalizeThai(`${DOUBLE_SARA_E}พร่`)).toBe('แพร่');
  });

  it('lower-cases and trims', () => {
    expect(normalizeThai('  iPhone 15 PRO  ')).toBe('iphone 15 pro');
  });

  it('maps Thai digits ๐–๙ to 0–9', () => {
    expect(normalizeThai('๐๑๒๓๔๕๖๗๘๙')).toBe('0123456789');
    expect(normalizeThai('ซอย ๑๒/๓')).toBe('ซอย 12/3');
  });
});

describe('rankMatch', () => {
  it.each([
    ['label starts with the query', { label: 'ชลบุรี' }, 'ชล', 1],
    ['label starts with it after one leading vowel', { label: 'เชียงใหม่' }, 'ชี', 2],
    ['a later word starts with it', { label: 'สมชาย ใจดี' }, 'ใจ', 2],
    ['a later word starts with it after a leading vowel', { label: 'สมชาย ใจดี' }, 'จดี', 2],
    ['words split on punctuation', { label: '52-1104 ส่วนลด' }, '1104', 2],
    ['label contains it mid-word', { label: 'ฉะเชิงเทรา' }, 'ชิง', 3],
    [
      'a keyword starts with it',
      { label: 'ส่วนลดไม่จ่ายเศษสตางค์', keywords: ['52-1104'] },
      '52-11',
      4,
    ],
    [
      'a keyword contains it',
      { label: 'ส่วนลดไม่จ่ายเศษสตางค์', keywords: ['52-1104'] },
      '1104',
      4,
    ],
    ['no match', { label: 'ชลบุรี', keywords: ['20000'] }, 'ระยอง', null],
  ] as const)('%s', (_case, item, query, expected) => {
    expect(rankMatch(item, query)).toBe(expected);
  });

  it('the label rank wins over a keyword match', () => {
    expect(rankMatch({ label: 'ค่าน้ำ', keywords: ['ค่าสาธารณูปโภค'] }, 'ค่า')).toBe(1);
  });

  it('normalizes the label and the query the same way', () => {
    expect(rankMatch({ label: `ค่า${NAM}` }, `ค่า${NAM_NIKHAHIT_FIRST}`)).toBe(1);
    expect(rankMatch({ label: `ค่า${NAM_TONE_FIRST}` }, `ค่า${NAM}`)).toBe(1);
    expect(rankMatch({ label: 'แพร่' }, `${DOUBLE_SARA_E}พ`)).toBe(1);
    expect(rankMatch({ label: `${DOUBLE_SARA_E}ม่ฮ่องสอน` }, 'แม่')).toBe(1);
    expect(rankMatch({ label: 'ซอย ๑๒' }, '12')).toBe(2);
    expect(rankMatch({ label: `ชล${ZWSP}บุรี` }, 'ชลบุ')).toBe(1);
    expect(rankMatch({ label: 'iPhone 15 Pro' }, 'IPHONE 15')).toBe(1);
  });

  it('an empty query (after normalizing) matches everything at rank 1', () => {
    expect(rankMatch({ label: 'ชลบุรี' }, '')).toBe(1);
    expect(rankMatch({ label: 'ชลบุรี' }, '   ')).toBe(1);
    expect(rankMatch({ label: 'ชลบุรี' }, ZWSP)).toBe(1);
  });
});

describe('filterAndRank', () => {
  it('spec §6.2: ช → ชลบุรี ชัยนาท ชัยภูมิ ชุมพร, then เชียง…, then ช mid-word', () => {
    const result = labelsOf(filterAndRank(asItems(PROVINCES), 'ช'));
    expect(result).toEqual([
      // rank 1 — starts with ช, in the list's own order
      'ชลบุรี',
      'ชัยนาท',
      'ชัยภูมิ',
      'ชุมพร',
      // rank 2 — starts with ช after the leading vowel เ
      'เชียงราย',
      'เชียงใหม่',
      // rank 3 — ช in the middle of the name
      'กำแพงเพชร',
      'ฉะเชิงเทรา',
      'นครราชสีมา',
      'นครศรีธรรมราช',
      'ราชบุรี',
      'อุบลราชธานี',
      'เพชรบุรี',
      'เพชรบูรณ์',
    ]);
    expect(result.indexOf('ชุมพร')).toBeLessThan(result.indexOf('เชียงใหม่'));
    expect(result.indexOf('เชียงใหม่')).toBeLessThan(result.indexOf('ฉะเชิงเทรา'));
  });

  it('the province list in this test is in the order AddressForm uses', () => {
    expect(PROVINCES).toHaveLength(77);
    expect([...PROVINCES].sort()).toEqual(PROVINCES);
  });

  it('finds น้ำ when it is typed as น ํ ้ า or น ้ ํ า', () => {
    expect(labelsOf(filterAndRank(EXPENSE_ACCOUNTS, NAM_NIKHAHIT_FIRST))).toEqual(['ค่าน้ำ']);
    expect(labelsOf(filterAndRank(EXPENSE_ACCOUNTS, NAM_TONE_FIRST))).toEqual(['ค่าน้ำ']);
  });

  it('finds account codes through keywords (52-11 → the four 52-11xx accounts, in list order)', () => {
    expect(labelsOf(filterAndRank(EXPENSE_ACCOUNTS, '52-11'))).toEqual([
      'ค่าคอมฯ พนักงาน',
      'ค่าส่งเสริมการขาย',
      'ค่าบริการส่ง SMS',
      'ส่วนลดไม่จ่ายเศษสตางค์',
    ]);
    expect(labelsOf(filterAndRank(EXPENSE_ACCOUNTS, '53-13'))).toEqual(['ค่าน้ำ', 'ค่าไฟฟ้า']);
  });

  it('ranks label prefixes before word prefixes', () => {
    expect(labelsOf(filterAndRank(EXPENSE_ACCOUNTS, 'ค่า'))).toEqual([
      'ค่าคอมฯ พนักงาน',
      'ค่าส่งเสริมการขาย',
      'ค่าบริการส่ง SMS',
      'ค่าน้ำ',
      'ค่าไฟฟ้า',
      'เงินเดือน ค่าจ้าง', // rank 2: the word ค่าจ้าง
    ]);
    expect(labelsOf(filterAndRank(EXPENSE_ACCOUNTS, 'sms'))).toEqual(['ค่าบริการส่ง SMS']);
  });

  it('matches Thai digits against Arabic digits both ways', () => {
    const items = asItems(['ซอย 12', 'ซอย ๑๓', 'หมู่ 1']);
    expect(labelsOf(filterAndRank(items, '๑๒'))).toEqual(['ซอย 12']);
    expect(labelsOf(filterAndRank(items, '13'))).toEqual(['ซอย ๑๓']);
  });

  it('ignores zero-width characters and returns the original item unchanged', () => {
    const items = asItems([`ชล${ZWSP}บุรี`, 'ระยอง']);
    const result = filterAndRank(items, `ชลบุ${BOM}`);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(items[0]);
    expect(result[0].label).toBe(`ชล${ZWSP}บุรี`);
  });

  it('matches a doubled sara e (เเ) as แ in the label and in the query', () => {
    const items = asItems(['แพร่', `${DOUBLE_SARA_E}ม่ฮ่องสอน`, 'พะเยา']);
    expect(labelsOf(filterAndRank(items, DOUBLE_SARA_E))).toEqual([
      'แพร่',
      `${DOUBLE_SARA_E}ม่ฮ่องสอน`,
    ]);
    expect(labelsOf(filterAndRank(items, 'แม่'))).toEqual([`${DOUBLE_SARA_E}ม่ฮ่องสอน`]);
  });

  it('keeps the original order within a rank (not alphabetical)', () => {
    expect(labelsOf(filterAndRank(asItems(['ชุมพร', 'ชัยนาท', 'ชลบุรี']), 'ช'))).toEqual([
      'ชุมพร',
      'ชัยนาท',
      'ชลบุรี',
    ]);
    const twins = [
      { label: 'สมชาย ใจดี', id: 'u-1' },
      { label: 'สมชาย ใจดี', id: 'u-2' },
    ];
    expect(filterAndRank(twins, 'สม').map((item) => item.id)).toEqual(['u-1', 'u-2']);
  });

  it('an empty or blank query returns every item in the original order, as a new array', () => {
    const items = asItems(PROVINCES);
    for (const query of ['', '   ', ZWSP]) {
      const result = filterAndRank(items, query);
      expect(result).toEqual(items);
      expect(result).not.toBe(items);
    }
  });

  it('returns [] when nothing matches and never mutates the input', () => {
    const items = asItems(PROVINCES);
    const before = [...items];
    expect(filterAndRank(items, 'ลอนดอน')).toEqual([]);
    filterAndRank(items, 'ช');
    expect(items).toEqual(before);
  });
});

// Address names keep their prefixes (เขตพระนคร, อำเภอเมืองบุรีรัมย์, แขวง…, ตำบล… —
// data/thai-address-data.ts). These tests pin how the ranking treats them; Task 6 relies on it.
describe('address names with เขต/อำเภอ/แขวง/ตำบล prefixes', () => {
  const BANGKOK = ['เขตคลองสาน', 'เขตคลองสามวา', 'เขตพระนคร', 'เขตสาทร', 'เขตสายไหม'];
  const ADDRESS_PREFIX = /^(?:เขต|อำเภอ|แขวง|ตำบล)/;
  // The composition Task 6 passes as the Combobox `filter`: rank on the bare name and keep
  // the full name as a keyword, so typing the prefix still finds every row.
  const byBareName = (names: readonly string[], query: string) =>
    filterAndRank(
      names.map((name) => ({ name, label: name.replace(ADDRESS_PREFIX, ''), keywords: [name] })),
      query,
    ).map((entry) => entry.name);

  it('rank 2 does not split the prefix off — the name is only a rank-3 contains match', () => {
    expect(rankMatch({ label: 'เขตพระนคร' }, 'พระนคร')).toBe(3);
    expect(rankMatch({ label: 'อำเภอเมืองบุรีรัมย์' }, 'เมือง')).toBe(3);
  });

  it('a prefix-stripped keyword cannot lift it: keywords rank 4, below the label', () => {
    expect(rankMatch({ label: 'เขตพระนคร', keywords: ['พระนคร'] }, 'พระนคร')).toBe(3);
  });

  it('raw labels let mid-word matches come first', () => {
    expect(labelsOf(filterAndRank(asItems(BANGKOK), 'สา'))).toEqual([
      'เขตคลองสาน',
      'เขตคลองสามวา',
      'เขตสาทร',
      'เขตสายไหม',
    ]);
  });

  it('ranking on the bare name puts names that start with the query first', () => {
    expect(byBareName(BANGKOK, 'สา')).toEqual([
      'เขตสาทร',
      'เขตสายไหม',
      'เขตคลองสาน',
      'เขตคลองสามวา',
    ]);
    expect(byBareName(BANGKOK, 'พระนคร')).toEqual(['เขตพระนคร']);
    expect(byBareName(['อำเภอคูเมือง', 'อำเภอเมืองบุรีรัมย์'], 'เมือง')).toEqual([
      'อำเภอเมืองบุรีรัมย์',
      'อำเภอคูเมือง',
    ]);
  });

  it('typing the prefix itself still finds every row, in list order', () => {
    expect(byBareName(BANGKOK, 'เขต')).toEqual(BANGKOK);
    expect(byBareName(['อำเภอคูเมือง', 'อำเภอเมืองบุรีรัมย์'], 'อำเภอเมือง')).toEqual([
      'อำเภอเมืองบุรีรัมย์',
    ]);
  });
});
