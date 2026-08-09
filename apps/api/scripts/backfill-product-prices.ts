/**
 * B0 §2.1 — Backfill Product.cashPrice / installmentPrice จากแถว ProductPrice เดิม
 *
 * ต้องรัน **ใน deploy เดียวกันกับ readiness filter** และรันให้จบก่อนเปิด filter
 * ไม่งั้นเครื่องที่มีราคาอยู่แล้ว (แต่คอลัมน์ยังว่าง) จะหายจากเว็บทั้งกระดาน
 *
 * default = DRY RUN (แค่รายงาน). เขียนจริงต้อง APPLY=true
 * รัน: DATABASE_URL=... [APPLY=true] npm --prefix apps/api run backfill:product-prices
 */
import { PrismaClient, Prisma } from '@prisma/client';

const APPLY = process.env.APPLY === 'true';
const INSTALLMENT_EXACT = 'ราคาผ่อน BESTCHOICE';
const INSTALLMENT_PREFIX = 'ราคาผ่อน';
const CASH_EXACT = 'ราคาเงินสด';

type PriceRow = { label: string; amount: Prisma.Decimal; isDefault: boolean };

/**
 * Fix round 1 [Important]: reviewer reproduced บน DB จริง — แถว `label='ราคาขาย',
 * isDefault=true, amount=0.00` (PO-receive placeholder shape จริง) ผ่านทุกชั้น fallback
 * เดิมได้เพราะไม่มีการเช็คค่าเลย → APPLY เขียน `cash_price=0.00` ติดถาวร แล้ว idempotency
 * guard (`cashPrice != null`) กัน re-run ไม่ให้ self-heal อีกต่อไป
 *
 * นี่คือ defect class เดียวกับที่ `product-price-sync.util.ts` (Task 4) แก้ไปแล้วฝั่ง
 * **เขียน** ด้วย `isUsablePrice()` (Decimal `.gt(0)`, ปฏิบัติ 0/ติดลบเหมือน null) — แต่ฟังก์ชัน
 * นั้นเป็น `function` ธรรมดาไม่ได้ `export` จากไฟล์ (ลองอิมพอร์ตจริงแล้ว: tsx ไม่ throw ตอน
 * import แต่ค่าที่ได้เป็น `undefined` เพราะ binding ไม่มีอยู่จริง — จะพังตอนเรียกใช้งาน) จึง copy
 * pattern มาไว้ local ในสคริปต์นี้แทน
 */
function isUsablePrice(amount: Prisma.Decimal): boolean {
  return amount.gt(0);
}

// ใช้ร่วมกันทั้ง pickCash และ cashSkipReason — แถวที่ label ขึ้นต้น 'ราคาผ่อน' ไม่ใช่ผู้สมัคร
// ราคาเงินสดเด็ดขาด (กัน Task 9 [Important เดิม]: ราคาผ่อนสูงกว่าไม่ให้ถูกยกเป็นราคาเงินสด)
const isCashCandidate = (r: PriceRow) => !r.label.startsWith(INSTALLMENT_PREFIX);
const isInstallmentCandidate = (r: PriceRow) => r.label.startsWith(INSTALLMENT_PREFIX);

function pickInstallment(rows: PriceRow[]): { amount: Prisma.Decimal; source: string } | null {
  const exact = rows.find((r) => r.label === INSTALLMENT_EXACT && isUsablePrice(r.amount));
  if (exact) return { amount: exact.amount, source: INSTALLMENT_EXACT };
  const prefix = rows.find((r) => r.label.startsWith(INSTALLMENT_PREFIX) && isUsablePrice(r.amount));
  if (prefix) return { amount: prefix.amount, source: `prefix:${prefix.label}` };
  return null;
}

/** log เหตุผลตอน pickInstallment คืน null ให้ owner เห็น (แยกจาก "ไม่มีแถวผ่อนเลย" ซึ่งไม่ผิดปกติ ไม่ log) */
function installmentSkipReason(rows: PriceRow[]): string | null {
  const candidates = rows.filter(isInstallmentCandidate);
  if (candidates.length === 0) return null;
  const nonPositive = candidates.find((r) => !isUsablePrice(r.amount));
  if (nonPositive) return `SKIPPED_NON_POSITIVE:${nonPositive.label}`;
  return null;
}

function pickCash(rows: PriceRow[]): { amount: Prisma.Decimal; source: string } | null {
  const exact = rows.find((r) => r.label === CASH_EXACT && isUsablePrice(r.amount));
  if (exact) return { amount: exact.amount, source: CASH_EXACT };
  const prefix = rows.find((r) => r.label.startsWith(CASH_EXACT) && isUsablePrice(r.amount));
  if (prefix) return { amount: prefix.amount, source: `prefix:${prefix.label}` };

  // B0: ครอบ default row ทุก label — 'ราคาขาย' (PO receive) /
  // 'ราคาขายต่อ (Refurbished)' (ยึดเครื่อง) — **แต่ต้องกันแถว 'ราคาผ่อน*'**
  // ⚠️ แถว 'ราคาผ่อน BESTCHOICE' เป็น isDefault ได้ (หน้า create ตั้ง isDefault ให้แถวแรก)
  //    ถ้าไม่กัน ราคาผ่อน (สูงกว่า) จะถูกยกขึ้นเป็น "ราคาเงินสด" แล้วเว็บโชว์ราคาแพงกว่าจริง
  //    — ขัดกับ write-through util ของ batch เดียวกันที่กันไว้แล้ว (product-price-sync.util)
  const def = rows.find((r) => r.isDefault && isCashCandidate(r) && isUsablePrice(r.amount));
  if (def) return { amount: def.amount, source: `isDefault:${def.label}` };

  // fix round 1: นับเฉพาะแถวที่ "ใช้ได้จริง" (amount > 0) ตอนตัดสิน ambiguous-vs-first —
  // ไม่งั้นแถว 0/ติดลบที่ถูกข้ามไปแล้วจะทำให้ source บอกผิดว่ามีตัวเลือกมากกว่าที่เป็นจริง
  const usableCandidates = rows.filter((r) => isCashCandidate(r) && isUsablePrice(r.amount));
  const first = usableCandidates[0];
  if (first) {
    // แถวเดียวที่ไม่รู้จัก label = เดาว่าเป็นราคาเงินสด — ต้องให้เจ้าของรีวิว
    const source =
      usableCandidates.length === 1 ? `AMBIGUOUS_SINGLE_ROW:${first.label}` : `first:${first.label}`;
    return { amount: first.amount, source };
  }

  // มีแต่แถวราคาผ่อน หรือแถวที่มี amount ≤ 0 → ไม่เดาเป็นราคาเงินสด (ปล่อยคอลัมน์ cashPrice
  // เป็น null แล้วให้ readiness กรองออก ดีกว่าตั้งราคาผิดแล้วขายจริงตามนั้น)
  return null;
}

/**
 * log เหตุผลตอน pickCash คืน null ให้ owner เห็นตอนรีวิว dry-run — สองเหตุผลที่แยกกันชัดเจน
 * และ mutually exclusive เมื่อ rows.length > 0: ไม่มีแถวผู้สมัครราคาเงินสดเลย (มีแต่ราคาผ่อน)
 * vs. มีแถวผู้สมัครแต่ทุกแถว amount ≤ 0 (fix round 1 [Important])
 */
function cashSkipReason(rows: PriceRow[]): string | null {
  const candidates = rows.filter(isCashCandidate);
  if (candidates.length === 0) return 'SKIPPED_INSTALLMENT_ONLY';
  const nonPositive = candidates.find((r) => !isUsablePrice(r.amount));
  if (nonPositive) return `SKIPPED_NON_POSITIVE:${nonPositive.label}`;
  return null;
}

async function main() {
  const prisma = new PrismaClient();
  const startedAt = Date.now();

  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      cashPrice: true,
      installmentPrice: true,
      prices: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { label: true, amount: true, isDefault: true },
      },
    },
  });

  let updated = 0;
  let skippedNoRows = 0;
  let skippedAlreadySet = 0;
  // fix round 1 [Minor]: แยกจาก skippedNoRows — เครื่องที่คอลัมน์หนึ่งถูกเติมไปแล้วจากรอบก่อน
  // (ไม่ว่าจากรัน APPLY รอบก่อนของสคริปต์นี้เอง หรือ B0 เขียนตรง) แต่อีกคอลัมน์ไม่มี candidate
  // ให้เติม — ไม่ใช่ "ยังไม่เคยแตะเลย" แบบ skippedNoRows ตัวเลขจะได้นิ่งเวลารันซ้ำ
  let skippedPartialAlreadySet = 0;
  const bySource: Record<string, number> = {};
  const samples: Record<string, unknown>[] = [];

  for (const p of products) {
    const wasPartiallySet = p.cashPrice != null || p.installmentPrice != null;

    // forward-fix: คอลัมน์ที่มีค่าแล้ว (B0 เขียน / autofill) ห้ามทับ
    if (p.cashPrice != null && p.installmentPrice != null) {
      skippedAlreadySet++;
      continue;
    }
    if (p.prices.length === 0) {
      if (wasPartiallySet) skippedPartialAlreadySet++;
      else skippedNoRows++;
      continue;
    }

    const cash = p.cashPrice == null ? pickCash(p.prices) : null;
    const installment = p.installmentPrice == null ? pickInstallment(p.prices) : null;

    // fix round 1: log skip-reason bySource ก่อนเช็ค early-continue เสมอ — ไม่งั้นเคสที่ cash
    // หาไม่ได้เพราะ amount ≤ 0 **และ** ไม่มีแถวผ่อนเลย (installment ก็ null พร้อมกัน) จะโดน
    // `continue` ก่อนถึงบรรทัด log เลย ทำให้ owner ไม่เห็นเคสนี้ตอนรีวิว dry-run
    if (cash) bySource[`cash:${cash.source}`] = (bySource[`cash:${cash.source}`] ?? 0) + 1;
    // เครื่องที่ cash หาไม่ได้ (มีแต่แถวราคาผ่อน หรือแถวที่เจอ amount ≤ 0) — ต้องนับให้เจ้าของเห็น
    if (!cash && p.cashPrice == null) {
      const reason = cashSkipReason(p.prices);
      if (reason) bySource[`cash:${reason}`] = (bySource[`cash:${reason}`] ?? 0) + 1;
    }
    if (installment) bySource[`installment:${installment.source}`] = (bySource[`installment:${installment.source}`] ?? 0) + 1;
    if (!installment && p.installmentPrice == null) {
      const reason = installmentSkipReason(p.prices);
      if (reason) bySource[`installment:${reason}`] = (bySource[`installment:${reason}`] ?? 0) + 1;
    }

    if (!cash && !installment) {
      if (wasPartiallySet) skippedPartialAlreadySet++;
      else skippedNoRows++;
      continue;
    }

    if (samples.length < 20) {
      samples.push({
        id: p.id,
        name: p.name,
        cashFrom: cash?.source ?? '(คงเดิม)',
        cashAmount: cash?.amount.toString() ?? null,
        installmentFrom: installment?.source ?? '(คงเดิม)',
        installmentAmount: installment?.amount.toString() ?? null,
      });
    }

    if (APPLY) {
      await prisma.product.update({
        where: { id: p.id },
        data: {
          ...(cash ? { cashPrice: cash.amount } : {}),
          ...(installment ? { installmentPrice: installment.amount } : {}),
        },
      });
    }
    updated++;
  }

  console.log(
    JSON.stringify(
      {
        mode: APPLY ? 'APPLY' : 'DRY_RUN',
        scanned: products.length,
        updated,
        skippedAlreadySet,
        skippedPartialAlreadySet,
        skippedNoRows,
        bySource,
        samples,
        elapsedMs: Date.now() - startedAt,
      },
      null,
      2,
    ),
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
