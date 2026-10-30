import { Prisma } from '@prisma/client';
import { isValidThaiNationalId, type Company } from '@installment/shared';
import { ContactResolverService } from '../../modules/contacts/contact-resolver.service';
import type { CustomerPiiService } from '../../modules/customers/customer-pii.service';
import {
  customerPhoneLockKey,
  lockCustomerPhone,
} from '../../modules/customers/customer-phone-lock';
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
 *    หรือแถวที่ถือ `legacyMemberCode` นี้ (นำเข้ารอบก่อน — เลขบัตรในระบบเก่าเปลี่ยนได้) หรือ stub บน Contact ที่ถือ hash
 *    เลขบัตรนี้ (ลูกค้าจาก `ensureRole` ที่**ไม่มีเลขบัตรเลย** — คนเดียวกันตามกติกาของ `CustomerWriteService.create`)
 *    · เลขบัตรอยู่หลายแถว / แถวที่ถือถูกลบ / รหัสสมาชิกอยู่กับคนอื่น / stub หลายแถว / ลูกค้าบน Contact นั้นมีเลขบัตร
 *    / Contact ของลูกค้าเป้าหมายถูกลบ (ไม่ย้าย `contactId` ให้เอง) → `NATIONAL_ID_CONFLICT`
 * 4. มีเป้าหมาย → `LINKED`: ไม่แตะชื่อ เบอร์ ที่อยู่ ต้นทางสิทธิ์ (`accessCompanyCode` / `accessBranchId` — ของลูกค้าเดิม
 *    และ Contact ที่สร้างให้ลูกค้าเดิม) หรือ PII ใดของลูกค้าเดิม · เติมเฉพาะช่องที่ว่าง: `legacyMemberCode`,
 *    `contactId` และเลขบัตร (`nationalId` / `*_hash` / `*_encrypted` — เมื่อลูกค้าไม่มีเลขบัตรเลย เลขของ input ถูก checksum
 *    และไม่มีแถวใด รวมแถวที่ถูกลบ ถือเลขนี้) · ไม่ตรวจเบอร์ (ไม่ได้เขียนเบอร์)
 * 5. ไม่มีเป้าหมาย: เบอร์เป็นเบอร์หลักของลูกค้าคนอื่นที่ยังไม่ถูกลบ (`findLivePhoneOwner`) → `PHONE_TAKEN`
 *    · ไม่งั้น `CREATED`: dual-write plaintext + `*_encrypted` / `*_hash` (`encryptCustomerFields`) + `legacyMemberCode`
 *    + ต้นทางสิทธิ์ `accessCompanyCode` / `accessBranchId` จาก `options.origin` (`resolveLegacyCustomerOrigin` ของ
 *    `--branch-id` — คำตัดสินเจ้าของ 30/10) ลงทั้งแถวลูกค้าและ Contact ที่สร้างใหม่ (Contact เดิมที่ใช้ซ้ำไม่แตะ — แบบ
 *    `CustomerWriteService.create` ที่ส่ง origin ให้ `findOrCreateByNaturalKey`) · ไม่ส่ง `origin` = สองช่องว่าง
 * 6. ทั้ง `CREATED` และ `LINKED` ได้ `Contact` (party master) ที่ผูกกับลูกค้า: ของเดิมของลูกค้า → Contact ที่ถือ hash
 *    เลขบัตร → สร้างใหม่ (`ContactResolverService.findOrCreateByNaturalKey` — ถือล็อก `contact:code` หลังล็อกเบอร์) ·
 *    `peakContactCode` ตั้งเมื่อ Contact ยังไม่มี · มีรหัสอื่นอยู่แล้ว → `PEAK_CODE_CONFLICT` (ผลบอกรหัสทั้งสองฝั่ง)
 * 7. ผล `CREATED` / `LINKED` มี `writes` = ช่องที่เขียนจริง (`LEGACY_CUSTOMER_WRITES` · LINKED ที่ไม่ได้เขียนอะไร = `[]`)
 *    ให้ผู้เรียกเขียน audit / รายงานหลัง commit · input ที่เบอร์ผิดรูปแบบ (`phoneInvalid`) → ผลทุกแบบติด `phoneInvalid: true`
 *
 * **override** (`--customer-overrides`, เจ้าของกรอก): ผูกกับ `customer_id` ที่ระบุ ข้ามการตรวจเลขบัตร/เบอร์ แต่ยังใช้กติกา
 * PEAK code และกติกาเติมช่องว่างข้อ 4 · ลูกค้าไม่มี/ถูกลบ หรือรหัสสมาชิกอยู่กับลูกค้าคนอื่น = throw (แก้ไฟล์)
 *
 * ## สัญญากับผู้เรียก (Task 10)
 * - **เรียกหนึ่งครั้งต่อหนึ่งสัญญา ไม่ใช่ต่อสมาชิก** — สัญญาที่สองของสมาชิกเดิมได้ `LINKED` ที่ `writes` ว่าง หรือ
 *   `PEAK_CODE_CONFLICT` (รหัส PEAK ของสองสัญญาไม่ตรงกัน — ลูกค้าหนึ่งคนมีรหัส PEAK ได้รหัสเดียว)
 * - กติกาล็อกเบอร์ (`.claude/rules/database.md` "ล็อกเบอร์หลักของลูกค้า") มีสองแบบ:
 *   - **ทรานแซกชันหลักเดียว (แนะนำ — ด่านไม่ผ่าน = rollback ทั้งก้อน):** `lockLegacyCustomerPhones(tx, pii, ทุก input)`
 *     เป็นคำสั่งแรกของทรานแซกชัน (ล็อกทุกเบอร์แบบไม่ซ้ำ เรียงคีย์ — กติกาข้อ 2) แล้วเรียกทีละสัญญาด้วย
 *     `{ phoneLocked: true }` — ผู้เรียกรับประกันว่าเบอร์ของทุก input ที่ส่งเข้ามาถูกล็อกแล้ว · ล็อกเบอร์ทั้งหมดมาก่อน
 *     `contact:code` ทุกครั้ง (กติกาข้อ 3) · ราว 700 ล็อกในทรานแซกชันเดียวใช้ lock table ร่วม
 *     (`max_locks_per_transaction × max_connections`) — ตรวจค่าบน Cloud SQL ตอนซ้อม
 *   - **หนึ่งลูกค้าต่อหนึ่งทรานแซกชัน (ค่าเริ่มต้น):** การเรียกต้องเป็นคำสั่งแรกของทรานแซกชัน (ล็อกเบอร์ของ input เอง)
 *     ห้ามเรียกซ้ำในทรานแซกชันเดียว และห้ามเรียกหลังคำสั่งอื่น (โดยเฉพาะล็อกแถวลูกค้า หรือล็อก `contact:code`)
 * - ต้องตั้ง `PII_ENCRYPTION_KEY` / `PII_HASH_SALT` (ไม่มี = throw ไม่เขียน plaintext ลงช่องเข้ารหัส)
 * - error ของฐาน (เช่น P2002 เมื่อพนักงานสร้างลูกค้าเลขบัตรเดียวกันพร้อมกัน) ไม่ถูกแปลง — ในโหมดทรานแซกชันเดียว (Task 10) ทั้งรอบนำเข้าจะ rollback แล้วต้องแก้ข้อมูลและรันใหม่ (ไม่มีการลงเป็นตัวบล็อกรายคน)
 * - ลูกค้าที่สร้าง (`CREATED`) ได้ต้นทางสิทธิ์ตาม `options.origin` — ตัวเขียนส่งผลของ `resolveLegacyCustomerOrigin(--branch-id)`
 *
 * เบอร์: หลัง `normalizeThaiPhone` รับเฉพาะ `^0\d{9}$` (ตรงกับ DTO ของ API และการค้นเบอร์ของ LINE OTP) — ไม่มีช่องไหนถูกรูปแบบ
 * = ไม่มีเบอร์ (`phone: null` · `phoneInvalid: true` เมื่อมีค่าแต่ผิดรูปแบบ) · เบอร์สำรองที่ผิดรูปแบบหรือเท่าเบอร์หลัก = null
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
  /** `normalizeThaiPhone` แล้วและตรง `^0\d{9}$` · ไม่มี/ผิดรูปแบบ = null (สร้างลูกค้าด้วยเบอร์ `''` แบบ stub) */
  phone: string | null;
  /** ระบบเก่ามีเบอร์แต่ไม่มีช่องไหนถูกรูปแบบ — นำเข้าแบบไม่มีเบอร์ (T13 ลงรายการรหัสสมาชิก) */
  phoneInvalid: boolean;
  /** ถูกรูปแบบและไม่เท่าเบอร์หลัก */
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

/** ช่องที่ `linkOrCreateLegacyCustomer` เขียนได้ — ลำดับนี้คือลำดับใน `writes` */
export const LEGACY_CUSTOMER_WRITES = [
  /** สร้างแถวลูกค้า (รวม `legacyMemberCode` + `contactId` ของแถวใหม่) */
  'customerCreated',
  'contactCreated',
  /** ผูก `contactId` ให้ลูกค้าเดิมที่ยังไม่มี Contact */
  'contactId',
  'legacyMemberCode',
  /** เติมเลขบัตร (plaintext + hash + ciphertext) ให้ลูกค้าเดิมที่ไม่มีเลขบัตร */
  'nationalId',
  'peakContactCode',
  'contactLineId',
] as const;
export type LegacyCustomerWrite = (typeof LEGACY_CUSTOMER_WRITES)[number];

/** input มีเบอร์แต่ผิดรูปแบบ — ติดกับผลทุกแบบ */
type PhoneFlag = { phoneInvalid?: true };

export type CustomerLinkResult = PhoneFlag &
  (
    | { outcome: 'CREATED' | 'LINKED'; customerId: string; writes: LegacyCustomerWrite[] }
    | {
        outcome: 'PHONE_TAKEN' | 'INVALID_NATIONAL_ID' | 'NATIONAL_ID_CONFLICT';
        customerId: null;
        /** ลูกค้าที่ทำให้บล็อก (เจ้าของเบอร์ / แถวที่ถือเลขบัตร / ลูกค้าที่ Contact ถูกลบ) — ใช้กรอก override */
        relatedCustomerId?: string;
      }
    | {
        outcome: 'PEAK_CODE_CONFLICT';
        customerId: null;
        /** ลูกค้าเป้าหมาย (ไม่มีเมื่อ Contact ที่ถือเลขบัตรยังไม่มีลูกค้า) */
        relatedCustomerId?: string;
        existingPeakContactCode: string;
        requestedPeakContactCode: string;
      }
  );

/**
 * ต้นทางสิทธิ์ (immutable origin) ของลูกค้าที่การนำเข้าสร้าง — **SHOP + สาขา `--branch-id` เสมอ** (ทุกสาขาอยู่ใต้ SHOP ·
 * `AccessPartySourceService.origin` รับเฉพาะสาขาใต้ SHOP) · สาขาไม่ผูกบริษัท (`company_id` ว่าง — สาขาบน prod 30/10) = ค่าแทน SHOP
 * และ `companyFallback: true` ให้ผู้เรียกเตือน (คำตัดสินผู้คุมงาน 30/10)
 */
export type LegacyCustomerOrigin = {
  accessCompanyCode: Company;
  accessBranchId: string;
  companyFallback: boolean;
};

/** รหัสบริษัทของต้นทางสิทธิ์ทุกแถวที่การนำเข้าสร้าง (ทางปกติและค่าแทน) */
export const LEGACY_ORIGIN_FALLBACK_COMPANY: Company = 'SHOP';
/** ข้อความเตือนเมื่อใช้ค่าแทน (บนจอ + `import-result.json`) */
export const LEGACY_ORIGIN_FALLBACK_WARNING =
  'สาขา --branch-id ไม่ผูกบริษัท (branches.company_id ว่าง) — ลูกค้าที่สร้างใหม่ได้ accessCompanyCode SHOP แทน (ทุกสาขาอยู่ใต้ SHOP)';

const ORIGIN_ERROR = 'ตั้งต้นทางสิทธิ์ของลูกค้าที่นำเข้าไม่ได้ (--branch-id)';
/** ต่อท้ายทุกข้อความ throw — บอกว่าทำไมต้องหยุดก่อนเขียน แทนที่จะเขียนแล้วค่อยแก้ */
const ORIGIN_IMMUTABLE_NOTE =
  'ต้นทางสิทธิ์ของลูกค้า/ผู้ติดต่อเขียนแล้วแก้ไม่ได้ (trigger immutable_party_access_origin) — แก้สาขา/บริษัทก่อนแล้วรันใหม่';

const originError = (reason: string) =>
  new Error(`${ORIGIN_ERROR}: ${reason} — ${ORIGIN_IMMUTABLE_NOTE}`);

/**
 * ต้นทางสิทธิ์ของลูกค้าที่สร้างจากการนำเข้า (ดู `LegacyCustomerOrigin`) — อ่านอย่างเดียว · ทุกกรณีที่ไม่ใช่สองทางนี้ = throw
 * ก่อนเขียน (ข้อความไทยบอกเหตุ):
 * - สาขา active + ยังไม่ลบ · บริษัทของสาขาเป็น SHOP ที่ active + ยังไม่ลบ → `{ SHOP, สาขา, companyFallback: false }`
 * - สาขา active + ยังไม่ลบ · ไม่ผูกบริษัท · มีบริษัท SHOP ที่ active + ยังไม่ลบ → `{ SHOP, สาขา, companyFallback: true }`
 *
 * ปฏิเสธ: ไม่พบสาขา / สาขาถูกลบ / สาขาปิดใช้งาน / บริษัทของสาขาไม่ใช่ SHOP (รวม FINANCE และรหัสว่าง) / บริษัท SHOP ปิดใช้งาน
 * หรือถูกลบ / ต้องใช้ค่าแทนแต่ไม่มีบริษัท SHOP ที่ใช้งานได้
 */
export async function resolveLegacyCustomerOrigin(
  db: Pick<Prisma.TransactionClient, 'branch' | 'companyInfo'>,
  branchId: string,
): Promise<LegacyCustomerOrigin> {
  const branch = await db.branch.findFirst({
    where: { id: branchId },
    select: {
      id: true,
      isActive: true,
      deletedAt: true,
      company: { select: { companyCode: true, isActive: true, deletedAt: true } },
    },
  });
  if (!branch) throw originError(`ไม่พบสาขา ${branchId}`);
  if (branch.deletedAt) throw originError(`สาขา ${branchId} ถูกลบแล้ว`);
  if (!branch.isActive) throw originError(`สาขา ${branchId} ปิดใช้งานอยู่`);

  const company = branch.company;
  if (company === null) {
    const shop = await db.companyInfo.findFirst({
      where: { companyCode: LEGACY_ORIGIN_FALLBACK_COMPANY, isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (!shop) {
      throw originError(
        `สาขา ${branchId} ไม่ผูกบริษัท และไม่มีบริษัท ${LEGACY_ORIGIN_FALLBACK_COMPANY} ที่ใช้งานได้ในฐานให้ใช้แทน`,
      );
    }
    return {
      accessCompanyCode: LEGACY_ORIGIN_FALLBACK_COMPANY,
      accessBranchId: branch.id,
      companyFallback: true,
    };
  }
  if (company.companyCode !== LEGACY_ORIGIN_FALLBACK_COMPANY) {
    throw originError(
      `สาขา ${branchId} ผูกบริษัทรหัส ${company.companyCode ?? '(ว่าง)'} — ต้นทางสิทธิ์ต้องเป็นสาขาใต้ SHOP (ทุกสาขาอยู่ใต้ SHOP · FINANCE ไม่มีสาขา)`,
    );
  }
  if (company.deletedAt || !company.isActive) {
    throw originError(`บริษัท SHOP ของสาขา ${branchId} ปิดใช้งานหรือถูกลบแล้ว`);
  }
  return {
    accessCompanyCode: LEGACY_ORIGIN_FALLBACK_COMPANY,
    accessBranchId: branch.id,
    companyFallback: false,
  };
}

/**
 * `{ phoneLocked: true }` = ผู้เรียกล็อกเบอร์ของ input นี้ไว้แล้วด้วย `lockLegacyCustomerPhones` (ทรานแซกชันหลักเดียว) ·
 * `origin` = ต้นทางสิทธิ์ของแถวที่สร้าง (`CREATED` เท่านั้น — `LINKED` ไม่แตะ)
 */
export type LinkLegacyCustomerOptions = {
  phoneLocked?: boolean;
  origin?: Pick<LegacyCustomerOrigin, 'accessCompanyCode' | 'accessBranchId'>;
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
/** รูปแบบเดียวกับ DTO ของลูกค้า (`^0[0-9]{9}$`) */
const VALID_PHONE = /^0\d{9}$/;

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

/**
 * เบอร์แรกที่ถูกรูปแบบหลัง normalize · `invalid` = มีช่องที่มีค่าแต่ไม่มีช่องไหนถูกรูปแบบ
 * (ช่องที่มีแต่ขีด/ช่องว่างนับเป็นว่าง และไม่บังช่องสำรอง)
 */
function pickPhone(...raws: Array<string | null>): { phone: string | null; invalid: boolean } {
  let invalid = false;
  for (const raw of raws) {
    const phone = normalizeThaiPhone(raw);
    if (!phone) continue;
    if (VALID_PHONE.test(phone)) return { phone, invalid: false };
    invalid = true;
  }
  return { phone: null, invalid };
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
  const primary = pickPhone(m(MEMBER.phone), o(ORDER.phone), o(ORDER.mobile));
  const secondary = pickPhone(m(MEMBER.phone2), o(ORDER.phone2)).phone;

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
    phone: primary.phone,
    phoneInvalid: primary.invalid,
    phoneSecondary: secondary && secondary !== primary.phone ? secondary : null,
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
  nationalId: true,
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
  deletedAt: true,
} satisfies Prisma.ContactSelect;
type ContactRow = Prisma.ContactGetPayload<{ select: typeof CONTACT_SELECT }>;

type Blocked = 'PHONE_TAKEN' | 'INVALID_NATIONAL_ID' | 'NATIONAL_ID_CONFLICT';

function blocked(outcome: Blocked, relatedCustomerId?: string): CustomerLinkResult {
  return relatedCustomerId
    ? { outcome, customerId: null, relatedCustomerId }
    : { outcome, customerId: null };
}

/** Contact มีรหัส PEAK อื่นอยู่แล้ว → ผล `PEAK_CODE_CONFLICT` · ว่าง หรือรหัสเดียวกัน = null (ไม่ชน) */
function peakConflict(
  contact: ContactRow | null,
  peakCode: string | null,
  relatedCustomerId?: string,
): CustomerLinkResult | null {
  const existing = contact?.peakContactCode;
  if (!existing || !peakCode || existing === peakCode) return null;
  return {
    outcome: 'PEAK_CODE_CONFLICT',
    customerId: null,
    ...(relatedCustomerId ? { relatedCustomerId } : {}),
    existingPeakContactCode: existing,
    requestedPeakContactCode: peakCode,
  };
}

/** `writes` ตามลำดับของ `LEGACY_CUSTOMER_WRITES` */
const orderedWrites = (writes: ReadonlySet<LegacyCustomerWrite>) =>
  LEGACY_CUSTOMER_WRITES.filter((w) => writes.has(w));

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
 * ล็อกเบอร์ของทุก input ในทรานแซกชันหลักเดียว — **ต้องเป็นคำสั่งแรกของทรานแซกชัน** แล้วเรียก
 * `linkOrCreateLegacyCustomer(…, { phoneLocked: true })` ทีละสัญญา
 *
 * คีย์เดียวกับ `lockCustomerPhone` (`customerPhoneLockKey`) · ไม่ซ้ำ · เรียงคีย์ก่อนล็อก (`database.md` กติกาข้อ 2 —
 * ผู้ล็อกหลายเบอร์ทุกรายเรียงแบบเดียวกันจึงไม่วนรอกัน) · input ที่ไม่มีเบอร์ไม่ล็อก
 */
export async function lockLegacyCustomerPhones(
  tx: Prisma.TransactionClient,
  pii: CustomerPiiService,
  inputs: readonly LegacyCustomerInput[],
): Promise<void> {
  const phoneOfKey = new Map<string, string>();
  for (const { phone } of inputs) {
    const key = customerPhoneLockKey(pii, phone);
    if (key && phone && !phoneOfKey.has(key)) phoneOfKey.set(key, phone);
  }
  for (const key of [...phoneOfKey.keys()].sort()) {
    await lockCustomerPhone(tx, pii, phoneOfKey.get(key));
  }
}

/**
 * ผูกลูกค้าระบบเก่ากับลูกค้าเดิม หรือสร้างใหม่ — กติกาและสัญญากับผู้เรียกอยู่ในหัวไฟล์
 * (**หนึ่งครั้งต่อสัญญา** · ค่าเริ่มต้นล็อกเบอร์เองเป็นคำสั่งแรกของทรานแซกชัน · `phoneLocked: true` = ไม่ล็อก ผู้เรียก
 * ล็อกไว้แล้วด้วย `lockLegacyCustomerPhones`)
 */
export async function linkOrCreateLegacyCustomer(
  tx: Prisma.TransactionClient,
  pii: CustomerPiiService,
  input: LegacyCustomerInput,
  options: LinkLegacyCustomerOptions = {},
): Promise<CustomerLinkResult> {
  const result = await resolveLegacyCustomer(
    tx,
    pii,
    input,
    options.phoneLocked === true,
    options.origin,
  );
  return input.phoneInvalid ? { ...result, phoneInvalid: true } : result;
}

async function resolveLegacyCustomer(
  tx: Prisma.TransactionClient,
  pii: CustomerPiiService,
  input: LegacyCustomerInput,
  phoneLocked: boolean,
  origin: LinkLegacyCustomerOptions['origin'],
): Promise<CustomerLinkResult> {
  const peakCode = input.peakContactCode?.trim() || null;
  if (peakCode && !PEAK_CONTACT_CODE.test(peakCode)) {
    throw new Error(
      `${INPUT_ERROR}: รหัสผู้ติดต่อ PEAK ของสมาชิก ${input.legacyMemberCode} ต้องเป็น A-Z 0-9 - _ . ยาว 1–20 ตัว`,
    );
  }
  // ① คำสั่งแรกของทรานแซกชัน — ก่อน contact:code (findOrCreateByNaturalKey) ตามกติกาลำดับล็อก
  const lockPhone = () =>
    phoneLocked ? Promise.resolve() : lockCustomerPhone(tx, pii, input.phone);

  if (input.overrideCustomerId) {
    await lockPhone();
    return linkOverride(tx, pii, input, input.overrideCustomerId, peakCode);
  }

  const nationalId = input.nationalId;
  if (!nationalId || !isValidThaiNationalId(nationalId)) return blocked('INVALID_NATIONAL_ID');
  await lockPhone();

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
  if (holder && byCode && holder.id !== byCode.id) {
    return blocked('NATIONAL_ID_CONFLICT', byCode.id);
  }

  const link = { peakCode, legacyMemberCode: input.legacyMemberCode, fillNationalId: nationalId };
  if (holder ?? byCode) {
    const target = (holder ?? byCode) as Target;
    // จับคู่ด้วยเลขบัตร (แถวเก่าอาจมีแต่ plaintext) → Contact ใช้ hash ของเลขนี้ · จับคู่ด้วยรหัสสมาชิกอย่างเดียว → hash ของแถว
    const contactKey = target.nationalIdHash ?? (holder ? nationalIdHash : null);
    return linkExisting(tx, pii, { ...link, target, contactKey });
  }

  const identityContact = await liveContactByHash(tx, nationalIdHash);
  if (identityContact) {
    // stub ของ ensureRole (ไม่มีเลขบัตรเลย) บน Contact ที่ถือเลขบัตรนี้ = คนเดียวกัน (CustomerWriteService.create upgrade
    // แทน 409) · ลูกค้าบน Contact นั้นที่มีเลขบัตร (ซึ่งไม่ใช่เลขนี้ — ไม่งั้นเจอใน byIdentity) = ข้อมูลขัดกันเอง
    const onContact = await tx.customer.findMany({
      where: { contactId: identityContact.id, deletedAt: null },
      select: TARGET_SELECT,
      orderBy: { createdAt: 'asc' },
      take: 2,
    });
    const keyed = onContact.find((c) => c.nationalId || c.nationalIdHash);
    if (keyed) return blocked('NATIONAL_ID_CONFLICT', keyed.id);
    if (onContact.length > 1) return blocked('NATIONAL_ID_CONFLICT', onContact[1].id);
    if (onContact.length === 1) {
      return linkExisting(tx, pii, { ...link, target: onContact[0], contactKey: nationalIdHash });
    }
  }

  if (input.phone) {
    const owner = await findLivePhoneOwner(tx, input.phone, enc.phoneHash);
    if (owner) return blocked('PHONE_TAKEN', owner.id);
  }
  const conflict = peakConflict(identityContact, peakCode);
  if (conflict) return conflict;

  // ── เขียน ── (ต้นทางสิทธิ์: แถวลูกค้าใหม่ + Contact ใหม่เท่านั้น — `findOrCreateByNaturalKey` ใส่ origin ตอนสร้างเท่านั้น)
  const access = origin
    ? { accessCompanyCode: origin.accessCompanyCode, accessBranchId: origin.accessBranchId }
    : null;
  const writes = new Set<LegacyCustomerWrite>(['customerCreated']);
  const contact = await contactResolver(tx, pii).findOrCreateByNaturalKey(tx, {
    name: input.name,
    taxId: null,
    nationalIdHash,
    phone: input.phone,
    role: 'CUSTOMER',
    ...(access ? { origin: access } : {}),
  });
  if (!identityContact) writes.add('contactCreated');
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
      ...(access ?? {}),
    },
    select: { id: true },
  });
  const contactPatch: Prisma.ContactUpdateInput = {};
  if (peakCode && !contact.peakContactCode) {
    contactPatch.peakContactCode = peakCode;
    writes.add('peakContactCode');
  }
  if (input.lineId && !contact.lineId) {
    contactPatch.lineId = input.lineId;
    writes.add('contactLineId');
  }
  if (Object.keys(contactPatch).length > 0) {
    await tx.contact.update({ where: { id: contact.id }, data: contactPatch });
  }
  return { outcome: 'CREATED', customerId: created.id, writes: orderedWrites(writes) };
}

/** override จากเจ้าของ — ผูกกับลูกค้าที่ระบุ ข้ามการตรวจเลขบัตร/เบอร์ (ผู้เรียกล็อกเบอร์แล้ว) */
async function linkOverride(
  tx: Prisma.TransactionClient,
  pii: CustomerPiiService,
  input: LegacyCustomerInput,
  customerId: string,
  peakCode: string | null,
): Promise<CustomerLinkResult> {
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
  const validId =
    input.nationalId && isValidThaiNationalId(input.nationalId) ? input.nationalId : null;
  return linkExisting(tx, pii, {
    target,
    contactKey: target.nationalIdHash,
    peakCode,
    legacyMemberCode: input.legacyMemberCode,
    fillNationalId: validId,
  });
}

/**
 * เลขบัตรที่เติมให้ลูกค้าเดิมได้ — ลูกค้าไม่มีเลขบัตรเลย (plaintext และ hash ว่าง) และไม่มีแถวใด (รวมแถวที่ถูกลบ) ถือเลขนี้
 * · ไม่เข้าเงื่อนไข = null (ไม่เติม ไม่บล็อก)
 */
async function nationalIdFill(
  tx: Prisma.TransactionClient,
  pii: CustomerPiiService,
  target: Target,
  nationalId: string | null,
) {
  if (!nationalId || target.nationalId || target.nationalIdHash) return null;
  const enc = pii.encryptCustomerFields({ nationalId });
  const nationalIdHash = enc.nationalIdHash as string;
  const holders = await tx.customer.count({
    where: { OR: [{ nationalId }, { nationalIdHash }] },
  });
  return holders > 0
    ? null
    : { nationalId, nationalIdHash, nationalIdEncrypted: enc.nationalIdEncrypted ?? null };
}

/**
 * ผูกกับลูกค้าที่มีอยู่ — ไม่แตะข้อมูลของลูกค้า · เติมเฉพาะช่องที่ว่าง (`legacyMemberCode`, `contactId`, เลขบัตร) ·
 * Contact: ของลูกค้า (ถูกลบ = `NATIONAL_ID_CONFLICT` ไม่ย้ายให้) → ที่ถือ `contactKey` → สร้างใหม่จากชื่อ/เบอร์ของลูกค้าเดิม ·
 * ตัดสินทุกอย่างก่อนเขียน
 */
async function linkExisting(
  tx: Prisma.TransactionClient,
  pii: CustomerPiiService,
  args: {
    target: Target;
    contactKey: string | null;
    peakCode: string | null;
    legacyMemberCode: string;
    /** เลขบัตรของ input ที่ผ่าน checksum แล้ว — เติมเมื่อลูกค้าไม่มีเลขบัตร (`nationalIdFill`) */
    fillNationalId: string | null;
  },
): Promise<CustomerLinkResult> {
  const { target, contactKey, peakCode, legacyMemberCode } = args;
  let own: ContactRow | null = null;
  if (target.contactId) {
    own = await tx.contact.findUnique({ where: { id: target.contactId }, select: CONTACT_SELECT });
    if (!own || own.deletedAt) return blocked('NATIONAL_ID_CONFLICT', target.id);
  }
  const known = own ?? (await liveContactByHash(tx, contactKey));
  const conflict = peakConflict(known, peakCode, target.id);
  if (conflict) return conflict;
  const fill = await nationalIdFill(tx, pii, target, args.fillNationalId);

  // ── เขียน ──
  const writes = new Set<LegacyCustomerWrite>();
  let contact = own;
  if (!contact) {
    contact = await contactResolver(tx, pii).findOrCreateByNaturalKey(tx, {
      name: target.name,
      taxId: null,
      nationalIdHash: contactKey,
      phone: normalizeThaiPhone(target.phone) || null,
      role: 'CUSTOMER',
    });
    if (!known) writes.add('contactCreated');
    writes.add('contactId');
  }
  if (!target.legacyMemberCode) writes.add('legacyMemberCode');
  if (fill) writes.add('nationalId');
  const customerPatch: Prisma.CustomerUncheckedUpdateInput = {
    ...(writes.has('contactId') ? { contactId: contact.id } : {}),
    ...(writes.has('legacyMemberCode') ? { legacyMemberCode } : {}),
    ...(fill ?? {}),
  };
  if (Object.keys(customerPatch).length > 0) {
    await tx.customer.update({ where: { id: target.id }, data: customerPatch });
  }
  if (peakCode && !contact.peakContactCode) {
    await tx.contact.update({ where: { id: contact.id }, data: { peakContactCode: peakCode } });
    writes.add('peakContactCode');
  }
  return { outcome: 'LINKED', customerId: target.id, writes: orderedWrites(writes) };
}
