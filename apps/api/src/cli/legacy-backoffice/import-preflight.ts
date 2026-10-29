import type { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { StorageService } from '../../modules/storage/storage.service';
import { decryptPII, isEncrypted } from '../../utils/crypto.util';
import { bangkokCalendarParts, bangkokDateString } from '../../utils/date.util';
import { hashPII } from '../../utils/pii.util';
import { normalizeThaiPhone } from '../../utils/thai-phone.util';
import { assessKeySafety } from '../repair-customer-phones.cli';
import { DEFAULT_OVERDUE_DAYS_THRESHOLD } from './plan-import';

/**
 * ด่านก่อนเขียนของคำสั่ง `import` (Task 13) — ทุกฟังก์ชัน throw ข้อความไทยที่บอกวิธีแก้ · ไม่เขียนฐาน · ไม่พิมพ์ค่า PII
 * (ลำดับที่ใช้อยู่ที่ `runImport` ใน `legacy-backoffice-import.cli.ts`)
 */

export const CONSENT = 'YES_I_AM_SURE';
/** ชื่อฐาน prod (เหมือน `repair-customer-phones.cli.ts`) — ต่อฐานนี้ต้องมี `ALLOW_PROD_LEGACY_IMPORT` แม้ไม่ได้ตั้ง NODE_ENV */
export const PROD_DB_NAME = 'bestchoice';
export const BANGKOK_TZ = 'Asia/Bangkok';
/** รอบเขียนจริง: วันตัดต้องไม่เกินวันนี้ (กรุงเทพ) และไม่เก่ากว่านี้ */
export const MAX_CUTOFF_AGE_DAYS = 7;
const PII_SAMPLE_ROWS = 100;
const DAY_MS = 86_400_000;

export type Env = Record<string, string | undefined>;

/**
 * เขตเวลาของโปรเซสต้องเป็นกรุงเทพก่อน `Date` ตัวแรก — `nextEntryNumber` ตั้งเดือนของเลขที่รายการและคีย์ล็อกจาก
 * `getFullYear()/getMonth()` ของโปรเซส (รายการไล่ VAT 1 ธ.ค. 00:05 ภายใต้ UTC = เลข JE-202611-…) · ตั้ง `TZ` แบบเดียวกับ
 * `installRuntimeGlobals()` แล้วตรวจกับ Intl
 */
export function ensureBangkokTimeZone(
  env: Env = process.env,
  resolvedTimeZone: () => string = () => Intl.DateTimeFormat().resolvedOptions().timeZone,
): void {
  env.TZ = BANGKOK_TZ;
  const tz = resolvedTimeZone();
  if (tz !== BANGKOK_TZ) {
    throw new Error(
      `เขตเวลาของโปรเซสเป็น ${tz} ไม่ใช่ ${BANGKOK_TZ} — รันใหม่ด้วย TZ=${BANGKOK_TZ} (เลขที่รายการบัญชีและงวดบัญชีอ่านเดือนตามเขตเวลาของโปรเซส)`,
    );
  }
}

/** ด่านจาก env — ก่อนแตะฐาน/ไฟล์ใด */
export function importMode(
  env: Env,
  allowBlockers: boolean,
): { expectedDb: string; dryRun: boolean } {
  const expectedDb = env.EXPECTED_DB_NAME;
  if (!expectedDb) {
    throw new Error(
      'ต้องตั้ง EXPECTED_DB_NAME=<ชื่อฐานที่ตั้งใจนำเข้า> (ตรวจกับ current_database() ก่อนแตะฐาน)',
    );
  }
  const dryRun = env.CONFIRM_LEGACY_IMPORT !== CONSENT;
  if (!dryRun && allowBlockers) {
    throw new Error(
      `--allow-blockers ใช้ซ้อมแบบ dry-run เท่านั้น — เขียนจริง (CONFIRM_LEGACY_IMPORT=${CONSENT}) ต้องไม่มีตัวบล็อกเลย`,
    );
  }
  assertProdAllowed(env, env.NODE_ENV === 'production');
  return { expectedDb, dryRun };
}

export function assertProdAllowed(env: Env, production: boolean): void {
  if (production && env.ALLOW_PROD_LEGACY_IMPORT !== CONSENT) {
    throw new Error(
      `ฐาน production ต้องตั้ง ALLOW_PROD_LEGACY_IMPORT=${CONSENT} ด้วย — ทั้ง dry-run และเขียนจริง (dry-run บน prod ก็เขียนแล้ว rollback และล็อกเบอร์ลูกค้าระหว่างรัน)`,
    );
  }
}

/**
 * รอบเขียนจริง: วันตัด (ตามปฏิทินกรุงเทพ) ต้องไม่อยู่หลังวันนี้ และไม่เก่ากว่า `MAX_CUTOFF_AGE_DAYS` วัน — กันพิมพ์วันผิด
 * (คืนตัดรันวันที่ 30 พ.ย. ก่อนเที่ยงคืน = วันเดียวกับวันตัด ผ่าน)
 */
export function assertCutoffWindow(cutoff: Date, now: Date): void {
  const cutoffDay = bangkokDateString(cutoff);
  const today = bangkokDateString(now);
  if (cutoffDay > today) {
    throw new Error(
      `--cutoff ${cutoffDay} อยู่หลังวันนี้ (${today}) — รอบเขียนจริงต้องรันในหรือหลังวันตัด`,
    );
  }
  const ageDays = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${cutoffDay}T00:00:00Z`)) / DAY_MS,
  );
  if (ageDays > MAX_CUTOFF_AGE_DAYS) {
    throw new Error(
      `--cutoff ${cutoffDay} เก่ากว่า ${MAX_CUTOFF_AGE_DAYS} วัน (${ageDays} วัน) — ตรวจวันตัดอีกครั้ง`,
    );
  }
}

/** กุญแจ/salt ของ PII ต้องมีรูปแบบถูก (แบบ `repair-customer-phones.cli.ts`) */
export function piiSecrets(env: Env): { key: string; salt: string } {
  const key = env.PII_ENCRYPTION_KEY ?? '';
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error('PII_ENCRYPTION_KEY ต้องเป็น hex 64 ตัว — กุญแจเดียวกับ API ของฐานที่นำเข้า');
  }
  const salt = env.PII_HASH_SALT ?? '';
  if (salt.length < 32) {
    throw new Error('PII_HASH_SALT ต้องยาวอย่างน้อย 32 ตัว — salt เดียวกับ API ของฐานที่นำเข้า');
  }
  return { key, salt };
}

/** storage จริงของรอบเขียน — `describe()` ใช้ตรวจปลายทาง */
export type ImportStorage = Pick<StorageService, 'upload' | 'configured' | 'describe'>;

/**
 * storage ของรอบเขียนจริง: ไม่ใช่ `none` / `local` และ bucket (`describe().location`) ต้องเท่า `EXPECTED_STORAGE_BUCKET`
 * — กันซ้อมบนฐานสำเนาแล้วอัปโหลดรูปบัตร/สลิปจริงขึ้น bucket ของ prod (`StorageService` ใช้ bucket prod เมื่อ
 * `NODE_ENV=production` และไม่ตั้ง `GCS_BUCKET`)
 */
export function assertCommitStorage(desc: ReturnType<ImportStorage['describe']>, env: Env): void {
  if (desc.backend === 'none' || desc.backend === 'local') {
    throw new Error(
      `รอบเขียนจริงต้องอัปโหลดไฟล์แนบขึ้น GCS (หรือ S3) — storage ตอนนี้เป็น ${desc.backend} · ` +
        'ไม่ตั้ง STORAGE_LOCAL_DIR แล้วตั้ง GCS_BUCKET=<bucket> (gcloud auth application-default login ก่อน) แล้วรันใหม่',
    );
  }
  const expected = env.EXPECTED_STORAGE_BUCKET;
  if (!expected) {
    throw new Error(
      `รอบเขียนจริงต้องตั้ง EXPECTED_STORAGE_BUCKET=<bucket ที่ตั้งใจอัปโหลด> — storage ตอนนี้ชี้ ${desc.backend} ${desc.location}`,
    );
  }
  if (expected !== desc.location) {
    throw new Error(
      `storage ชี้ ${desc.backend} ${desc.location} แต่ EXPECTED_STORAGE_BUCKET=${expected} — ตรวจ GCS_BUCKET / S3_* แล้วรันใหม่`,
    );
  }
}

/** ฐาน prod (`bestchoice`) เขียนจริงได้เฉพาะ GCS (storage ของ API บน Cloud Run) */
export function assertProdStorage(
  desc: ReturnType<ImportStorage['describe']>,
  actualDb: string,
): void {
  if (actualDb === PROD_DB_NAME && desc.backend !== 'gcs') {
    throw new Error(
      `ฐาน ${PROD_DB_NAME} ต้องอัปโหลดไฟล์แนบขึ้น GCS — storage ตอนนี้เป็น ${desc.backend} (ไม่ตั้ง S3_* / STORAGE_LOCAL_DIR)`,
    );
  }
}

export type PiiKeySample = {
  /** ciphertext ที่ตรวจ (เลขบัตร + เบอร์หลัก) */
  withCiphertext: number;
  decryptFailed: number;
  /** ถอดได้และมี hash */
  consistentWithHash: number;
  /** ถอดได้แต่ hash ไม่ตรงทั้งค่าเดิมและค่าที่ปรับรูป = สัญญาณ salt ผิด */
  saltSuspect: number;
};

/**
 * ด่านกุญแจ/salt (carry C-3 ของ Task 8 · แบบ `repair-customer-phones.cli.ts` `assessKeySafety`) — อ่านลูกค้าตัวอย่างที่มี
 * ciphertext + hash ถอดด้วยกุญแจที่ตั้ง แล้ว hash ค่าที่ถอดได้ด้วย salt ที่ตั้ง ต้องตรงค่าที่เก็บไว้ ·
 * อ่านอย่างเดียว ไม่พิมพ์ค่า · กุญแจ/salt ผิด = แถวที่นำเข้าใช้ร่วมกับ API ไม่ได้ (dedup ด้วย hash มองไม่เห็น ถอดไม่ออก)
 */
export async function samplePiiKeys(
  db: Pick<PrismaClient, 'customer'>,
  key: string,
  salt: string,
): Promise<PiiKeySample> {
  const rows = await db.customer.findMany({
    where: {
      deletedAt: null,
      OR: [
        { nationalIdEncrypted: { not: null }, nationalIdHash: { not: null } },
        { phoneEncrypted: { not: null }, phoneHash: { not: null } },
      ],
    },
    select: {
      nationalIdEncrypted: true,
      nationalIdHash: true,
      phoneEncrypted: true,
      phoneHash: true,
    },
    orderBy: { createdAt: 'desc' },
    take: PII_SAMPLE_ROWS,
  });
  const out: PiiKeySample = {
    withCiphertext: 0,
    decryptFailed: 0,
    consistentWithHash: 0,
    saltSuspect: 0,
  };
  const check = (
    cipher: string | null,
    hash: string | null,
    normalize: (v: string) => string | null,
  ) => {
    if (!cipher || !hash || !isEncrypted(cipher)) return;
    out.withCiphertext++;
    let plain: string;
    try {
      plain = decryptPII(cipher, key);
    } catch {
      out.decryptFailed++;
      return;
    }
    if (hash === plain) return; // plaintext หลุดในคอลัมน์ hash — ไม่ใช่สัญญาณ salt
    out.consistentWithHash++;
    const candidates = [plain, normalize(plain)].filter((v): v is string => !!v);
    if (!candidates.some((v) => hashPII(v, salt) === hash)) out.saltSuspect++;
  };
  for (const r of rows) {
    check(r.nationalIdEncrypted, r.nationalIdHash, (v) => v.replace(/\D/g, ''));
    check(r.phoneEncrypted, r.phoneHash, normalizeThaiPhone);
  }
  return out;
}

/**
 * ผลด่านกุญแจ: ไม่ผ่าน = throw · ไม่มีตัวอย่างเลย = เขียนจริงต้องมี `ALLOW_UNVERIFIED_PII_KEYS` (dry-run เตือน) ·
 * คืนข้อความที่จะพิมพ์
 */
export function assertPiiKeys(sample: PiiKeySample, dryRun: boolean, env: Env): string {
  const problems = assessKeySafety({
    decryptFailedColumns: sample.decryptFailed,
    withCiphertext: sample.withCiphertext,
    saltSuspect: sample.saltSuspect,
    consistentWithHash: sample.consistentWithHash,
  });
  if (problems.length > 0) {
    throw new Error(
      `ด่านกุญแจ PII ไม่ผ่าน — ${problems.join(' · ')} · ห้ามนำเข้า: ตั้ง PII_ENCRYPTION_KEY / PII_HASH_SALT ให้ตรงกับ API ของฐานนี้`,
    );
  }
  if (sample.withCiphertext > 0) return `ผ่าน (ตรวจ ${sample.withCiphertext} ค่า)`;
  const message =
    'ไม่มีลูกค้าที่มี ciphertext + hash ให้ตรวจกุญแจ/salt — ยืนยันว่ากุญแจตรงกับ API เองก่อน';
  if (!dryRun && env.ALLOW_UNVERIFIED_PII_KEYS !== CONSENT) {
    throw new Error(`${message} แล้วตั้ง ALLOW_UNVERIFIED_PII_KEYS=${CONSENT}`);
  }
  return `⚠ ${message}`;
}

/**
 * งวดบัญชีของ FINANCE ที่รายการนำเข้าลง (เดือนของวันตัด = รายการยกมา + marker · เดือนของ `catchUpAt` = รายการไล่ VAT)
 * ต้องไม่ `CLOSED` / `SYNCED` — **ไม่มีช่วงผ่อนผัน** (`JournalAutoService.createAndPost` ไม่ตรวจงวดเอง · การนำเข้าไม่ใช่การแก้ย้อน)
 */
export async function assertPeriodsOpen(
  db: Pick<PrismaClient, 'accountingPeriod'>,
  financeCompanyId: string,
  dates: readonly Date[],
): Promise<void> {
  const months = [
    ...new Map(
      dates.map((date) => {
        const { year, month } = bangkokCalendarParts(date);
        return [`${year}-${month + 1}`, { year, month: month + 1 }] as const;
      }),
    ).values(),
  ];
  const periods = await db.accountingPeriod.findMany({
    where: { companyId: financeCompanyId, OR: months },
    select: { year: true, month: true, status: true },
  });
  const locked = periods.filter((p) => p.status === 'CLOSED' || p.status === 'SYNCED');
  if (locked.length > 0) {
    const list = locked
      .map((p) => `${p.year}/${String(p.month).padStart(2, '0')} (${p.status})`)
      .join(', ');
    throw new Error(
      `งวดบัญชี FINANCE ${list} ปิดแล้ว — รายการยกมา/ไล่ VAT ลงงวดนี้ไม่ได้ · ให้ฝ่ายบัญชีเปิดงวดก่อน (การนำเข้าไม่มีช่วงผ่อนผัน)`,
    );
  }
}

/**
 * SystemConfig `overdue_days_threshold` (ตัวเดียวกับ `OverdueLifecycleCronService.updateContractStatuses`) — ไม่มีแถว =
 * `DEFAULT_OVERDUE_DAYS_THRESHOLD` · ค่าไม่ใช่จำนวนเต็มไม่ติดลบ = throw (cron อ่านแบบ `Number(value)`)
 */
export async function readOverdueDaysThreshold(
  db: Pick<PrismaClient, 'systemConfig'>,
): Promise<number> {
  const row = await db.systemConfig.findUnique({
    where: { key: 'overdue_days_threshold' },
    select: { value: true },
  });
  if (!row) return DEFAULT_OVERDUE_DAYS_THRESHOLD;
  const days = Number(row.value);
  if (!Number.isInteger(days) || days < 0) {
    throw new Error(
      'SystemConfig overdue_days_threshold ไม่ใช่จำนวนเต็มไม่ติดลบ — ตรวจค่าก่อนนำเข้า',
    );
  }
  return days;
}

/** SHA-256 (hex) ของไฟล์ — อ่านแบบ stream (dump ใหญ่) */
export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}
