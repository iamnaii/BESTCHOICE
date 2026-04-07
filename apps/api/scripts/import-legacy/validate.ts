/**
 * Validation report for imported legacy contracts
 *
 * Usage: npx tsx scripts/import-legacy/validate.ts
 *
 * ตรวจสอบสัญญาที่ import มา เช็ค sanity rules ดังนี้:
 *   R1. totalMonths × monthlyPayment ≈ financedAmount + storeCommission + interestTotal
 *   R2. downPayment + financedAmount ≈ sellingPrice
 *   R3. จำนวน payments ต่อ contract = totalMonths
 *   R4. sum(payment.amountDue) ≈ totalMonths × monthlyPayment
 *   R5. status COMPLETED → ทุก payment ต้อง PAID
 *   R6. status CLOSED_BAD_DEBT → ต้องมีอย่างน้อย 1 payment ที่ยังไม่ paid
 *   R7. storeCommission ≈ financedAmount × 10% (business rule)
 *   R8. interestRate > 0 (ทุก contract ผ่อนมีดอกเบี้ย)
 *   R9. Contract มี legacyContractCode (trace ได้)
 *   R10. Customer ที่ link กับ contract ต้องมี legacyMemberCode
 */
import { PrismaClient, ContractStatus, PaymentStatus } from '@prisma/client';

const p = new PrismaClient();
const TOLERANCE = 1; // บาท (รับค่าความคลาดเคลื่อน rounding)

interface Issue {
  rule: string;
  contract: string;
  detail: string;
}

const issues: Issue[] = [];
function report(rule: string, contract: string, detail: string) {
  issues.push({ rule, contract, detail });
}

function near(a: number, b: number, tol = TOLERANCE): boolean {
  return Math.abs(a - b) <= tol;
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Legacy Import Validation Report');
  console.log('═══════════════════════════════════════════════\n');

  const contracts = await p.contract.findMany({
    where: { legacyContractCode: { not: null } },
    include: { payments: true, customer: true },
  });

  console.log(`Checking ${contracts.length} imported contracts...\n`);

  let r1 = 0, r2 = 0, r3 = 0, r4 = 0, r5 = 0, r6 = 0, r7 = 0, r8 = 0, r9 = 0, r10 = 0;

  for (const c of contracts) {
    const sellingPrice = Number(c.sellingPrice);
    const downPayment = Number(c.downPayment);
    const financedAmount = Number(c.financedAmount);
    const storeCommission = Number(c.storeCommission || 0);
    const vatAmount = Number(c.vatAmount || 0);
    const interestTotal = Number(c.interestTotal);
    const monthlyPayment = Number(c.monthlyPayment);
    const totalMonths = c.totalMonths;
    const interestRate = Number(c.interestRate);

    // R1: totalMonths × monthlyPayment ≈ financed + commission + interest + vat
    const expectedTotal = financedAmount + storeCommission + interestTotal + vatAmount;
    const actualTotal = totalMonths * monthlyPayment;
    if (!near(actualTotal, expectedTotal, 2)) {
      report('R1', c.contractNumber, `months×monthly=${actualTotal}, financed+com+int+vat=${expectedTotal}, diff=${(actualTotal - expectedTotal).toFixed(2)}`);
      r1++;
    }

    // R2: downPayment + financedAmount ≈ sellingPrice
    if (!near(downPayment + financedAmount, sellingPrice, 2)) {
      report('R2', c.contractNumber, `down+financed=${downPayment + financedAmount}, selling=${sellingPrice}, diff=${(downPayment + financedAmount - sellingPrice).toFixed(2)}`);
      r2++;
    }

    // R3: จำนวน payments = totalMonths (skip draft ที่ยังไม่ได้อนุมัติ)
    // draft = payments ว่างทั้งหมดจากข้อมูลเก่า (contract_status=0 approved_status=0)
    const isDraft = c.payments.length === 0;
    if (!isDraft && c.payments.length !== totalMonths) {
      report('R3', c.contractNumber, `payments=${c.payments.length}, totalMonths=${totalMonths}`);
      r3++;
    }

    // R4: sum(payment.amountDue) ≈ totalMonths × monthlyPayment (skip draft)
    if (!isDraft) {
      const sumDue = c.payments.reduce((a, pm) => a + Number(pm.amountDue), 0);
      if (!near(sumDue, actualTotal, 10)) {
        report('R4', c.contractNumber, `sum(payments.due)=${sumDue}, months×monthly=${actualTotal}, diff=${(sumDue - actualTotal).toFixed(2)}`);
        r4++;
      }
    }

    // R5: COMPLETED → ทุก payment ต้อง PAID
    if (c.status === ContractStatus.COMPLETED) {
      const unpaid = c.payments.filter((pm) => pm.status !== PaymentStatus.PAID);
      if (unpaid.length > 0) {
        report('R5', c.contractNumber, `COMPLETED แต่มี ${unpaid.length} payments ยังไม่ PAID`);
        r5++;
      }
    }

    // R6: CLOSED_BAD_DEBT → ต้องมีอย่างน้อย 1 payment ยังไม่ paid
    if (c.status === ContractStatus.CLOSED_BAD_DEBT) {
      const paid = c.payments.filter((pm) => pm.status === PaymentStatus.PAID);
      if (paid.length === c.payments.length && c.payments.length > 0) {
        report('R6', c.contractNumber, `BAD_DEBT แต่ payments PAID ทั้งหมด`);
        r6++;
      }
    }

    // R7: storeCommission ≈ financedAmount × 10%
    const expectedCommission = financedAmount * 0.10;
    if (!near(storeCommission, expectedCommission, 2)) {
      report('R7', c.contractNumber, `commission=${storeCommission}, expected(10%)=${expectedCommission.toFixed(2)}`);
      r7++;
    }

    // R8: interestRate > 0
    if (interestRate <= 0 && financedAmount > 0) {
      report('R8', c.contractNumber, `interestRate=${interestRate} (ควร > 0)`);
      r8++;
    }

    // R9: legacyContractCode
    if (!c.legacyContractCode) {
      report('R9', c.contractNumber, 'missing legacyContractCode');
      r9++;
    }

    // R10: customer legacyMemberCode
    if (!c.customer.legacyMemberCode) {
      report('R10', c.contractNumber, `customer ${c.customer.name} ไม่มี legacyMemberCode`);
      r10++;
    }
  }

  // ===== Summary =====
  console.log('─── Rule Summary ────────────────────────────');
  const rules = [
    ['R1', 'months×monthly ≈ financed+com+interest+vat', r1],
    ['R2', 'down + financed ≈ sellingPrice', r2],
    ['R3', 'payments count = totalMonths', r3],
    ['R4', 'sum(payments.due) ≈ total', r4],
    ['R5', 'COMPLETED → all payments PAID', r5],
    ['R6', 'BAD_DEBT → not all PAID', r6],
    ['R7', 'commission ≈ financed × 10%', r7],
    ['R8', 'interestRate > 0', r8],
    ['R9', 'has legacyContractCode', r9],
    ['R10', 'customer has legacyMemberCode', r10],
  ] as const;
  for (const [code, desc, count] of rules) {
    const icon = count === 0 ? '✅' : '❌';
    console.log(`${icon} ${code.padEnd(4)} ${desc.padEnd(45)} ${count === 0 ? 'PASS' : count + ' violations'}`);
  }

  console.log(`\n─── Summary ─────────────────────────────────`);
  console.log(`Total contracts checked: ${contracts.length}`);
  console.log(`Total issues:            ${issues.length}`);

  // Status breakdown
  const statusCount: Record<string, number> = {};
  for (const c of contracts) statusCount[c.status] = (statusCount[c.status] || 0) + 1;
  console.log(`\n─── Contract Status Distribution ────────────`);
  for (const [st, n] of Object.entries(statusCount).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${st.padEnd(20)} ${n}`);
  }

  // Totals (sanity numbers)
  const totals = contracts.reduce(
    (acc, c) => {
      acc.financed += Number(c.financedAmount);
      acc.commission += Number(c.storeCommission || 0);
      acc.interest += Number(c.interestTotal);
      acc.down += Number(c.downPayment);
      return acc;
    },
    { financed: 0, commission: 0, interest: 0, down: 0 }
  );
  console.log(`\n─── Money Totals (all contracts) ────────────`);
  console.log(`  Total down payments:  ${totals.down.toLocaleString()} บาท`);
  console.log(`  Total financed:       ${totals.financed.toLocaleString()} บาท`);
  console.log(`  Total commission:     ${totals.commission.toLocaleString()} บาท (10% of financed)`);
  console.log(`  Total interest:       ${totals.interest.toLocaleString()} บาท`);
  console.log(`  Grand total received: ${(totals.financed + totals.commission + totals.interest).toLocaleString()} บาท`);

  // First 15 issues
  if (issues.length > 0) {
    console.log(`\n─── First 15 Issues ─────────────────────────`);
    for (const i of issues.slice(0, 15)) {
      console.log(`  [${i.rule}] ${i.contract}: ${i.detail}`);
    }
    if (issues.length > 15) console.log(`  ... and ${issues.length - 15} more`);
  }

  await p.$disconnect();
  process.exit(issues.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('💥 FATAL:', e);
  process.exit(2);
});
