/**
 * ECL dry-run — คำนวณ provision + delta เทียบ GL โดยไม่เขียนอะไรลง DB
 * ใช้ก่อนเปิดเฟส 1 บน prod: ต่อ prod-copy ผ่าน cloud-sql-proxy แล้วรัน
 *   DATABASE_URL=... npm --prefix apps/api run ecl:dry-run
 */
import { PrismaClient } from '@prisma/client';
import { BadDebtService } from '../modules/accounting/bad-debt.service';
import { JournalAutoService } from '../modules/journal/journal-auto.service';
import { BadDebtProvisionTemplate } from '../modules/journal/cpa-templates/bad-debt-provision.template';
import { BadDebtWriteOffTemplate } from '../modules/journal/cpa-templates/bad-debt-writeoff.template';
import { EclStageReverseTemplate } from '../modules/journal/cpa-templates/ecl-stage-reverse.template';
import { ConsecutiveMissedService } from '../modules/overdue/consecutive-missed.service';

async function main() {
  const prisma = new PrismaClient();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const journal = new JournalAutoService(prisma as any);
    const service = new BadDebtService(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma as any,
      journal,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new BadDebtProvisionTemplate(journal, prisma as any),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new BadDebtWriteOffTemplate(journal, prisma as any),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new EclStageReverseTemplate(journal, prisma as any),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new ConsecutiveMissedService(prisma as any),
    );

    const system = await prisma.user.findFirst({
      where: { isSystemUser: true },
      select: { id: true },
    });
    if (!system) throw new Error('SYSTEM user not found');

    // dryRun=true — read-only: no $transaction, no BadDebtProvisionTemplate.execute (Task 8)
    const result = await service.calculateProvisions(system.id, undefined, true);

    console.log('=== ECL DRY-RUN (no writes) ===');
    console.log('byBucket:', JSON.stringify(result.byBucket, null, 2));
    console.log('totalProvision target:', result.totalProvision.toLocaleString());

    let increase = 0;
    let release = 0;
    for (const d of result.deltas ?? []) {
      const n = Number(d.delta);
      if (n > 0) increase += n;
      else release += n;
    }
    console.log(
      `JE ที่จะโพสต์: ${result.deltas?.filter((d) => Number(d.delta) !== 0).length ?? 0} รายการ`,
    );
    console.log(
      `ตั้งเพิ่มรวม: ${increase.toLocaleString()} ฿ | release รวม: ${release.toLocaleString()} ฿`,
    );
    console.log('--- top 20 by |delta| ---');
    (result.deltas ?? [])
      .sort((a, b) => Math.abs(Number(b.delta)) - Math.abs(Number(a.delta)))
      .slice(0, 20)
      .forEach((d) =>
        console.log(`${d.contractId} ${d.bucket} prevGL=${d.prevGl} target=${d.target} delta=${d.delta}`),
      );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
