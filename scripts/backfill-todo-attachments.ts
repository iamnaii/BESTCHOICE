/**
 * Backfill missing `name` / `size` / `mimeType` on Todo.attachments JSON.
 *
 * Context: DTO เดิมเป็น `unknown[]` ทำให้ ValidationPipe (whitelist: true)
 * drop field บาง attachment ไปตอน save — เหลือแค่ `url` + `key`. สคริปต์นี้
 * อ่านแต่ละ attachment ไปเรียก HEAD S3 เพื่อดึง ContentLength/ContentType/
 * filename กลับมาเติมใน DB
 *
 * วิธีรัน (dev):
 *   cd apps/api
 *   npx ts-node -r tsconfig-paths/register ../../scripts/backfill-todo-attachments.ts
 *
 * วิธีรัน (prod / dry-run):
 *   DRY_RUN=1 node -r ts-node/register scripts/backfill-todo-attachments.ts
 *
 * ENV ที่ต้องมี: DATABASE_URL, S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY,
 *              S3_BUCKET, S3_REGION
 */
import { PrismaClient } from '@prisma/client';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';

const DRY_RUN = process.env.DRY_RUN === '1';

const prisma = new PrismaClient();
const bucket = process.env.S3_BUCKET || 'bestchoice-documents';
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || 'ap-southeast-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || '',
    secretAccessKey: process.env.S3_SECRET_KEY || '',
  },
  forcePathStyle: true,
});

interface RawAttachment {
  url?: string;
  key?: string;
  name?: string;
  size?: number;
  mimeType?: string;
  uploadedAt?: string;
  [k: string]: unknown;
}

/**
 * Derive S3 key จาก attachment — ใช้ `key` ถ้ามี, ไม่งั้น parse จาก url:
 *   /api/todos/attachments/<encoded-key>
 */
function keyFromAttachment(a: RawAttachment): string | null {
  if (a.key && typeof a.key === 'string') return a.key;
  if (!a.url || typeof a.url !== 'string') return null;
  const m = a.url.match(/\/api\/todos\/attachments\/(.+)$/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

/** คืน filename จาก S3 key สุดท้าย (เอาส่วน after last `/`, ตัด prefix timestamp/random) */
function nameFromKey(key: string): string {
  const base = key.split('/').pop() || key;
  // key format: `${timestamp}-${rand6}-${safeName}` — ตัด 2 segment แรก
  const m = base.match(/^\d+-[a-z0-9]{6}-(.+)$/i);
  return m ? m[1] : base;
}

async function headObject(key: string) {
  try {
    const res = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return {
      size: typeof res.ContentLength === 'number' ? res.ContentLength : undefined,
      mimeType: res.ContentType,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  ! HEAD failed for ${key}: ${msg}`);
    return null;
  }
}

function needsBackfill(a: RawAttachment): boolean {
  return (
    typeof a.size !== 'number' ||
    !Number.isFinite(a.size) ||
    !a.name ||
    !a.mimeType
  );
}

async function run() {
  console.log(`[backfill-todo-attachments] DRY_RUN=${DRY_RUN ? 'yes' : 'no'}`);

  const todos = await prisma.todo.findMany({
    where: { deletedAt: null, NOT: { attachments: { equals: null as unknown as undefined } } },
    select: { id: true, title: true, attachments: true },
  });

  let scanned = 0;
  let patched = 0;
  let itemsFixed = 0;
  let itemsSkipped = 0;

  for (const todo of todos) {
    const raw = todo.attachments;
    if (!Array.isArray(raw)) continue;
    const atts = raw as unknown as RawAttachment[];
    if (atts.length === 0) continue;
    scanned++;

    let changed = false;
    let localFixed = 0;
    const next: RawAttachment[] = [];

    for (const a of atts) {
      if (!needsBackfill(a)) {
        next.push(a);
        continue;
      }
      const key = keyFromAttachment(a);
      if (!key) {
        console.warn(`  - todo ${todo.id}: attachment ไม่มี key/url ที่ parse ได้ — ข้าม`);
        next.push(a);
        itemsSkipped++;
        continue;
      }
      const meta = await headObject(key);
      if (!meta) {
        next.push(a);
        itemsSkipped++;
        continue;
      }
      const fixed: RawAttachment = {
        ...a,
        key,
        url: a.url || `/api/todos/attachments/${encodeURIComponent(key)}`,
        name: a.name || nameFromKey(key),
        size: typeof a.size === 'number' && Number.isFinite(a.size) ? a.size : meta.size,
        mimeType: a.mimeType || meta.mimeType || 'application/octet-stream',
        uploadedAt: a.uploadedAt || new Date().toISOString(),
      };
      next.push(fixed);
      changed = true;
      localFixed++;
      itemsFixed++;
    }

    if (changed) {
      const shortTitle = todo.title.length > 30 ? todo.title.slice(0, 30) + '…' : todo.title;
      console.log(`  ✓ todo ${todo.id} (${shortTitle}): ${localFixed} attachment(s) backfilled`);
      patched++;
      if (!DRY_RUN) {
        await prisma.todo.update({
          where: { id: todo.id },
          data: { attachments: next as unknown as object },
        });
      }
    }
  }

  console.log('─────────────────────────────');
  console.log(`scanned todos with attachments : ${scanned}`);
  console.log(`todos patched                  : ${patched}`);
  console.log(`attachment items fixed         : ${itemsFixed}`);
  console.log(`attachment items skipped       : ${itemsSkipped}`);
  if (DRY_RUN) console.log('DRY_RUN=1 — ไม่มีการเขียน DB จริง');
}

run()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
