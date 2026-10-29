import { promises as fsp } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import type { StorageService } from '../../modules/storage/storage.service';

/**
 * อัปโหลดไฟล์แนบของระบบเก่า (รูป/PDF ที่ `LegacyContract.files[].path` และสลิป `LegacyReceipt.slipPath`
 * อ้างถึง) จากโฟลเดอร์ที่แตก zip ไว้ ขึ้น storage ของ BESTCHOICE
 *
 * **`filesDir` = โฟลเดอร์ `httpdocs` ที่แตกจาก `backoffice_httpdocs_2026-10-29.zip`** (ไม่ใช่ `uploads/`)
 * — ค่าในช่อง `file_name` / `slip` ของ dump เป็น path นับจาก `httpdocs/` เสมอ
 * (ตรวจ dump + รายการใน zip 29/10 นับจำนวนเท่านั้น):
 * - ทุกค่าเป็น `uploads/<โฟลเดอร์>/<ชื่อ>` (ไฟล์แนบ 9 ตาราง 13,931 แถว) หรือ `upload/payment/<ชื่อ>`
 *   (สลิป 5,941 แถว) ⇒ `uploads/` กับ `upload/` เป็นคนละโฟลเดอร์จริง **ห้ามตัดทิ้ง** · `img_contract` ชี้
 *   `uploads/identity` 3,925 + `uploads/contract` 743 · `order_product_file` ชี้ `uploads/identity` ทั้งหมด
 * - ไม่มีค่าที่ขึ้นต้นด้วย `/` หรือ `./`, ไม่มี backslash, `%`, ช่องว่าง, อักษรนอก ASCII, `..`
 *   หรือนามสกุลตัวใหญ่ · ชื่อไฟล์ในโฟลเดอร์ upload(s) = ตัวอักษรสุ่มตัวเล็กตัวใหญ่ปน + เวลา
 *   (ไม่มีคู่ที่ต่างกันแค่ตัวเล็ก/ใหญ่ — แตกบน macOS ได้ไม่ชนกัน) · นามสกุล jpg 26,563 · pdf 840 · png 199
 *   · jpeg 29 · webp 16 · gif 3
 * - หาไม่เจอใน zip 10 ไฟล์ (ไม่ซ้ำ) ทั้งหมดเป็นของสัญญาสถานะ 2 (ผ่อนอยู่) · สลิปเจอครบ
 *
 * ตัวปรับ path (`normalizeLegacyFilePath`) จึงรับเฉพาะรูปแบบที่ปลอดภัยและพบได้จริง: ตัดช่องว่างหัวท้าย
 * · `\` → `/` (dump สังเคราะห์ของเทสใช้แบบ Windows) · ตัดส่วน `.` และ `//` · **ปฏิเสธ** path ว่าง, `..`
 * ทุกตำแหน่ง, path เต็ม (`/…` หรือ `\…`), ไดรฟ์/URL (ส่วนแรกมี `:` เช่น `C:\…` `https://…`) และ NUL
 * · **ไม่ถอด `%xx`** — ข้อมูลจริงไม่มี และการถอดทำให้สองชื่อกลายเป็นไฟล์เดียวหรือกลายเป็น `..` ได้
 * ค่าที่มี `%` จึงเทียบตามตัวอักษร หาไม่เจอ = `missing` ให้คนตรวจ
 *
 * กติกา:
 * - key = `${prefix}/${path ที่ปรับแล้ว}` — ได้จากข้อความเท่านั้น เรียกซ้ำได้ key เดิม (อัปโหลดทับของเดิม)
 * - path ที่ถูกปฏิเสธไม่แตะไฟล์เลย · path ที่ resolve แล้ว (`path.resolve` + `fs.realpath` ตามลิงก์) อยู่นอก
 *   `filesDir` → `missing` โดยไม่อ่านไฟล์ · ไม่ใช่ไฟล์ธรรมดา (เช่นโฟลเดอร์) → `missing`
 * - หลายค่าที่ปรับแล้วได้ path เดียวกันอัปโหลดครั้งเดียว · `urls` ใช้ **ค่าเดิมที่ส่งมา** เป็น key ทุกค่า
 *   (Task 10 ค้นด้วย `LegacyContract.files[].path` ได้ตรง ๆ)
 * - `urls` เก็บค่าที่ `StorageService.upload` คืน = **object key** (ทุก backend ไม่ใช่ลิงก์สาธารณะ —
 *   แบบเดียวกับ `fileUrl` ของเอกสารที่ระบบสร้าง และ `imageUrl` ของสลิปปิดยอด)
 * - อัปโหลดพร้อมกันไม่เกิน `LEGACY_FILE_UPLOAD_CONCURRENCY` · ไฟล์หนึ่งอ่าน/อัปโหลดไม่ได้ไม่หยุดไฟล์อื่น
 *   → `failed` (`reason` = ขั้น + ชื่อคลาส/รหัสของ error เท่านั้น — ข้อความ error มี path ที่อาจมีข้อมูลลูกค้า)
 * - `missing` / `failed` เรียงตามตัวอักษรและไม่ซ้ำ
 *
 * ข้อจำกัดที่รู้: ระหว่าง `realpath` กับ `readFile` ไม่ล็อกไฟล์ — โฟลเดอร์เป็นของผู้รันบนเครื่องตัวเอง
 */

/** จำนวนงาน อ่าน+อัปโหลด ที่ทำพร้อมกันสูงสุด */
export const LEGACY_FILE_UPLOAD_CONCURRENCY = 8;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export type LegacyFileUploadResult = {
  /** ค่า relPath เดิม → key ที่ storage คืน */
  urls: Map<string, string>;
  /** relPath ที่ถูกปฏิเสธ / หาไม่เจอ / ไม่ใช่ไฟล์ / ลิงก์ออกนอก filesDir — เรียงแล้ว ไม่ซ้ำ */
  missing: string[];
  /** relPath ที่อ่านหรืออัปโหลดไม่สำเร็จ — `reason` เช่น `read:EIO` · `upload:ApiError` */
  failed: Array<{ path: string; reason: string }>;
};

/** ชนิดไฟล์จากนามสกุล (ไม่สนตัวเล็ก/ใหญ่) · ไม่รู้จัก = `application/octet-stream` */
export function legacyFileContentType(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

/** path ของระบบเก่า → path สัมพัทธ์รูปมาตรฐาน (`a/b/c.jpg`) · `null` = ปฏิเสธ (ดูหัวไฟล์) */
export function normalizeLegacyFilePath(relPath: string): string | null {
  const trimmed = relPath.trim();
  if (!trimmed || trimmed.includes('\0')) return null;
  const slashed = trimmed.replace(/\\/g, '/');
  if (slashed.startsWith('/')) return null;
  const parts = slashed.split('/').filter((part) => part !== '' && part !== '.');
  if (parts.length === 0 || parts.includes('..') || parts[0].includes(':')) return null;
  return parts.join('/');
}

/** prefix ของ key ต้องเป็น path สัมพัทธ์ที่ไม่มีส่วนว่าง/`.`/`..` (ตัด `/` ท้ายให้) */
function checkPrefix(prefix: string): string {
  const trimmed = prefix.replace(/\/+$/, '');
  const unsafe =
    !trimmed ||
    trimmed.startsWith('/') ||
    trimmed.includes('\\') ||
    trimmed.split('/').some((part) => part === '' || part === '.' || part === '..');
  if (unsafe) throw new Error(`prefix ของ key ไฟล์แนบไม่ถูกต้อง: ${prefix}`);
  return trimmed;
}

/** path จริงของ filesDir (ตามลิงก์แล้ว) — ไม่มี/ไม่ใช่โฟลเดอร์ = throw */
async function resolveFilesDir(filesDir: string): Promise<string> {
  let root: string;
  try {
    root = await fsp.realpath(resolve(filesDir));
  } catch {
    throw new Error(`ไม่พบโฟลเดอร์ไฟล์แนบ (--files-dir): ${filesDir}`);
  }
  if (!(await fsp.stat(root)).isDirectory()) {
    throw new Error(`--files-dir ต้องเป็นโฟลเดอร์ (httpdocs ที่แตกจาก zip): ${filesDir}`);
  }
  return root;
}

const isNotFound = (error: unknown): boolean => {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
};

/** ชื่อ error ที่ปลอดภัยจะพิมพ์ — ไม่ใช้ข้อความ (มี path/ข้อมูลในแถวได้) */
function errorLabel(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,40}$/.test(code)) return code;
  let name = 'Error';
  if (error instanceof Error) {
    name = error.name && error.name !== 'Error' ? error.name : error.constructor.name;
  }
  return /^[A-Za-z_$][\w$]{0,63}$/.test(name) ? name : 'Error';
}

type Outcome =
  | { kind: 'uploaded'; url: string }
  | { kind: 'missing' }
  | { kind: 'failed'; reason: string };

const MISSING: Outcome = { kind: 'missing' };

async function uploadOne(
  rootPrefix: string,
  normalized: string,
  key: string,
  storage: Pick<StorageService, 'upload'>,
): Promise<Outcome> {
  const candidate = resolve(rootPrefix, normalized);
  if (!candidate.startsWith(rootPrefix)) return MISSING;

  let body: Buffer;
  try {
    // ตามลิงก์ก่อนแตะเนื้อไฟล์ — ลิงก์ (ไฟล์หรือโฟลเดอร์) ที่พาออกนอก filesDir = ไม่อ่าน
    const real = await fsp.realpath(candidate);
    if (!real.startsWith(rootPrefix)) return MISSING;
    if (!(await fsp.stat(real)).isFile()) return MISSING;
    body = await fsp.readFile(real);
  } catch (error) {
    return isNotFound(error) ? MISSING : { kind: 'failed', reason: `read:${errorLabel(error)}` };
  }

  try {
    return {
      kind: 'uploaded',
      url: await storage.upload(key, body, legacyFileContentType(normalized)),
    };
  } catch (error) {
    return { kind: 'failed', reason: `upload:${errorLabel(error)}` };
  }
}

/** ทำ `fn` กับทุกตัวโดยมีงานค้างพร้อมกันไม่เกิน `limit` · ผลเรียงตามลำดับ `items` */
async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function uploadLegacyFiles(
  filesDir: string,
  relPaths: readonly string[],
  storage: Pick<StorageService, 'upload'>,
  prefix = 'legacy-import',
): Promise<LegacyFileUploadResult> {
  const keyPrefix = checkPrefix(prefix);
  const root = await resolveFilesDir(filesDir);
  const rootPrefix = root.endsWith(sep) ? root : root + sep;

  // path ที่ปรับแล้ว → ค่าเดิมทุกค่าที่ปรับได้ path นี้ (อัปโหลดครั้งเดียว)
  const groups = new Map<string, string[]>();
  const missing = new Set<string>();
  for (const original of new Set(relPaths)) {
    const normalized = normalizeLegacyFilePath(original);
    if (normalized === null) {
      missing.add(original);
      continue;
    }
    const group = groups.get(normalized);
    if (group) group.push(original);
    else groups.set(normalized, [original]);
  }

  const jobs = [...groups.keys()].sort();
  const outcomes = await mapPool(jobs, LEGACY_FILE_UPLOAD_CONCURRENCY, (normalized) =>
    uploadOne(rootPrefix, normalized, `${keyPrefix}/${normalized}`, storage),
  );

  const urls = new Map<string, string>();
  const failed: LegacyFileUploadResult['failed'] = [];
  jobs.forEach((normalized, index) => {
    const outcome = outcomes[index];
    for (const original of groups.get(normalized) ?? []) {
      if (outcome.kind === 'uploaded') urls.set(original, outcome.url);
      else if (outcome.kind === 'missing') missing.add(original);
      else failed.push({ path: original, reason: outcome.reason });
    }
  });

  failed.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { urls, missing: [...missing].sort(), failed };
}
