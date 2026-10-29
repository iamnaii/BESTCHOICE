import { Prisma } from '@prisma/client';
import { isValidThaiNationalId } from '@installment/shared';
import { ContactResolverService } from '../../modules/contacts/contact-resolver.service';
import type { CustomerPiiService } from '../../modules/customers/customer-pii.service';
import { lockCustomerPhone } from '../../modules/customers/customer-phone-lock';
import { findLivePhoneOwner } from '../../modules/customers/customer-phone-owner';
import type { PrismaService } from '../../prisma/prisma.service';
import { normalizeThaiPhone } from '../../utils/thai-phone.util';
import { readCsv } from './csv';
import type { DumpRow } from './dump-reader';
import { formatFullAddress } from './thai-address';

/**
 * ลูกค้าของระบบเก่า (Task 8) — แปลงแถว `member_master` + `order_product` เป็น input แล้วผูกกับลูกค้าที่มีอยู่
 * หรือสร้างใหม่ **โดยไม่เขียนทับข้อมูลของลูกค้าเดิม**
 *
 * ## ผูกหรือสร้าง (`linkOrCreateLegacyCustomer`)
 * ตัดสินผลทั้งหมดก่อนเขียนแถวแรก ⇒ ผลที่บล็อก (`PHONE_TAKEN` / `INVALID_NATIONAL_ID` / `NATIONAL_ID_CONFLICT` /
 * `PEAK_CODE_CONFLICT`) ไม่เขียนอะไรเลย (มีแค่ล็อก) — ผู้เรียก commit ทรานแซกชันต่อได้
 * 1. ไม่มี override: เลขบัตรว่างหรือ checksum ผิด → `INVALID_NATIONAL_ID` (ยังไม่ส่งคำสั่งใดถึงฐาน)
 * 2. ล็อกเบอร์ (`lockCustomerPhone`) เป็นคำสั่งแรกของทรานแซกชัน
 * 3. ลูกค้าเป้าหมาย = แถวที่ถือเลขบัตรนี้ (plaintext หรือ hash — รวมแถวที่ถูกลบ เพราะ unique ครอบทั้งหมด)
 *    หรือแถวที่ถือ `legacyMemberCode` นี้ (นำเข้ารอบก่อน) หรือ stub บน Contact ที่ถือ hash เลขบัตรนี้
 *    (ลูกค้าจาก `ensureRole` ที่ยังไม่มีเลขบัตร — คนเดียวกันตามกติกาของ `CustomerWriteService.create`)
 *    · เลขบัตรอยู่หลายแถว / แถวที่ถือถูกลบ / รหัสสมาชิกอยู่กับคนอื่น / stub หลายแถว → `NATIONAL_ID_CONFLICT`
 * 4. มีเป้าหมาย → `LINKED`: ไม่แตะชื่อ เบอร์ ที่อยู่ หรือ PII ใดของลูกค้าเดิม · ตั้ง `legacyMemberCode` เฉพาะเมื่อว่าง
 *    (ไม่ตรวจเบอร์ — ไม่ได้เขียนเบอร์)
 * 5. ไม่มีเป้าหมาย: เบอร์เป็นเบอร์หลักของลูกค้าคนอื่นที่ยังไม่ถูกลบ (`findLivePhoneOwner`) → `PHONE_TAKEN`
 *    · ไม่งั้น `CREATED`: dual-write plaintext + `*_encrypted` / `*_hash` (`encryptCustomerFields`) + `legacyMemberCode`
 * 6. ทั้ง `CREATED` และ `LINKED` ได้ `Contact` (party master) ที่ผูกกับลูกค้า: ของเดิมของลูกค้า → Contact ที่ถือ hash
 *    เลขบัตร → สร้างใหม่ (`ContactResolverService.findOrCreateByNaturalKey` — ถือล็อก `contact:code` หลังล็อกเบอร์) ·
 *    `peakContactCode` ตั้งเมื่อ Contact ยังไม่มี · มีรหัสอื่นอยู่แล้ว → `PEAK_CODE_CONFLICT`
 *
 * **override** (`--customer-overrides`, เจ้าของกรอก): ผูกกับ `customer_id` ที่ระบุ ข้ามการตรวจเลขบัตร/เบอร์ แต่ยังใช้กติกา
 * PEAK code · ลูกค้าไม่มี/ถูกลบ หรือรหัสสมาชิกอยู่กับลูกค้าคนอื่น = throw (แก้ไฟล์)
 *
 * ## สัญญากับผู้เรียก (Task 10)
 * - **หนึ่งลูกค้าต่อหนึ่งทรานแซกชัน** — ล็อกเบอร์ต้องเป็นคำสั่งแรก และหนึ่งเบอร์ต่อทรานแซกชัน
 *   (`.claude/rules/database.md` "ล็อกเบอร์หลักของลูกค้า") ⇒ ห้ามเรียกซ้ำในทรานแซกชันเดียว และห้ามเรียกหลังคำสั่งอื่น
 *   (โดยเฉพาะล็อกแถวลูกค้า หรือล็อก `contact:code`)
 * - ต้องตั้ง `PII_ENCRYPTION_KEY` / `PII_HASH_SALT` (ไม่มี = throw ไม่เขียน plaintext ลงช่องเข้ารหัส)
 * - error ของฐาน (เช่น P2002 เมื่อพนักงานสร้างลูกค้าเลขบัตรเดียวกันพร้อมกัน) ไม่ถูกแปลง — ทรานแซกชันล้ม ให้ลงเป็นตัวบล็อก
 * - ลูกค้าที่สร้างไม่มี `accessCompanyCode` / `accessBranchId` (แบบ `MigrationService.importCustomers`)
 *
 * LINE ของระบบเก่าเป็น LINE ID ที่พิมพ์เอง ไม่ใช่ LINE userId ของ OA ระบบนี้ ⇒ ไม่ลง `lineIdFinance` (ช่องที่ระบบใช้ส่งข้อความ)
 * แต่เติม `Contact.lineId` ตอน `CREATED` เมื่อยังว่าง
 *
 * ข้อความ error บอกได้แค่ตาราง รหัสแถว (`member_id`) ชื่อคอลัมน์ รหัสสมาชิก และ id ลูกค้า — ไม่ยกค่าข้อมูลส่วนบุคคล
 */

type Decimal = Prisma.Decimal;

export type LegacyCustomerInput = {
  /** `member_master.member_code` → `Customer.legacyMemberCode` */
  legacyMemberCode: string;
  /** รหัสผู้ติดต่อ PEAK ของใบแจ้งหนี้ที่จับคู่ได้ (Task 2b) → `Contact.peakContactCode` · null = ไม่ตั้ง */
  peakContactCode: string | null;
  /** `customer_id` จาก `--customer-overrides` — มีค่า = ผูกกับลูกค้านี้โดยไม่ตรวจเลขบัตร/เบอร์ */
  overrideCustomerId: string | null;
  name: string;
  nickname: string | null;
  /** ตัดช่องว่าง/ขีดแล้ว — ยังไม่ตรวจ checksum */
  nationalId: string | null;
  /** `normalizeThaiPhone` แล้ว · ไม่มี = null (สร้างลูกค้าด้วยเบอร์ `''` แบบ stub) */
  phone: string | null;
  phoneSecondary: string | null;
  /** เที่ยงคืน UTC ของวันเกิด (รูปเดียวกับที่หน้าเว็บส่ง) */
  birthDate: Date | null;
  addressIdCard: string | null;
  addressCurrent: string | null;
  addressWork: string | null;
  lineId: string | null;
  facebookLink: string | null;
  occupation: string | null;
  occupationDetail: string | null;
  workplace: string | null;
  salary: Decimal | null;
};

export type CustomerLinkResult =
  | { outcome: 'CREATED' | 'LINKED'; customerId: string }
  | {
      outcome:
        | 'PHONE_TAKEN'
        | 'INVALID_NATIONAL_ID'
        | 'NATIONAL_ID_CONFLICT'
        | 'PEAK_CODE_CONFLICT';
      customerId: null;
      /** ลูกค้าที่ทำให้บล็อก (เจ้าของเบอร์ / แถวที่ถือเลขบัตร / ลูกค้าที่ Contact มีรหัส PEAK อื่น) — ใช้กรอก override */
      relatedCustomerId?: string;
    };

/** ทางเลือกของ `toLegacyCustomerInput` — รหัส PEAK จาก Task 2b และไฟล์ override ที่ parse แล้ว */
export type LegacyCustomerLink = {
  peakContactCode?: string | null;
  overrides?: ReadonlyMap<string, string>;
};

const MEMBER_TABLE = 'bestchoice_member_master';
const ORDER_TABLE = 'bestchoice_order_product';

/** ชื่อคอลัมน์จริงตาม CREATE TABLE ของ dump 29/10 (`legacy-columns.md`) */
const MEMBER = {
  id: 'member_id',
  code: 'member_code',
  firstName: 'member_name',
  lastName: 'member_surname',
  nickname: 'member_nickname',
  nationalId: 'member_identity_number',
  phone: 'member_tel',
  phone2: 'member_tel2',
  birthDate: 'member_birth_date',
  address: 'member_address',
  tambon: 'member_districts',
  zip: 'member_zipcode',
  contactAddress: 'contact_address',
  contactTambon: 'contact_districts',
  contactZip: 'contact_zipcode',
  workAddress: 'work_address',
  workTambon: 'work_districts',
  workZip: 'work_zipcode',
  line: 'member_line',
  lineId: 'member_line_id',
  facebook: 'member_facebook',
  career: 'member_career',
  workPlace: 'work_place',
  workPosition: 'work_position',
  income: 'member_monthly_income',
} as const;

const ORDER = {
  id: 'order_id',
  name: 'member_name',
  nickname: 'member_nickname',
  nationalId: 'member_identity_number',
  phone: 'member_tel',
  phone2: 'member_tel2',
  mobile: 'member_mobile',
  birthDate: 'member_birthday',
  contactAddress: 'contact_address',
  contactTambon: 'contact_districts',
  contactZip: 'contact_zipcode',
  workAddress: 'work_address',
  workTambon: 'work_districts',
  workZip: 'work_zipcode',
  line: 'member_line',
  facebook: 'member_facebook',
  career: 'member_career',
  workPlace: 'work_place',
  workPosition: 'work_position',
  income: 'member_monthly_income',
} as const;

/** คอลัมน์ที่ตัวแปลงอ่าน — ใช้สร้างแถวสังเคราะห์ในเทสต์ของงานถัดไป */
export const LEGACY_CUSTOMER_COLUMNS = {
  member: Object.values(MEMBER),
  order: Object.values(ORDER),
} as const;

/** หัวคอลัมน์ที่ต้องมีในไฟล์ `--customer-overrides` (คอลัมน์อื่นไม่อ่าน) */
export const CUSTOMER_OVERRIDE_COLUMNS = ['legacy_member_code', 'customer_id'] as const;

const INPUT_ERROR = 'อ่านข้อมูลลูกค้าระบบเก่าไม่ได้';
const OVERRIDE_ERROR = 'อ่านไฟล์ผูกลูกค้าเอง (--customer-overrides) ไม่ได้';
/** กติกาเดียวกับ `ContactsService.setPeakContactCode` */
const PEAK_CONTACT_CODE = /^[A-Za-z0-9\-_.]{1,20}$/;
const DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

/** อ่านช่องของแถว dump — ตัดช่องว่าง · ว่าง/NULL = null · คอลัมน์ไม่มีในแถว = throw (ชื่อคอลัมน์ผิด / schema เปลี่ยน) */
function cellReader(table: string, row: DumpRow, labelColumn: string) {
  const label = `${labelColumn}=${row[labelColumn] ?? 'NULL'}`;
  return (column: string): string | null => {
    if (!(column in row)) {
      throw new Error(`${INPUT_ERROR}: ตาราง \`${table}\` แถว ${label} ไม่มีคอลัมน์ ${column}`);
    }
    const value = row[column]?.trim();
    return value ? value : null;
  };
}

/** รหัสตำบล / รหัสไปรษณีย์ — `0` (ค่า default ของคอลัมน์ int ในระบบเก่า) = ไม่มี */
const code = (value: string | null) => (value && value !== '0' ? value : null);

function fullName(...parts: Array<string | null>): string | null {
  const joined = parts
    .filter((p): p is string => !!p)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return joined || null;
}

/** วันเกิด `YYYY-MM-DD` (ปี > 2400 = พ.ศ.) → เที่ยงคืน UTC · ว่าง / 0000-00-00 / วันที่ไม่มีจริง = null */
function birthDate(raw: string | null): Date | null {
  const match = raw ? DATE_PREFIX.exec(raw) : null;
  if (!match) return null;
  let year = Number(match[1]);
  if (year > 2400) year -= 543;
  const [month, day] = [Number(match[2]), Number(match[3])];
  if (year < 1900) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null;
}

/** เบอร์แรกที่ normalize แล้วไม่ว่าง — ช่องที่มีแต่ขีด/ช่องว่างไม่บังช่องสำรอง */
function firstPhone(...raws: Array<string | null>): string | null {
  for (const raw of raws) {
    const phone = normalizeThaiPhone(raw);
    if (phone) return phone;
  }
  return null;
}

function salary(raw: string | null): Decimal | null {
  if (!raw) return null;
  try {
    const value = new Prisma.Decimal(raw);
    return value.isFinite() && value.gt(0) ? value.toDecimalPlaces(2) : null;
  } catch {
    return null;
  }
}

/**
 * แถวลูกค้าระบบเก่า → input ของ `linkOrCreateLegacyCustomer` (ฟังก์ชันบริสุทธิ์)
 *
 * ข้อมูลตัวตน (ชื่อ เลขบัตร เบอร์ วันเกิด ที่อยู่ตามบัตร) จาก `member_master` ก่อน · ที่อยู่ติดต่อ/ที่ทำงาน LINE Facebook
 * อาชีพ รายได้ จากคำสั่งซื้อก่อน (สำเนา ณ วันทำสัญญา) — ตามสคริปต์เดิม `scripts/import-legacy/index.ts`
 * (ลบใน Task 8 — ดู git history) · อีกฝั่งเป็นค่าสำรอง
 * · ผู้เรียกควรส่งคำสั่งซื้อล่าสุดของสมาชิก (ลูกค้าที่ผูกแล้วไม่ถูกเขียนทับในสัญญาถัดไป)
 * · ที่อยู่ = `formatFullAddress(บรรทัด, รหัสตำบล, รหัสไปรษณีย์)` — `*_amphures` / `*_province` เป็น PK ภายในของระบบเก่า
 */
export function toLegacyCustomerInput(
  member: DumpRow,
  order: DumpRow,
  link: LegacyCustomerLink = {},
): LegacyCustomerInput {
  const m = cellReader(MEMBER_TABLE, member, MEMBER.id);
  const o = cellReader(ORDER_TABLE, order, ORDER.id);
  const memberCode = m(MEMBER.code);
  if (!memberCode) {
    throw new Error(
      `${INPUT_ERROR}: ตาราง \`${MEMBER_TABLE}\` แถว ${MEMBER.id}=${member[MEMBER.id] ?? 'NULL'} ช่อง ${MEMBER.code} — ไม่มีค่า`,
    );
  }
  const orderFirst = (orderColumn: string, memberColumn: string) =>
    o(orderColumn) ?? m(memberColumn);
  const address = (line: string | null, tambon: string | null, zip: string | null) =>
    formatFullAddress(line, code(tambon), code(zip));
  const orderAddress = (line: string, tambon: string, zip: string) =>
    o(line) ? address(o(line), o(tambon), o(zip)) : null;
  const memberAddress = (line: string, tambon: string, zip: string) =>
    address(m(line), m(tambon), m(zip));

  const nationalId = (m(MEMBER.nationalId) ?? o(ORDER.nationalId))?.replace(/[\s-]/g, '') || null;
  const peakContactCode = link.peakContactCode?.trim() || null;

  return {
    legacyMemberCode: memberCode,
    peakContactCode,
    overrideCustomerId: link.overrides?.get(memberCode) ?? null,
    name:
      fullName(m(MEMBER.firstName), m(MEMBER.lastName)) ??
      fullName(o(ORDER.name)) ??
      `ไม่ระบุชื่อ (ระบบเก่า ${memberCode})`,
    nickname: m(MEMBER.nickname) ?? o(ORDER.nickname),
    nationalId,
    phone: firstPhone(m(MEMBER.phone), o(ORDER.phone), o(ORDER.mobile)),
    phoneSecondary: firstPhone(m(MEMBER.phone2), o(ORDER.phone2)),
    birthDate: birthDate(m(MEMBER.birthDate)) ?? birthDate(o(ORDER.birthDate)),
    addressIdCard: memberAddress(MEMBER.address, MEMBER.tambon, MEMBER.zip),
    addressCurrent:
      orderAddress(ORDER.contactAddress, ORDER.contactTambon, ORDER.contactZip) ??
      memberAddress(MEMBER.contactAddress, MEMBER.contactTambon, MEMBER.contactZip),
    addressWork:
      orderAddress(ORDER.workAddress, ORDER.workTambon, ORDER.workZip) ??
      memberAddress(MEMBER.workAddress, MEMBER.workTambon, MEMBER.workZip),
    lineId: o(ORDER.line) ?? m(MEMBER.line) ?? m(MEMBER.lineId),
    facebookLink: orderFirst(ORDER.facebook, MEMBER.facebook),
    occupation: orderFirst(ORDER.workPosition, MEMBER.workPosition),
    occupationDetail: orderFirst(ORDER.career, MEMBER.career),
    workplace: orderFirst(ORDER.workPlace, MEMBER.workPlace),
    salary: salary(o(ORDER.income)) ?? salary(m(MEMBER.income)),
  };
}

/** `--customer-overrides` (`legacy_member_code,customer_id`) → รหัสสมาชิก → id ลูกค้า · รหัสซ้ำ / ช่องว่าง = throw */
export function parseCustomerOverridesCsv(text: string): Map<string, string> {
  const overrides = new Map<string, string>();
  const lineOfCode = new Map<string, number>();
  for (const row of readCsv(text, CUSTOMER_OVERRIDE_COLUMNS, OVERRIDE_ERROR)) {
    const memberCode = row.text('legacy_member_code');
    const previous = lineOfCode.get(memberCode);
    if (previous !== undefined) {
      throw row.fail('legacy_member_code', `รหัสสมาชิกซ้ำกับบรรทัด ${previous}`);
    }
    lineOfCode.set(memberCode, row.line);
    overrides.set(memberCode, row.text('customer_id'));
  }
  return overrides;
}

const TARGET_SELECT = {
  id: true,
  name: true,
  phone: true,
  nationalIdHash: true,
  legacyMemberCode: true,
  contactId: true,
  deletedAt: true,
} satisfies Prisma.CustomerSelect;
type Target = Prisma.CustomerGetPayload<{ select: typeof TARGET_SELECT }>;

const CONTACT_SELECT = {
  id: true,
  peakContactCode: true,
  lineId: true,
} satisfies Prisma.ContactSelect;
type ContactRow = Prisma.ContactGetPayload<{ select: typeof CONTACT_SELECT }>;

type Blocked = Exclude<CustomerLinkResult['outcome'], 'CREATED' | 'LINKED'>;

function blocked(outcome: Blocked, relatedCustomerId?: string): CustomerLinkResult {
  return relatedCustomerId
    ? { outcome, customerId: null, relatedCustomerId }
    : { outcome, customerId: null };
}

/** Contact มีรหัส PEAK อื่นอยู่แล้ว — ว่าง หรือรหัสเดียวกัน = ไม่ชน */
const peakConflict = (contact: ContactRow | null, peakCode: string | null) =>
  !!contact?.peakContactCode && !!peakCode && contact.peakContactCode !== peakCode;

/** Contact ที่ `findOrCreateByNaturalKey` จะคืนสำหรับ hash นี้ (ไม่มี taxId) — อ่านก่อนเขียนเพื่อตัดสินกติกา PEAK */
function liveContactByHash(tx: Prisma.TransactionClient, nationalIdHash: string | null) {
  return nationalIdHash
    ? tx.contact.findFirst({ where: { deletedAt: null, nationalIdHash }, select: CONTACT_SELECT })
    : Promise.resolve(null);
}

/** `findOrCreateByNaturalKey` ใช้แต่ `tx` ที่ส่งเข้าไป (ไม่มีบริบทสิทธิ์พนักงานใน CLI) — ตัว client หลักไม่ถูกเรียก */
function contactResolver(tx: Prisma.TransactionClient, pii: CustomerPiiService) {
  return new ContactResolverService(tx as unknown as PrismaService, pii);
}

/**
 * ผูกลูกค้าระบบเก่ากับลูกค้าเดิม หรือสร้างใหม่ — กติกาและสัญญากับผู้เรียกอยู่ในหัวไฟล์
 * (**หนึ่งลูกค้าต่อหนึ่งทรานแซกชัน · เรียกเป็นคำสั่งแรกของทรานแซกชัน**)
 */
export async function linkOrCreateLegacyCustomer(
  tx: Prisma.TransactionClient,
  pii: CustomerPiiService,
  input: LegacyCustomerInput,
): Promise<CustomerLinkResult> {
  const peakCode = input.peakContactCode?.trim() || null;
  if (peakCode && !PEAK_CONTACT_CODE.test(peakCode)) {
    throw new Error(
      `${INPUT_ERROR}: รหัสผู้ติดต่อ PEAK ของสมาชิก ${input.legacyMemberCode} ต้องเป็น A-Z 0-9 - _ . ยาว 1–20 ตัว`,
    );
  }
  if (input.overrideCustomerId)
    return linkOverride(tx, pii, input, input.overrideCustomerId, peakCode);

  const nationalId = input.nationalId;
  if (!nationalId || !isValidThaiNationalId(nationalId)) return blocked('INVALID_NATIONAL_ID');

  // ① คำสั่งแรกของทรานแซกชัน — ก่อน contact:code (findOrCreateByNaturalKey) ตามกติกาลำดับล็อก
  await lockCustomerPhone(tx, pii, input.phone);

  const enc = pii.encryptCustomerFields({
    nationalId,
    ...(input.phone ? { phone: input.phone } : {}),
    phoneSecondary: input.phoneSecondary,
    addressIdCard: input.addressIdCard,
    addressCurrent: input.addressCurrent,
    addressWork: input.addressWork,
  });
  const nationalIdHash = enc.nationalIdHash as string;

  // unique ของเลขบัตรครอบแถวที่ถูกลบ ⇒ ไม่กรอง deletedAt (แบบ MigrationService.importCustomers)
  const byIdentity = await tx.customer.findMany({
    where: { OR: [{ nationalId }, { nationalIdHash }] },
    select: TARGET_SELECT,
    orderBy: { createdAt: 'asc' },
    take: 2,
  });
  const byCode = await tx.customer.findUnique({
    where: { legacyMemberCode: input.legacyMemberCode },
    select: TARGET_SELECT,
  });
  const [holder] = byIdentity;
  if (byIdentity.length > 1) return blocked('NATIONAL_ID_CONFLICT', byIdentity[1].id);
  if (holder?.deletedAt) return blocked('NATIONAL_ID_CONFLICT', holder.id);
  if (byCode?.deletedAt) return blocked('NATIONAL_ID_CONFLICT', byCode.id);
  if (holder && byCode && holder.id !== byCode.id)
    return blocked('NATIONAL_ID_CONFLICT', byCode.id);

  if (holder ?? byCode) {
    const target = (holder ?? byCode) as Target;
    // จับคู่ด้วยเลขบัตร (แถวเก่าอาจมีแต่ plaintext) → Contact ใช้ hash ของเลขนี้ · จับคู่ด้วยรหัสสมาชิกอย่างเดียว → hash ของแถว
    const contactKey = target.nationalIdHash ?? (holder ? nationalIdHash : null);
    return linkExisting(tx, pii, target, contactKey, peakCode, input.legacyMemberCode);
  }

  const identityContact = await liveContactByHash(tx, nationalIdHash);
  if (identityContact) {
    // stub ของ ensureRole บน Contact ที่ถือเลขบัตรนี้ = คนเดียวกัน (CustomerWriteService.create upgrade แทน 409)
    const stubs = await tx.customer.findMany({
      where: { contactId: identityContact.id, deletedAt: null },
      select: TARGET_SELECT,
      orderBy: { createdAt: 'asc' },
      take: 2,
    });
    if (stubs.length > 1) return blocked('NATIONAL_ID_CONFLICT', stubs[1].id);
    if (stubs.length === 1) {
      return linkExisting(tx, pii, stubs[0], nationalIdHash, peakCode, input.legacyMemberCode);
    }
  }

  if (input.phone) {
    const owner = await findLivePhoneOwner(tx, input.phone, enc.phoneHash);
    if (owner) return blocked('PHONE_TAKEN', owner.id);
  }
  if (peakConflict(identityContact, peakCode)) return blocked('PEAK_CODE_CONFLICT');

  // ── เขียน ──
  const contact = await contactResolver(tx, pii).findOrCreateByNaturalKey(tx, {
    name: input.name,
    taxId: null,
    nationalIdHash,
    phone: input.phone,
    role: 'CUSTOMER',
  });
  const created = await tx.customer.create({
    data: {
      name: input.name,
      nickname: input.nickname,
      nationalId,
      phone: input.phone ?? '',
      phoneSecondary: input.phoneSecondary,
      birthDate: input.birthDate,
      addressIdCard: input.addressIdCard,
      addressCurrent: input.addressCurrent,
      addressWork: input.addressWork,
      facebookLink: input.facebookLink,
      occupation: input.occupation,
      occupationDetail: input.occupationDetail,
      workplace: input.workplace,
      salary: input.salary,
      legacyMemberCode: input.legacyMemberCode,
      contactId: contact.id,
      nationalIdEncrypted: enc.nationalIdEncrypted,
      nationalIdHash,
      phoneEncrypted: enc.phoneEncrypted,
      phoneHash: enc.phoneHash,
      phoneSecondaryEncrypted: enc.phoneSecondaryEncrypted,
      addressIdCardEncrypted: enc.addressIdCardEncrypted,
      addressCurrentEncrypted: enc.addressCurrentEncrypted,
      addressWorkEncrypted: enc.addressWorkEncrypted,
    },
    select: { id: true },
  });
  const contactPatch: Prisma.ContactUpdateInput = {
    ...(peakCode && !contact.peakContactCode ? { peakContactCode: peakCode } : {}),
    ...(input.lineId && !contact.lineId ? { lineId: input.lineId } : {}),
  };
  if (Object.keys(contactPatch).length > 0) {
    await tx.contact.update({ where: { id: contact.id }, data: contactPatch });
  }
  return { outcome: 'CREATED', customerId: created.id };
}

/** override จากเจ้าของ — ผูกกับลูกค้าที่ระบุ ข้ามการตรวจเลขบัตร/เบอร์ */
async function linkOverride(
  tx: Prisma.TransactionClient,
  pii: CustomerPiiService,
  input: LegacyCustomerInput,
  customerId: string,
  peakCode: string | null,
): Promise<CustomerLinkResult> {
  // ล็อกเบอร์เป็นคำสั่งแรกเหมือนทางปกติ — ผู้เรียกถือสัญญาเดียวกันทุกทาง
  await lockCustomerPhone(tx, pii, input.phone);
  const where = `${OVERRIDE_ERROR}: legacy_member_code ${input.legacyMemberCode}`;
  const target = await tx.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: TARGET_SELECT,
  });
  if (!target) throw new Error(`${where} — ไม่พบลูกค้า ${customerId} (ไม่มี หรือถูกลบแล้ว)`);
  const codeHolder = await tx.customer.findUnique({
    where: { legacyMemberCode: input.legacyMemberCode },
    select: { id: true },
  });
  if (codeHolder && codeHolder.id !== target.id) {
    throw new Error(`${where} — รหัสสมาชิกนี้ผูกกับลูกค้า ${codeHolder.id} อยู่แล้ว`);
  }
  return linkExisting(tx, pii, target, target.nationalIdHash, peakCode, input.legacyMemberCode);
}

/**
 * ผูกกับลูกค้าที่มีอยู่ — ไม่แตะข้อมูลของลูกค้า · `legacyMemberCode` เฉพาะเมื่อว่าง · Contact: ของลูกค้า → ที่ถือ `contactKey`
 * → สร้างใหม่จากชื่อ/เบอร์ของลูกค้าเดิม · ตัดสินกติกา PEAK ก่อนเขียน
 */
async function linkExisting(
  tx: Prisma.TransactionClient,
  pii: CustomerPiiService,
  target: Target,
  contactKey: string | null,
  peakCode: string | null,
  legacyMemberCode: string,
): Promise<CustomerLinkResult> {
  const own = target.contactId
    ? await tx.contact.findFirst({
        where: { id: target.contactId, deletedAt: null },
        select: CONTACT_SELECT,
      })
    : null;
  const known = own ?? (await liveContactByHash(tx, contactKey));
  if (peakConflict(known, peakCode)) return blocked('PEAK_CODE_CONFLICT', target.id);

  // ── เขียน ──
  const contact: ContactRow = own
    ? own
    : await contactResolver(tx, pii).findOrCreateByNaturalKey(tx, {
        name: target.name,
        taxId: null,
        nationalIdHash: contactKey,
        phone: normalizeThaiPhone(target.phone) || null,
        role: 'CUSTOMER',
      });
  const customerPatch: Prisma.CustomerUncheckedUpdateInput = {
    ...(target.legacyMemberCode ? {} : { legacyMemberCode }),
    ...(own ? {} : { contactId: contact.id }),
  };
  if (Object.keys(customerPatch).length > 0) {
    await tx.customer.update({ where: { id: target.id }, data: customerPatch });
  }
  if (peakCode && !contact.peakContactCode) {
    await tx.contact.update({ where: { id: contact.id }, data: { peakContactCode: peakCode } });
  }
  return { outcome: 'LINKED', customerId: target.id };
}
