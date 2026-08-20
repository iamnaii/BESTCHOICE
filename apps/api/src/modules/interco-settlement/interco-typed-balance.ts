import { Prisma, PrismaClient } from '@prisma/client';

type Client = Prisma.TransactionClient | PrismaClient;

/**
 * Typed GL balances สำหรับหักกลบรอบจ่าย (Phase 2 — spec §4).
 *
 * เงื่อนไข type ต้อง**สอดคล้อง**กับ `classifyShopReceivable` (shop-receivable-type.util.ts):
 * - SWAP_CREDIT ฝั่ง 11-2107: explicit stamp หรือ legacy flow 'exchange-buyback-receivable-11-2107'
 *   (mirror ตอน cancel carry stamp มาแล้วตั้งแต่ Phase 1 → net เป็นศูนย์เองในประเภทเดียวกัน)
 * - PAYOUT_RECALL: explicit stamp เท่านั้น (type ใหม่ ไม่มี legacy)
 * - S21-3001 SWAP_CREDIT: key ด้วย metadata.newContractId (A.4 stamp ตั้งแต่ Phase 2 Task 1)
 * - S21-3001 PAYOUT_RECALL: key ด้วย metadata.contractId (C-2 producer ใน Phase 3)
 *
 * SQL twins ของเงื่อนไขชุดนี้อยู่ในเลนส์ `IntercoPendingService` (grouped
 * queries — interco-pending.service.ts) — แก้ที่ไหนต้องแก้ทั้งคู่;
 * anti-drift net คือ interco-netting.integration.spec.ts.
 */
async function sumTyped(
  client: Client,
  accountCode: string,
  sign: 'dr-cr' | 'cr-dr',
  where: Prisma.Sql,
): Promise<Prisma.Decimal> {
  const expr =
    sign === 'dr-cr'
      ? Prisma.sql`SUM(jl.debit - jl.credit)`
      : Prisma.sql`SUM(jl.credit - jl.debit)`;
  const rows = await client.$queryRaw<Array<{ balance: unknown }>>(Prisma.sql`
    SELECT COALESCE(${expr}, 0)::decimal AS balance
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE jl.account_code = ${accountCode}
      AND jl.deleted_at IS NULL
      AND je.status = 'POSTED'
      AND je.deleted_at IS NULL
      AND ${where}
  `);
  return new Prisma.Decimal(String(rows[0]?.balance ?? 0));
}

/** 11-2107 Σ(Dr−Cr) เฉพาะประเภท SWAP_CREDIT (explicit stamp หรือ legacy A.3 flow) */
export function swapCreditFinanceBalance(
  client: Client,
  contractId: string,
): Promise<Prisma.Decimal> {
  return sumTyped(
    client,
    '11-2107',
    'dr-cr',
    Prisma.sql`
    je.metadata->>'contractId' = ${contractId}
    AND (je.metadata->>'shopReceivableType' = 'SWAP_CREDIT'
         OR je.metadata->>'flow' = 'exchange-buyback-receivable-11-2107')`,
  );
}

/** S21-3001 Σ(Cr−Dr) เฉพาะ SWAP_CREDIT — key ด้วย metadata.newContractId (A.4) */
export function swapCreditShopBalance(
  client: Client,
  newContractId: string,
): Promise<Prisma.Decimal> {
  return sumTyped(
    client,
    'S21-3001',
    'cr-dr',
    Prisma.sql`
    je.metadata->>'newContractId' = ${newContractId}
    AND je.metadata->>'shopReceivableType' = 'SWAP_CREDIT'`,
  );
}

/** 11-2107 Σ(Dr−Cr) เฉพาะประเภท PAYOUT_RECALL (explicit stamp เท่านั้น) */
export function recallFinanceBalance(client: Client, contractId: string): Promise<Prisma.Decimal> {
  return sumTyped(
    client,
    '11-2107',
    'dr-cr',
    Prisma.sql`
    je.metadata->>'contractId' = ${contractId}
    AND je.metadata->>'shopReceivableType' = 'PAYOUT_RECALL'`,
  );
}

/** S21-3001 Σ(Cr−Dr) เฉพาะ PAYOUT_RECALL — key ด้วย metadata.contractId (C-2) */
export function recallShopBalance(client: Client, contractId: string): Promise<Prisma.Decimal> {
  return sumTyped(
    client,
    'S21-3001',
    'cr-dr',
    Prisma.sql`
    je.metadata->>'contractId' = ${contractId}
    AND je.metadata->>'shopReceivableType' = 'PAYOUT_RECALL'`,
  );
}
