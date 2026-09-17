/**
 * ซ่อมเบอร์โทรลูกค้า (คำตัดสินเจ้าของ 2026-09-17 ข้อ 2 + ข้อ 4)
 *
 * WHY
 * ---
 * ข้อมูลเก่ามีเบอร์หลายรูปแบบ (`081-234 5678`, `+66…`) และหลายแถวไม่มี `phone_hash` / `phone_encrypted`
 * (บอทขายรุ่นแรกเขียน plaintext อย่างเดียว) หรือมี hash/ciphertext ค้างของเบอร์เก่า (บั๊ก skip-tracing เดิม
 * ตั้ง `phone` โดยไม่เขียน hash ใหม่) ⇒ การตรวจเบอร์ซ้ำฝั่งพนักงาน (หาด้วย `phone_hash`) มองไม่เห็นหรือเห็นผิด
 * CLI นี้ทำให้ทุกแถว: `phone = normalizeThaiPhone(phone)`, `phone_hash = hash(เบอร์นั้น)`,
 * `phone_encrypted = encrypt(เบอร์นั้น)` และ normalize + เข้ารหัส `phone_secondary` — **plaintext คือความจริง**
 * แล้วรายงานกลุ่มลูกค้าที่ถือเบอร์หลักเดียวกัน (id เท่านั้น) ให้เจ้าของแก้ทีละคู่ด้วยมือ
 * (ไม่มีเครื่องมือรวมลูกค้า — คำตัดสินข้อ 4) · runbook: docs/runbooks/2026-09-17-customer-phone-repair-runbook.md
 *
 * GUARDS
 * ------
 * - EXPECTED_DB_NAME บังคับ; ต้องตรงกับ SELECT current_database()
 * - PII_ENCRYPTION_KEY (hex 64 ตัว) + PII_HASH_SALT (≥ 32 ตัว) บังคับ — แม้ dry-run (ต้องใช้คำนวณ hash/ถอดรหัส)
 * - DRY-RUN เป็นค่าเริ่มต้น (อ่านอย่างเดียว) · เขียนจริงเมื่อ APPLY=YES_I_AM_SURE
 * - เขียนลง prod (NODE_ENV=production **หรือ** ฐานชื่อ `bestchoice`) ต้องมี ALLOW_PROD_REPAIR=YES_I_AM_SURE
 * - ด่านกุญแจ: ciphertext ถอดไม่ออก / hash ไม่ตรงทั้งที่ ciphertext ตรง เป็นจำนวนมาก = กุญแจหรือ salt ผิด
 *   ⇒ APPLY หยุดก่อนเขียนแถวแรก (assessKeySafety) · แถวที่ถอดไม่ออกไม่ถูกเขียนเลย
 * - หน่วง 5 วินาทีก่อนเขียนจริง
 * - ไม่พิมพ์ชื่อ/เบอร์/เลขบัตร — มีแต่ตัวนับกับ id
 *
 * WRITE MODEL
 * -----------
 * วางแผนทั้งตารางก่อน (อ่านอย่างเดียว) แล้วค่อยเขียน **ทีละแถวคนละทรานแซกชัน**: ล็อกเบอร์หลัก
 * (`lockCustomerPhone` — คำสั่งแรก หนึ่งเบอร์ต่อทรานแซกชัน ตามกติกาใน .claude/rules/database.md) →
 * `updateMany` ที่มีเงื่อนไขว่าค่าทั้งห้าคอลัมน์ยังเท่าตอนวางแผน (มีคนแก้ระหว่างนั้น = ข้าม นับ changedMeanwhile)
 * ทรานแซกชันเดียวทั้ง batch ใช้ไม่ได้: Postgres ทำให้ทรานแซกชันพังทั้งก้อนเมื่อคำสั่งหนึ่งพัง (ข้ามแถวเสียไม่ได้)
 * และจะถือหลายคีย์เบอร์ในทรานแซกชันเดียว (ฝ่ากติกาลำดับล็อก)
 * ไม่บล็อกเบอร์ซ้ำ — เบอร์ซ้ำถูกรายงานเป็นกลุ่มให้แก้ด้วยมือ
 *
 * INVOCATION
 * ----------
 *   Dry-run:  EXPECTED_DB_NAME=<db> PII_ENCRYPTION_KEY=… PII_HASH_SALT=… npm --prefix apps/api run repair:customer-phones
 *   Apply:    + APPLY=YES_I_AM_SURE [ALLOW_PROD_REPAIR=YES_I_AM_SURE NODE_ENV=production]
 *   Prod:     workflow `Repair Customer Phones (prod)` (Cloud Run Job, node apps/api/dist/src/cli/repair-customer-phones.cli.js)
 *   ตัวเลือก: REPAIR_BATCH_SIZE (ค่าเริ่มต้น 200, 1-1000)
 */

import { Prisma, PrismaClient } from '@prisma/client';
import { CHAT_SOURCE_PREFIX } from '@installment/shared';
import { AuditService } from '../modules/audit/audit.service';
import { BLOCKING_COUNT_SELECT } from '../modules/chat-prospects/customer-blocking-relations';
import { lockCustomerPhone } from '../modules/customers/customer-phone-lock';
import type { PrismaService } from '../prisma/prisma.service';
import { decryptPII, encryptPII, isEncrypted } from '../utils/crypto.util';
import { hashPII } from '../utils/pii.util';
import { normalizeThaiPhone } from '../utils/thai-phone.util';

const TAG = '[repair-customer-phones]';
const REQUIRED_CONSENT = 'YES_I_AM_SURE';
const PROD_DB_NAME = 'bestchoice';
export const DEFAULT_BATCH_SIZE = 200;
export const AUDIT_ACTION = 'CUSTOMER_PHONE_REPAIR_RUN';
const VALID_PHONE = /^0\d{9}$/;
const BOT_SOURCE_PREFIX = 'AI_CHAT';
/** จำนวน id สูงสุดต่อรายการใน REPORT_JSON (ยอดนับยังเต็ม) */
const MAX_LISTED_IDS = 500;
const ID_CHUNK = 1000;

// ─── ตรรกะล้วน (export ให้เทสต์เรียกโดยไม่ต่อ DB) ─────────────────────────────

export interface PhoneCrypto {
  hash(value: string): string;
  encrypt(value: string): string;
  /** throw เมื่อถอดไม่ออก (กุญแจผิด/ข้อมูลเสีย) */
  decrypt(value: string): string;
}

export interface RepairRow {
  id: string;
  phone: string | null;
  phoneHash: string | null;
  phoneEncrypted: string | null;
  phoneSecondary: string | null;
  phoneSecondaryEncrypted: string | null;
}

/** FILLED = คอลัมน์ว่างอยู่ · STALE = มีค่าแต่ไม่ตรงกับเบอร์ (normalize แล้ว) · null = ถูกแล้ว */
export type FixKind = 'FILLED' | 'STALE' | null;

export interface PrimaryPlan {
  to: string;
  formatChanged: boolean;
  hashFix: FixKind;
  encryptFix: FixKind;
}

export interface SecondaryPlan {
  to: string;
  formatChanged: boolean;
  encryptFix: FixKind;
}

export interface RowPlan {
  id: string;
  primary: PrimaryPlan | null;
  secondary: SecondaryPlan | null;
  needsWrite: boolean;
  invalid: boolean;
  invalidSecondary: boolean;
  decryptFailed: boolean;
  /** จำนวนคอลัมน์ ciphertext ที่ถอดไม่ออก (หน่วยเดียวกับ ciphertextCount — ตัวตั้งของด่านกุญแจ) */
  decryptFailedColumns: number;
  /** ciphertext ถอดได้ตรงกับเบอร์ในแถว แต่ hash ไม่ตรงทั้งรูปแบบเดิมและรูปแบบใหม่ = สัญญาณ salt ผิด */
  saltSuspect: boolean;
  /**
   * `phone_hash` เก็บ plaintext ของเบอร์ (ผู้เขียนรุ่นเก่า fallback `salt ? hash(v) : v` ตอนไม่มี salt)
   * = PII รั่วในคอลัมน์ hash — ซ่อมเป็น STALE ตามปกติ แต่ **ไม่นับเป็นสัญญาณ salt ผิด**
   */
  hashPlaintextLeak: boolean;
  /**
   * เบอร์บนหน้าจอจะเปลี่ยนหลัง APPLY: หน้าจอถอดจาก `phone_encrypted` ก่อน (decryptCustomerFields)
   * และ ciphertext นั้นถอดได้เป็น "อีกเบอร์" (ไม่ใช่แค่รูปแบบต่าง) ของเบอร์ใน `phone`
   */
  displayChanged: boolean;
  /** ciphertext ที่อยู่ในรูปแบบเข้ารหัส (ใช้เป็นตัวหารของด่านกุญแจ) */
  ciphertextCount: number;
  /** ciphertext ตรงกับเบอร์ในแถวและมี hash (ตัวหารของด่าน salt) */
  consistentWithHash: boolean;
  /** hash ของเบอร์หลักหลัง normalize — ใช้จับกลุ่มเบอร์ซ้ำเท่านั้น ห้ามพิมพ์ */
  groupKey: string | null;
}

const isBlank = (v: string | null | undefined): boolean => v == null || v === '';

type CipherCheck = { fix: FixKind; decryptFailed: boolean; plain: string | null; encrypted: boolean };

function checkCiphertext(stored: string | null, target: string, crypto: PhoneCrypto): CipherCheck {
  if (target === '') {
    return { fix: isBlank(stored) ? null : 'STALE', decryptFailed: false, plain: null, encrypted: false };
  }
  if (isBlank(stored)) return { fix: 'FILLED', decryptFailed: false, plain: null, encrypted: false };
  // plaintext หลุดเข้าคอลัมน์ ciphertext (ก่อน DEEP review C2) → เข้ารหัสใหม่
  if (!isEncrypted(stored!)) return { fix: 'STALE', decryptFailed: false, plain: null, encrypted: false };
  let plain: string;
  try {
    plain = crypto.decrypt(stored!);
  } catch {
    return { fix: null, decryptFailed: true, plain: null, encrypted: true };
  }
  return { fix: plain === target ? null : 'STALE', decryptFailed: false, plain, encrypted: true };
}

export function planPhoneRepair(row: RepairRow, crypto: PhoneCrypto): RowPlan {
  let primary: PrimaryPlan | null = null;
  let secondary: SecondaryPlan | null = null;
  let decryptFailed = false;
  let decryptFailedColumns = 0;
  let saltSuspect = false;
  let hashPlaintextLeak = false;
  let displayChanged = false;
  let consistentWithHash = false;
  let ciphertextCount = 0;
  let groupKey: string | null = null;
  let invalid = false;
  let invalidSecondary = false;

  if (!isBlank(row.phone)) {
    const raw = row.phone!;
    const to = normalizeThaiPhone(raw) ?? '';
    const cipher = checkCiphertext(row.phoneEncrypted, to, crypto);
    if (cipher.encrypted) ciphertextCount++;
    if (cipher.decryptFailed) decryptFailedColumns++;
    decryptFailed ||= cipher.decryptFailed;
    if (cipher.plain !== null && (normalizeThaiPhone(cipher.plain) ?? '') !== to) displayChanged = true;
    let hashFix: FixKind;
    if (to === '') {
      hashFix = isBlank(row.phoneHash) ? null : 'STALE';
    } else {
      const target = crypto.hash(to);
      groupKey = target;
      hashFix = isBlank(row.phoneHash) ? 'FILLED' : row.phoneHash === target ? null : 'STALE';
      hashPlaintextLeak = !isBlank(row.phoneHash) && (row.phoneHash === raw || row.phoneHash === to);
      if (cipher.plain === raw && !isBlank(row.phoneHash)) {
        consistentWithHash = true;
        saltSuspect =
          !hashPlaintextLeak && row.phoneHash !== target && row.phoneHash !== crypto.hash(raw);
      }
    }
    primary = { to, formatChanged: raw !== to, hashFix, encryptFix: cipher.fix };
    invalid = !VALID_PHONE.test(to);
  }

  if (!isBlank(row.phoneSecondary)) {
    const raw = row.phoneSecondary!;
    const to = normalizeThaiPhone(raw) ?? '';
    const cipher = checkCiphertext(row.phoneSecondaryEncrypted, to, crypto);
    if (cipher.encrypted) ciphertextCount++;
    if (cipher.decryptFailed) decryptFailedColumns++;
    decryptFailed ||= cipher.decryptFailed;
    secondary = { to, formatChanged: raw !== to, encryptFix: cipher.fix };
    invalidSecondary = !VALID_PHONE.test(to);
  }

  const needsWrite =
    !decryptFailed && (primaryChanged(primary) || secondaryChanged(secondary));

  return {
    id: row.id,
    primary,
    secondary,
    needsWrite,
    invalid,
    invalidSecondary,
    decryptFailed,
    decryptFailedColumns,
    saltSuspect,
    hashPlaintextLeak,
    displayChanged,
    ciphertextCount,
    consistentWithHash,
    groupKey,
  };
}

function primaryChanged(p: PrimaryPlan | null): p is PrimaryPlan {
  return !!p && (p.formatChanged || p.hashFix !== null || p.encryptFix !== null);
}

function secondaryChanged(s: SecondaryPlan | null): s is SecondaryPlan {
  return !!s && (s.formatChanged || s.encryptFix !== null);
}

export interface KeySafetyStats {
  /** จำนวน **คอลัมน์** ciphertext ที่ถอดไม่ออก — หน่วยเดียวกับ withCiphertext (ไม่ใช่จำนวนแถว) */
  decryptFailedColumns: number;
  /** จำนวนคอลัมน์ ciphertext ทั้งหมด (เบอร์หลัก + เบอร์สำรอง) */
  withCiphertext: number;
  saltSuspect: number;
  consistentWithHash: number;
}

/**
 * ด่านกุญแจก่อนเขียนจริง — คืนเหตุผลที่ต้องหยุด (ว่าง = ผ่าน)
 * เกณฑ์: ≥ max(5, 10%) ของตัวหาร หรือ "ทุกแถว" ของตัวหาร (กันฐานเล็กที่ไม่ถึง 5)
 * แถวเสียแถวเดียวในหลายพันไม่หยุดทั้งงาน — แถวที่ถอดไม่ออกถูกข้ามอยู่แล้ว
 */
export function assessKeySafety(s: KeySafetyStats): string[] {
  const reasons: string[] = [];
  const tripped = (count: number, base: number) =>
    count > 0 && (count >= Math.max(5, Math.ceil(base * 0.1)) || count >= base);
  if (tripped(s.decryptFailedColumns, s.withCiphertext)) {
    reasons.push(
      `ถอดรหัสไม่ได้ ${s.decryptFailedColumns}/${s.withCiphertext} ค่า — PII_ENCRYPTION_KEY น่าจะไม่ใช่กุญแจของฐานนี้`,
    );
  }
  if (tripped(s.saltSuspect, s.consistentWithHash)) {
    reasons.push(
      `hash ไม่ตรงทั้งที่ ciphertext ตรง ${s.saltSuspect}/${s.consistentWithHash} แถว — PII_HASH_SALT น่าจะไม่ใช่ salt ของฐานนี้`,
    );
  }
  return reasons;
}

export type Origin = 'BOT' | 'CHAT' | 'OTHER';

export function classifyOrigin(acquisitionSource: string | null): Origin {
  if (acquisitionSource?.startsWith(BOT_SOURCE_PREFIX)) return 'BOT';
  if (acquisitionSource?.startsWith(CHAT_SOURCE_PREFIX)) return 'CHAT';
  return 'OTHER';
}

export interface GroupInput {
  id: string;
  groupKey: string | null;
  acquisitionSource: string | null;
  createdAt: Date;
  /** แถวที่ไม่มี plaintext เหลือ มีแต่ phone_hash */
  hashOnly?: boolean;
}

export interface GroupMember {
  id: string;
  origin: Origin;
  acquisitionSource: string | null;
  createdAt: Date;
  hashOnly: boolean;
}

export interface DuplicateGroup {
  hasBotOrChat: boolean;
  members: GroupMember[];
}

/** กลุ่มลูกค้าที่ถือเบอร์หลักเดียวกัน (≥ 2 คน) — ไม่คืน hash · กลุ่มที่มีแถวบอท/แชทก่อน */
export function groupDuplicatePhones(rows: readonly GroupInput[]): DuplicateGroup[] {
  const byKey = new Map<string, GroupMember[]>();
  for (const r of rows) {
    if (!r.groupKey) continue;
    const list = byKey.get(r.groupKey) ?? [];
    list.push({
      id: r.id,
      origin: classifyOrigin(r.acquisitionSource),
      acquisitionSource: r.acquisitionSource,
      createdAt: r.createdAt,
      hashOnly: !!r.hashOnly,
    });
    byKey.set(r.groupKey, list);
  }
  const rank = (m: GroupMember) => (m.origin === 'OTHER' ? 1 : 0);
  const groups: DuplicateGroup[] = [];
  for (const members of byKey.values()) {
    if (members.length < 2) continue;
    members.sort(
      (a, b) =>
        rank(a) - rank(b) ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.id.localeCompare(b.id),
    );
    groups.push({ hasBotOrChat: members.some((m) => m.origin !== 'OTHER'), members });
  }
  const earliest = (g: DuplicateGroup) => Math.min(...g.members.map((m) => m.createdAt.getTime()));
  groups.sort(
    (a, b) =>
      Number(b.hasBotOrChat) - Number(a.hasBotOrChat) ||
      b.members.length - a.members.length ||
      earliest(a) - earliest(b) ||
      a.members[0].id.localeCompare(b.members[0].id),
  );
  return groups;
}

// ─── ตัวรันกับฐานจริง ─────────────────────────────────────────────────────────

export interface RepairCounts {
  scanned: number;
  needsWrite: number;
  formatChanged: number;
  hashFixed: number;
  hashFilled: number;
  hashStale: number;
  encryptedFilled: number;
  encryptedStale: number;
  secondaryFixed: number;
  invalid: number;
  invalidSecondary: number;
  decryptFailed: number;
  saltSuspect: number;
  /** แถวที่ `phone_hash` เก็บ plaintext ของเบอร์ (PII รั่ว) — APPLY เขียน hash จริงทับ */
  hashPlaintextLeak: number;
  /** แถวที่เบอร์บนหน้าจอจะเปลี่ยนเป็นอีกเบอร์หลัง APPLY (ciphertext ค้างของเบอร์เก่า) */
  displayChanged: number;
  written: number;
  changedMeanwhile: number;
  failed: number;
}

export interface ReportGroup {
  customerIds: string[];
  hasBotOrChat: boolean;
  members: Array<{
    id: string;
    origin: Origin;
    acquisitionSource: string | null;
    createdAt: string;
    hashOnly: boolean;
    /** สัญญาที่ยังไม่ถูกลบ (ทุกสถานะ) */
    contracts: number;
    /** ใบขายที่ยังไม่ถูกยกเลิก */
    sales: number;
    /**
     * relation ที่ห้ามลบแถวนี้ทิ้ง (ชุดเดียวกับ CustomerMergeService + creditChecks) เฉพาะที่ > 0
     * นับทุกแถวรวมแถวลูกที่ถูก soft-delete — ลบแถวนี้ได้ก็ต่อเมื่อ blockingTotal = 0
     */
    blocking: Record<string, number>;
    blockingTotal: number;
    /** ห้องแชทที่ยังไม่ถูกลบซึ่งผูกกับคนนี้ (ต้องย้ายหลังลบ — ไม่ใช่ตัวบล็อก) */
    chatRooms: number;
  }>;
}

export interface RepairReport {
  mode: 'DRY-RUN' | 'APPLY';
  counts: RepairCounts;
  /** เหตุผลที่ด่านกุญแจหยุดการเขียน (ว่าง = ไม่หยุด) — APPLY เท่านั้น */
  aborted: string[];
  /** ผลด่านกุญแจ (ทุกโหมด) — DRY-RUN ที่มีค่านี้ = APPLY จะถูกหยุด */
  keyWarnings: string[];
  invalidIds: string[];
  invalidSecondaryIds: string[];
  decryptFailedIds: string[];
  /** แถวที่เบอร์บนหน้าจอจะเปลี่ยนเป็นอีกเบอร์ — รายการที่เจ้าของต้องเห็นก่อน APPLY */
  displayChangedIds: string[];
  failedIdTails: string[];
  duplicateGroupCount: number;
  duplicateGroups: ReportGroup[];
}

export interface RunRepairOptions {
  apply: boolean;
  batchSize?: number;
  /** จำกัดขอบเขต (เทสต์ / ซ่อมเฉพาะแถว) — ไม่ส่ง = ทั้งตาราง */
  customerIds?: string[];
  log?: (line: string) => void;
  /** APPLY: เขียน AuditLog สรุปหนึ่งแถวด้วย system user หลังเขียนเสร็จ (นอกทรานแซกชันใด ๆ) */
  audit?: Pick<AuditService, 'log'>;
  /** หน่วงก่อนเขียนจริง (ms) — main ใช้ 5000 */
  cooldownMs?: number;
  /** เทสต์เท่านั้น: ห่อ client ของทรานแซกชันเขียนแต่ละแถว (จำลองแถวที่เขียนพลาด) */
  wrapWriteTx?: (tx: Prisma.TransactionClient, rowId: string) => Prisma.TransactionClient;
}

type PlannedWrite = { row: RepairRow; plan: RowPlan };

const REPAIR_SELECT = {
  id: true,
  phone: true,
  phoneHash: true,
  phoneEncrypted: true,
  phoneSecondary: true,
  phoneSecondaryEncrypted: true,
  acquisitionSource: true,
  createdAt: true,
} as const;

const nonBlank = (field: 'phone' | 'phoneSecondary' | 'phoneHash') => ({
  AND: [{ [field]: { not: null } }, { [field]: { not: '' } }],
});

const tail = (id: string) => `…${id.slice(-6)}`;

/**
 * relation ที่ห้ามลบแถวลูกค้าทิ้ง = ชุดเดียวกับ CustomerMergeService (BLOCKING_RELATIONS)
 * + creditChecks (ผลเช็คเครดิตที่ไม่ได้มาจากห้องแชท — การรวมผู้สนใจย้ายเฉพาะที่มาจากห้อง)
 */
const REPORT_BLOCKING_SELECT = { ...BLOCKING_COUNT_SELECT, creditChecks: true } as const;

/** สมาชิกต่อบรรทัด DUPLICATE_GROUP — Cloud Logging รับได้ราว 256KB ต่อรายการ (สมาชิกหนึ่งคน ≲ 1KB) */
export const MAX_MEMBERS_PER_LINE = 200;

/** บรรทัด log ของกลุ่มเบอร์ซ้ำ — กลุ่มใหญ่ (เช่นเบอร์หลอก 0000000000) แตกเป็นหลาย part */
export function formatDuplicateGroupLines(groups: readonly ReportGroup[]): string[] {
  const lines: string[] = [];
  groups.forEach((g, i) => {
    const head = `${TAG} DUPLICATE_GROUP ${i + 1}/${groups.length}`;
    if (g.members.length <= MAX_MEMBERS_PER_LINE) {
      lines.push(`${head} ${JSON.stringify(g)}`);
      return;
    }
    const parts = Math.ceil(g.members.length / MAX_MEMBERS_PER_LINE);
    for (let k = 0; k < parts; k++) {
      const members = g.members.slice(k * MAX_MEMBERS_PER_LINE, (k + 1) * MAX_MEMBERS_PER_LINE);
      const part = {
        memberCount: g.members.length,
        oversized: true,
        hasBotOrChat: g.hasBotOrChat,
        customerIds: members.map((m) => m.id),
        members,
      };
      lines.push(`${head} part ${k + 1}/${parts} ${JSON.stringify(part)}`);
    }
  });
  return lines;
}

export async function runRepair(
  prisma: PrismaClient,
  crypto: PhoneCrypto,
  opts: RunRepairOptions,
): Promise<RepairReport> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  const scope: Prisma.CustomerWhereInput = opts.customerIds ? { id: { in: opts.customerIds } } : {};

  const counts: RepairCounts = {
    scanned: 0,
    needsWrite: 0,
    formatChanged: 0,
    hashFixed: 0,
    hashFilled: 0,
    hashStale: 0,
    encryptedFilled: 0,
    encryptedStale: 0,
    secondaryFixed: 0,
    invalid: 0,
    invalidSecondary: 0,
    decryptFailed: 0,
    saltSuspect: 0,
    hashPlaintextLeak: 0,
    displayChanged: 0,
    written: 0,
    changedMeanwhile: 0,
    failed: 0,
  };
  const invalidIds: string[] = [];
  const invalidSecondaryIds: string[] = [];
  const decryptFailedIds: string[] = [];
  const displayChangedIds: string[] = [];
  const failedIdTails: string[] = [];
  const writes: PlannedWrite[] = [];
  const groupInputs: GroupInput[] = [];
  let withCiphertext = 0;
  let decryptFailedColumns = 0;
  let consistentWithHash = 0;

  // ① วางแผน (อ่านอย่างเดียว) — keyset ด้วย id
  let cursor: string | null = null;
  for (;;) {
    const rows: Array<RepairRow & { acquisitionSource: string | null; createdAt: Date }> =
      await prisma.customer.findMany({
        where: {
          ...scope,
          AND: [
            { deletedAt: null },
            { OR: [nonBlank('phone'), nonBlank('phoneSecondary')] },
            ...(cursor ? [{ id: { gt: cursor } }] : []),
          ],
        },
        select: REPAIR_SELECT,
        orderBy: { id: 'asc' },
        take: batchSize,
      });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    for (const row of rows) {
      counts.scanned++;
      const plan = planPhoneRepair(row, crypto);
      withCiphertext += plan.ciphertextCount;
      decryptFailedColumns += plan.decryptFailedColumns;
      if (plan.consistentWithHash) consistentWithHash++;
      if (plan.saltSuspect) counts.saltSuspect++;
      if (plan.hashPlaintextLeak) counts.hashPlaintextLeak++;
      if (plan.displayChanged && plan.needsWrite) {
        counts.displayChanged++;
        displayChangedIds.push(row.id);
      }
      if (plan.invalid) {
        counts.invalid++;
        invalidIds.push(row.id);
      }
      if (plan.invalidSecondary) {
        counts.invalidSecondary++;
        invalidSecondaryIds.push(row.id);
      }
      if (plan.decryptFailed) {
        counts.decryptFailed++;
        decryptFailedIds.push(row.id);
      }
      groupInputs.push({
        id: row.id,
        groupKey: plan.groupKey,
        acquisitionSource: row.acquisitionSource,
        createdAt: row.createdAt,
      });
      if (!plan.needsWrite) continue;
      counts.needsWrite++;
      if (plan.primary?.formatChanged) counts.formatChanged++;
      if (plan.primary?.hashFix) counts.hashFixed++;
      if (plan.primary?.hashFix === 'FILLED') counts.hashFilled++;
      if (plan.primary?.hashFix === 'STALE') counts.hashStale++;
      if (plan.primary?.encryptFix === 'FILLED') counts.encryptedFilled++;
      if (plan.primary?.encryptFix === 'STALE') counts.encryptedStale++;
      if (secondaryChanged(plan.secondary)) counts.secondaryFixed++;
      writes.push({ row, plan });
    }
    log(`${TAG}   ...scanned ${counts.scanned}`);
  }

  // แถวที่ไม่มี plaintext เหลือแต่มี phone_hash — เข้ากลุ่มเบอร์ซ้ำด้วย hash ที่เก็บไว้ (ไม่ซ่อม)
  let hashCursor: string | null = null;
  for (;;) {
    const rows: Array<{ id: string; phoneHash: string | null; acquisitionSource: string | null; createdAt: Date }> =
      await prisma.customer.findMany({
        where: {
          ...scope,
          AND: [
            { deletedAt: null },
            { OR: [{ phone: null }, { phone: '' }] },
            nonBlank('phoneHash'),
            ...(hashCursor ? [{ id: { gt: hashCursor } }] : []),
          ],
        },
        select: { id: true, phoneHash: true, acquisitionSource: true, createdAt: true },
        orderBy: { id: 'asc' },
        take: batchSize,
      });
    if (rows.length === 0) break;
    hashCursor = rows[rows.length - 1].id;
    for (const r of rows) {
      groupInputs.push({
        id: r.id,
        groupKey: r.phoneHash,
        acquisitionSource: r.acquisitionSource,
        createdAt: r.createdAt,
        hashOnly: true,
      });
    }
  }

  // ด่านกุญแจคำนวณทุกโหมด — DRY-RUN แสดงเป็นคำเตือนให้เห็นก่อนสั่ง APPLY
  const keyWarnings = assessKeySafety({
    decryptFailedColumns,
    withCiphertext,
    saltSuspect: counts.saltSuspect,
    consistentWithHash,
  });
  const aborted = opts.apply ? keyWarnings : [];

  // ② เขียน (APPLY เท่านั้น และด่านกุญแจผ่าน)
  if (opts.apply && aborted.length === 0 && writes.length > 0) {
    if (opts.cooldownMs) {
      log(`${TAG} APPLY starting in ${opts.cooldownMs / 1000}s — Ctrl+C to abort.`);
      await new Promise((r) => setTimeout(r, opts.cooldownMs));
    }
    const hasher = { hash: (v: string | null | undefined) => (v ? crypto.hash(v) : null) };
    for (let i = 0; i < writes.length; i++) {
      const { row, plan } = writes[i];
      const data: Prisma.CustomerUpdateManyMutationInput = {};
      if (primaryChanged(plan.primary)) {
        const to = plan.primary.to;
        data.phone = to;
        data.phoneHash = to ? crypto.hash(to) : null;
        data.phoneEncrypted = to ? crypto.encrypt(to) : null;
      }
      if (secondaryChanged(plan.secondary)) {
        const to = plan.secondary.to;
        data.phoneSecondary = to;
        data.phoneSecondaryEncrypted = to ? crypto.encrypt(to) : null;
      }
      try {
        const { count } = await prisma.$transaction(async (rawTx) => {
          const tx = opts.wrapWriteTx ? opts.wrapWriteTx(rawTx, row.id) : rawTx;
          if (primaryChanged(plan.primary)) await lockCustomerPhone(tx, hasher, plan.primary.to);
          return tx.customer.updateMany({
            where: {
              id: row.id,
              deletedAt: null,
              phone: row.phone,
              phoneHash: row.phoneHash,
              phoneEncrypted: row.phoneEncrypted,
              phoneSecondary: row.phoneSecondary,
              phoneSecondaryEncrypted: row.phoneSecondaryEncrypted,
            },
            data,
          });
        });
        if (count > 0) counts.written++;
        else counts.changedMeanwhile++;
      } catch (err) {
        counts.failed++;
        failedIdTails.push(tail(row.id));
        // ข้อความ error ของ Prisma อาจมีค่าคอลัมน์ ⇒ พิมพ์แค่ชนิด/รหัส
        const code = err instanceof Prisma.PrismaClientKnownRequestError ? err.code : (err as Error)?.name;
        log(`${TAG}   failed ${tail(row.id)} (${code ?? 'unknown'})`);
      }
      if ((i + 1) % batchSize === 0 || i === writes.length - 1) {
        log(`${TAG}   ...written ${i + 1}/${writes.length}`);
      }
    }
  }

  // ③ กลุ่มเบอร์ซ้ำ + จำนวนสัญญา/ใบขาย/relation ที่บล็อกการลบ ต่อคน
  const groups = groupDuplicatePhones(groupInputs);
  const memberIds = groups.flatMap((g) => g.members.map((m) => m.id));
  const contractCounts = new Map<string, number>();
  const saleCounts = new Map<string, number>();
  const relationCounts = new Map<string, { blocking: Record<string, number>; chatRooms: number }>();
  for (let i = 0; i < memberIds.length; i += ID_CHUNK) {
    const chunk = memberIds.slice(i, i + ID_CHUNK);
    const [contracts, sales] = await Promise.all([
      prisma.contract.groupBy({
        by: ['customerId'],
        where: { customerId: { in: chunk }, deletedAt: null },
        _count: { _all: true },
      }),
      prisma.sale.groupBy({
        by: ['customerId'],
        where: { customerId: { in: chunk }, deletedAt: null },
        _count: { _all: true },
      }),
    ]);
    for (const c of contracts) contractCounts.set(c.customerId, c._count._all);
    for (const s of sales) saleCounts.set(s.customerId, s._count._all);
    const withCounts = await prisma.customer.findMany({
      where: { id: { in: chunk } },
      select: {
        id: true,
        _count: { select: { ...REPORT_BLOCKING_SELECT, chatRooms: { where: { deletedAt: null } } } },
      },
    });
    for (const c of withCounts) {
      const { chatRooms, ...rest } = c._count;
      const blocking: Record<string, number> = {};
      for (const [k, v] of Object.entries(rest)) if (v > 0) blocking[k] = v;
      relationCounts.set(c.id, { blocking, chatRooms });
    }
  }
  const duplicateGroups: ReportGroup[] = groups.map((g) => ({
    customerIds: g.members.map((m) => m.id),
    hasBotOrChat: g.hasBotOrChat,
    members: g.members.map((m) => ({
      id: m.id,
      origin: m.origin,
      acquisitionSource: m.acquisitionSource,
      createdAt: m.createdAt.toISOString(),
      hashOnly: m.hashOnly,
      contracts: contractCounts.get(m.id) ?? 0,
      sales: saleCounts.get(m.id) ?? 0,
      blocking: relationCounts.get(m.id)?.blocking ?? {},
      blockingTotal: Object.values(relationCounts.get(m.id)?.blocking ?? {}).reduce((a, b) => a + b, 0),
      chatRooms: relationCounts.get(m.id)?.chatRooms ?? 0,
    })),
  }));

  // audit สรุปหนึ่งแถว (ตัวเลขเท่านั้น) — AuditService.log เปิดทรานแซกชันของตัวเอง จึงเรียกหลังทุกทรานแซกชันจบ
  if (opts.apply && aborted.length === 0 && opts.audit) {
    const systemUser = await prisma.user.findFirst({
      where: { isSystemUser: true, deletedAt: null },
      select: { id: true },
    });
    if (systemUser) {
      await opts.audit.log({
        userId: systemUser.id,
        action: AUDIT_ACTION,
        entity: 'customer',
        newValue: { ...counts, duplicateGroupCount: duplicateGroups.length, batchSize },
      });
    } else {
      log(`${TAG} WARNING: ไม่พบ system user — ไม่ได้เขียน AuditLog ${AUDIT_ACTION}`);
    }
  }

  return {
    mode: opts.apply ? 'APPLY' : 'DRY-RUN',
    counts,
    aborted,
    keyWarnings,
    invalidIds: invalidIds.slice(0, MAX_LISTED_IDS),
    invalidSecondaryIds: invalidSecondaryIds.slice(0, MAX_LISTED_IDS),
    decryptFailedIds: decryptFailedIds.slice(0, MAX_LISTED_IDS),
    displayChangedIds: displayChangedIds.slice(0, MAX_LISTED_IDS),
    failedIdTails: failedIdTails.slice(0, MAX_LISTED_IDS),
    duplicateGroupCount: duplicateGroups.length,
    duplicateGroups,
  };
}

/** สรุปอ่านง่าย — ตัวเลขกับ id เท่านั้น */
export function formatSummary(report: RepairReport): string[] {
  const c = report.counts;
  const row = (label: string, value: number | string) => `${TAG}   ${label.padEnd(26)}: ${value}`;
  const lines = [
    `${TAG} ===== SUMMARY (${report.mode}) =====`,
    row('scanned', c.scanned),
    row(report.mode === 'APPLY' ? 'needs repair' : 'needs repair (would-write)', c.needsWrite),
    row('primary format changed', c.formatChanged),
    row('hash fixed (filled/stale)', `${c.hashFixed} (${c.hashFilled}/${c.hashStale})`),
    row('encrypted filled', c.encryptedFilled),
    row('encrypted stale', c.encryptedStale),
    row('secondary fixed', c.secondaryFixed),
    row('invalid primary', c.invalid),
    row('invalid secondary', c.invalidSecondary),
    row('decrypt failed (skipped)', c.decryptFailed),
    row('salt suspect', c.saltSuspect),
    row('hash held plaintext (leak)', c.hashPlaintextLeak),
    row('display number changes', c.displayChanged),
  ];
  if (report.mode === 'APPLY') {
    lines.push(row('written', c.written), row('changed meanwhile', c.changedMeanwhile), row('failed', c.failed));
  }
  const withBot = report.duplicateGroups.filter((g) => g.hasBotOrChat).length;
  lines.push(
    row('duplicate groups', `${report.duplicateGroupCount} (มีแถวบอท/แชท ${withBot})`),
  );
  if (report.aborted.length > 0) {
    for (const reason of report.aborted) lines.push(`${TAG} ABORTED: ${reason}`);
  } else {
    for (const reason of report.keyWarnings) lines.push(`${TAG} WARNING (APPLY จะถูกหยุด): ${reason}`);
  }
  return lines;
}

// ─── main ────────────────────────────────────────────────────────────────────

function fail(message: string): never {
  console.error(`${TAG} ERROR: ${message}`);
  process.exit(1);
}

export function parseBatchSize(raw: string | undefined): number {
  if (!raw) return DEFAULT_BATCH_SIZE;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 && n <= 1000 ? n : DEFAULT_BATCH_SIZE;
}

async function main(): Promise<void> {
  const expectedDb = process.env.EXPECTED_DB_NAME;
  if (!expectedDb) fail('EXPECTED_DB_NAME required (must equal current_database())');
  const key = process.env.PII_ENCRYPTION_KEY ?? '';
  if (!/^[0-9a-fA-F]{64}$/.test(key)) fail('PII_ENCRYPTION_KEY must be 64 hex chars');
  const salt = process.env.PII_HASH_SALT ?? '';
  if (salt.length < 32) fail('PII_HASH_SALT must be >= 32 chars');

  const apply = process.env.APPLY === REQUIRED_CONSENT;
  const batchSize = parseBatchSize(process.env.REPAIR_BATCH_SIZE);
  const prisma = new PrismaClient();

  try {
    const [{ current_database: actualDb }] = await prisma.$queryRaw<{ current_database: string }[]>`
      SELECT current_database()`;
    if (actualDb !== expectedDb) {
      fail(`DB mismatch: connected="${actualDb}" expected="${expectedDb}". Aborting.`);
    }
    const touchingProd = process.env.NODE_ENV === 'production' || actualDb === PROD_DB_NAME;
    if (apply && touchingProd && process.env.ALLOW_PROD_REPAIR !== REQUIRED_CONSENT) {
      fail(`Refusing to write to production DB "${actualDb}" without ALLOW_PROD_REPAIR=${REQUIRED_CONSENT}`);
    }
    console.log(`${TAG} DB: "${actualDb}" | mode: ${apply ? 'APPLY' : 'DRY-RUN'} | batch: ${batchSize}`);

    const crypto: PhoneCrypto = {
      hash: (v) => hashPII(v, salt),
      encrypt: (v) => encryptPII(v, key),
      decrypt: (v) => decryptPII(v, key),
    };
    const audit = new AuditService(prisma as unknown as PrismaService);
    const report = await runRepair(prisma, crypto, { apply, batchSize, cooldownMs: 5000, audit });

    console.log('');
    for (const line of formatSummary(report)) console.log(line);
    // Cloud Logging ตัดบรรทัดที่ยาวเกิน ~256KB ⇒ กลุ่มเบอร์ซ้ำพิมพ์บรรทัดละกลุ่ม (กลุ่มใหญ่แตกเป็น part)
    const { duplicateGroups, ...rest } = report;
    console.log(`${TAG} REPORT_JSON ${JSON.stringify(rest)}`);
    for (const line of formatDuplicateGroupLines(duplicateGroups)) console.log(line);

    if (report.aborted.length > 0) {
      console.error(`${TAG} ไม่ได้เขียนอะไร — ตรวจ PII_ENCRYPTION_KEY / PII_HASH_SALT ของฐานนี้`);
      process.exitCode = 1;
      return;
    }
    if (!apply) {
      console.log(`${TAG} DRY-RUN — ยังไม่เขียนอะไร เขียนจริงด้วย APPLY=${REQUIRED_CONSENT}`);
      return;
    }

    if (report.counts.failed > 0) process.exitCode = 1;
    console.log(`${TAG} Done.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    // ข้อความเต็มของ Prisma อาจมีค่าคอลัมน์ (PII) ⇒ พิมพ์แค่ชนิด/รหัส
    const code = err instanceof Prisma.PrismaClientKnownRequestError ? ` ${err.code}` : '';
    console.error(`${TAG} FATAL: ${err instanceof Error ? err.name : 'unknown'}${code}`);
    process.exit(1);
  });
}
