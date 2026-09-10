/**
 * SP7.1 — Dual Prisma + Entity Scope integration test (e2e style)
 * ----------------------------------------------------------------
 * Verifies that both Prisma clients (PrismaService for SHOP DB +
 * PrismaFinanceService for FINANCE DB) connect to distinct databases
 * and that entity-scope wiring is present at application level.
 *
 * Skip gate: requires DATABASE_URL (SHOP) AND DATABASE_URL_FINANCE (FINANCE).
 * CI provisions both via two postgres services — see Task 10 in
 * docs/architecture/dual-prisma.md and the `dual-prisma-integration` job
 * added to `.github/workflows/deploy-gcp.yml`.
 *
 * To run locally:
 *   export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/installment_db?schema=public"
 *   export DATABASE_URL_FINANCE="postgresql://postgres:postgres@localhost:5433/installment_finance_db?schema=public"
 *   cd apps/api && npx jest --config e2e/jest-e2e.json e2e/sp7-1-dual-prisma.e2e-spec.ts --runInBand
 *
 * If the SHOP DB is not seeded the login smoke test logs a warning and returns
 * early — it does NOT fail, so CI runs with a fresh DB are still green.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PrismaFinanceService } from '../src/prisma/prisma-finance.service';

const HAS_DUAL_DB = !!(process.env.DATABASE_URL && process.env.DATABASE_URL_FINANCE);

// SP7.1 — e2e verifying dual-Prisma + entity scope work end-to-end.
// Skipped when DATABASE_URL or DATABASE_URL_FINANCE missing.
// CI provisions both via two postgres services (SP7.1 Task 10).
const describeOrSkip = HAS_DUAL_DB ? describe : describe.skip;

describeOrSkip('SP7.1 — Dual Prisma + Entity Scope (e2e)', () => {
  let app: INestApplication;
  let prismaShop: PrismaService;
  let prismaFin: PrismaFinanceService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prismaShop = app.get(PrismaService);
    prismaFin = app.get(PrismaFinanceService);
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  it('PrismaService connects to bc_shop / installment_db', async () => {
    const result =
      await prismaShop.$queryRaw<Array<{ db: string }>>`SELECT current_database() as db`;
    expect(result[0].db).not.toContain('finance');
  });

  it('PrismaFinanceService connects to bc_finance / installment_finance_db', async () => {
    const result =
      await prismaFin.$queryRaw<Array<{ db: string }>>`SELECT current_database() as db`;
    expect(result[0].db).toContain('finance');
  });

  it('PrismaFinanceService can read its own healthCheck table', async () => {
    const created = await prismaFin.healthCheck.create({ data: {} });
    try {
      const all = await prismaFin.healthCheck.findMany({
        take: 1,
        orderBy: { createdAt: 'desc' },
      });
      expect(all[0].id).toBe(created.id);
    } finally {
      await prismaFin.healthCheck.delete({ where: { id: created.id } });
    }
  });

  // ⚠️ ห้ามลดกลับไปเป็น toHaveProperty('accessibleCompanies') อีกเด็ดขาด
  // เวอร์ชันเดิม assert แค่ว่า "มีคีย์" ซึ่งเขียวแม้ค่าจะเป็น [] — จึงไม่เคยจับได้เลยว่า
  // ไม่มีเส้นทางไหนเขียนคอลัมน์นี้ให้ user จริง ๆ ตลอด 4 เดือน จนกลายเป็น outage
  // 2026-09-08 (ทุกคนเห็นหน้าจอ "ไม่มีสิทธิ์เข้าถึงบริษัท") ต้อง assert **ค่าจริง** เท่านั้น
  // ค่าที่คาดหวังคือ ROLE_COMPANY_ACCESS ใน packages/shared/src/company-access.ts
  // ซึ่ง apps/api/prisma/seed.ts derive มาใช้โดยตรง
  //
  // ยังคง guard "ไม่มีแถว = warn แล้วผ่าน" ไว้ เพราะ CI รันกับ DB เปล่าที่ยังไม่ seed
  // (supertest ไม่ใช่ dev dependency ของ repo นี้ จึงเช็คระดับ service ตามแบบของ
  // approval-workflow.e2e-spec.ts)
  it('seeded OWNER มี company grants จริง ไม่ใช่แค่มีคอลัมน์', async () => {
    const user = await prismaShop.user.findFirst({
      where: { email: 'admin@bestchoice.com', deletedAt: null },
      select: { accessibleCompanies: true, primaryCompany: true },
    });
    if (!user) {
      console.warn('[SP7.1 e2e] admin@bestchoice.com not in DB — skipping grants check');
      return;
    }

    expect([...user.accessibleCompanies].sort()).toEqual(['FINANCE', 'SHOP']);
    expect(user.primaryCompany).toBe('SHOP');
  });

  // FINANCE_MANAGER คือ role ที่ค่าเปลี่ยนจริงในรอบนี้: seed เดิมให้ ['FINANCE'] อย่างเดียว
  // ทั้งที่เมนูของ role นี้มี section โซน shop จริง — ถ้าใครย้อน seed กลับ เทสต์นี้แดง
  it('seeded FINANCE_MANAGER เข้าถึงได้ทั้ง SHOP และ FINANCE โดย primary = FINANCE', async () => {
    const user = await prismaShop.user.findFirst({
      where: { email: 'finance@bestchoice.com', deletedAt: null },
      select: { accessibleCompanies: true, primaryCompany: true },
    });
    if (!user) {
      console.warn('[SP7.1 e2e] finance@bestchoice.com not in DB — skipping grants check');
      return;
    }

    expect([...user.accessibleCompanies].sort()).toEqual(['FINANCE', 'SHOP']);
    expect(user.primaryCompany).toBe('FINANCE');
  });
});
