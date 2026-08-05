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

function pickInstallment(rows: PriceRow[]): { amount: Prisma.Decimal; source: string } | null {
  const exact = rows.find((r) => r.label === INSTALLMENT_EXACT);
  if (exact) return { amount: exact.amount, source: INSTALLMENT_EXACT };
  const prefix = rows.find((r) => r.label.startsWith(INSTALLMENT_PREFIX));
  if (prefix) return { amount: prefix.amount, source: `prefix:${prefix.label}` };
  return null;
}

function pickCash(rows: PriceRow[]): { amount: Prisma.Decimal; source: string } | null {
  const exact = rows.find((r) => r.label === CASH_EXACT);
  if (exact) return { amount: exact.amount, source: CASH_EXACT };
  const prefix = rows.find((r) => r.label.startsWith(CASH_EXACT));
  if (prefix) return { amount: prefix.amount, source: `prefix:${prefix.label}` };

  // B0: ครอบ default row ทุก label — 'ราคาขาย' (PO receive) /
  // 'ราคาขายต่อ (Refurbished)' (ยึดเครื่อง) — **แต่ต้องกันแถว 'ราคาผ่อน*'**
  // ⚠️ แถว 'ราคาผ่อน BESTCHOICE' เป็น isDefault ได้ (หน้า create ตั้ง isDefault ให้แถวแรก)
  //    ถ้าไม่กัน ราคาผ่อน (สูงกว่า) จะถูกยกขึ้นเป็น "ราคาเงินสด" แล้วเว็บโชว์ราคาแพงกว่าจริง
  //    — ขัดกับ write-through util ของ batch เดียวกันที่กันไว้แล้ว (product-price-sync.util)
  const isCashCandidate = (r: PriceRow) => !r.label.startsWith(INSTALLMENT_PREFIX);

  const def = rows.find((r) => r.isDefault && isCashCandidate(r));
  if (def) return { amount: def.amount, source: `isDefault:${def.label}` };

  const first = rows.find(isCashCandidate);
  if (first) {
    // แถวเดียวที่ไม่รู้จัก label = เดาว่าเป็นราคาเงินสด — ต้องให้เจ้าของรีวิว
    const source = rows.length === 1 ? `AMBIGUOUS_SINGLE_ROW:${first.label}` : `first:${first.label}`;
    return { amount: first.amount, source };
  }

  // มีแต่แถวราคาผ่อน → ไม่เดาเป็นราคาเงินสด (ปล่อยคอลัมน์ cashPrice เป็น null
  // แล้วให้ readiness กรองออก ดีกว่าตั้งราคาผิดแล้วขายจริงตามนั้น)
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
  const bySource: Record<string, number> = {};
  const samples: Record<string, unknown>[] = [];

  for (const p of products) {
    // forward-fix: คอลัมน์ที่มีค่าแล้ว (B0 เขียน / autofill) ห้ามทับ
    if (p.cashPrice != null && p.installmentPrice != null) {
      skippedAlreadySet++;
      continue;
    }
    if (p.prices.length === 0) {
      skippedNoRows++;
      continue;
    }

    const cash = p.cashPrice == null ? pickCash(p.prices) : null;
    const installment = p.installmentPrice == null ? pickInstallment(p.prices) : null;
    if (!cash && !installment) {
      skippedNoRows++;
      continue;
    }

    if (cash) bySource[`cash:${cash.source}`] = (bySource[`cash:${cash.source}`] ?? 0) + 1;
    // เครื่องที่มีแต่แถวราคาผ่อน — cash เป็น null โดยตั้งใจ ต้องนับให้เจ้าของเห็น
    if (!cash && p.cashPrice == null && installment)
      bySource['cash:SKIPPED_INSTALLMENT_ONLY'] = (bySource['cash:SKIPPED_INSTALLMENT_ONLY'] ?? 0) + 1;
    if (installment)
      bySource[`installment:${installment.source}`] =
        (bySource[`installment:${installment.source}`] ?? 0) + 1;

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
