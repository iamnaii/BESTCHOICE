import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';

/**
 * SP7.7 — Audit ambiguous tables before SHOP/FINANCE split.
 *
 * Per spec section 11.2, 3 tables need manual classification:
 *   - customers: split by usage (POS/quote → SHOP; contract/LIFF → FINANCE; both → linked)
 *   - fixed_assets: HQ assets → FINANCE; branch assets → SHOP
 *   - payroll_*: by employee.branchId → SHOP; HQ staff → FINANCE
 *
 * Outputs CSV to docs/migration/audit-<table>-<date>.csv for accountant review.
 */

async function main() {
  const logger = new Logger('AuditEdgeCasesSP7');
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  const outDir = path.resolve(__dirname, '../../../../docs/migration');
  fs.mkdirSync(outDir, { recursive: true });
  const dateStr = new Date().toISOString().slice(0, 10);

  logger.log(`Output directory: ${outDir}`);

  // 1. Customers
  await auditCustomers(prisma, logger, outDir, dateStr);

  // 2. Fixed assets
  await auditFixedAssets(prisma, logger, outDir, dateStr);

  // 3. Payroll (if payroll module exists)
  await auditPayroll(prisma, logger, outDir, dateStr);

  await app.close();
  logger.log('Audit complete. Send CSV files to accountant for classification review.');
}

async function auditCustomers(
  prisma: PrismaService,
  logger: Logger,
  outDir: string,
  dateStr: string,
) {
  // Heuristic: customers WITH contracts → FINANCE; without contracts → SHOP only;
  // customers in both contract + sales → BOTH (will be duplicated post-split with national_id link)
  const customers = await prisma.customer
    .findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        phone: true,
        nationalId: true,
        createdAt: true,
        _count: { select: { contracts: true } },
      },
    })
    .catch(() => [] as any[]);

  const rows = customers.map((c: any) => {
    const hasContracts = (c._count?.contracts ?? 0) > 0;
    const classification = hasContracts ? 'BOTH (duplicate at split)' : 'SHOP only';
    return [
      c.id,
      JSON.stringify(c.name ?? ''),
      JSON.stringify(c.phone ?? ''),
      c.nationalId ? '***' : '',
      c.createdAt.toISOString(),
      c._count?.contracts ?? 0,
      classification,
    ].join(',');
  });

  const csv = [
    'id,name,phone,national_id,created_at,contract_count,classification',
    ...rows,
  ].join('\n');
  const file = path.join(outDir, `audit-customers-${dateStr}.csv`);
  fs.writeFileSync(file, csv);
  logger.log(`Wrote ${rows.length} customers → ${file}`);
}

async function auditFixedAssets(
  prisma: PrismaService,
  logger: Logger,
  outDir: string,
  dateStr: string,
) {
  const assets =
    (await (prisma as any).fixedAsset
      ?.findMany?.({
        where: { deletedAt: null },
        select: {
          id: true,
          assetCode: true,
          name: true,
          location: true,
          branchId: true,
          purchaseDate: true,
        },
      })
      .catch(() => [] as any[])) ?? [];

  const rows = assets.map((a: any) => {
    const classification = a.branchId ? 'SHOP (branch-located)' : 'FINANCE (HQ asset)';
    return [
      a.id,
      a.assetCode ?? '',
      JSON.stringify(a.name ?? ''),
      JSON.stringify(a.location ?? ''),
      a.branchId ?? '',
      a.purchaseDate?.toISOString() ?? '',
      classification,
    ].join(',');
  });

  const csv = [
    'id,asset_code,name,location,branch_id,purchase_date,classification',
    ...rows,
  ].join('\n');
  const file = path.join(outDir, `audit-fixed-assets-${dateStr}.csv`);
  fs.writeFileSync(file, csv);
  logger.log(`Wrote ${rows.length} fixed_assets → ${file}`);
}

async function auditPayroll(
  prisma: PrismaService,
  logger: Logger,
  outDir: string,
  dateStr: string,
) {
  // Payroll module may or may not exist — guard with optional chaining
  const payrolls =
    (await (prisma as any).payrollDocument
      ?.findMany?.({
        where: { deletedAt: null },
        select: {
          id: true,
          documentNumber: true,
          periodMonth: true,
          periodYear: true,
          status: true,
          lines: {
            select: {
              userId: true,
              user: { select: { branchId: true } },
            },
          },
        },
      })
      .catch(() => [] as any[])) ?? [];

  if (payrolls.length === 0) {
    logger.log('No payroll table or rows — skipping payroll audit');
    return;
  }

  const rows: string[] = [];
  for (const p of payrolls) {
    const hasShopOnly = p.lines.every((l: any) => l.user?.branchId);
    const hasFinOnly = p.lines.every((l: any) => !l.user?.branchId);
    const classification = hasShopOnly
      ? 'SHOP only'
      : hasFinOnly
        ? 'FINANCE only'
        : 'MIXED — needs split';
    rows.push(
      [p.id, p.documentNumber, p.periodYear, p.periodMonth, p.status, p.lines.length, classification].join(
        ',',
      ),
    );
  }

  const csv = ['id,doc_number,year,month,status,line_count,classification', ...rows].join('\n');
  const file = path.join(outDir, `audit-payroll-${dateStr}.csv`);
  fs.writeFileSync(file, csv);
  logger.log(`Wrote ${rows.length} payroll docs → ${file}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
