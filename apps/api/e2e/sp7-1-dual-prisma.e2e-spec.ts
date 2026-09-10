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
import { resolveCompanyAccess } from '@installment/shared';

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
  //
  // ⚠️ `admin@bestchoice.com` ใช้ยืนยัน seed ไม่ได้ — e2e อีก 6 ไฟล์ upsert อีเมลนี้เป็น fixture
  // ของตัวเอง (payment-approval-record:60, paysolutions-overpay-surplus:68, autoallocate-
  // partial-complete:233, backfill-orphan-partial-receipts:82, ...) โดยไม่ใส่ companies และทั้งชุด
  // ใช้ DB ก้อนเดียวกัน ⇒ ใน CI แถวนี้มาจากสเปกที่รันก่อน ไม่ได้มาจาก seed แถว accessible_companies
  // จึงเป็น [] โดยชอบธรรม การ assert ค่าดิบตรงนี้จึงแดงโดยไม่ได้แปลว่า seed หรือระบบพัง
  // (เป็นเหตุให้ deploy run 34503810687 แดง) สิ่งที่ต้องยืนยันกับแถวแบบนี้คือ **กฎ runtime**:
  // ว่างแล้วต้อง resolve เป็นค่า default ของ role ไม่ใช่ล็อกเอาต์ ซึ่งคือหัวใจของ hotfix นี้
  it('OWNER ที่แถวยังว่าง ต้อง resolve เป็นสิทธิ์เต็มของ role ไม่ใช่ถูกล็อก', async () => {
    const user = await prismaShop.user.findFirst({
      where: { email: 'admin@bestchoice.com', deletedAt: null },
      select: { accessibleCompanies: true, primaryCompany: true },
    });
    if (!user) {
      console.warn('[SP7.1 e2e] admin@bestchoice.com not in DB — skipping grants check');
      return;
    }

    const resolved = resolveCompanyAccess('OWNER', user.accessibleCompanies, user.primaryCompany);
    expect([...resolved.accessible].sort()).toEqual(['FINANCE', 'SHOP']);
    expect(resolved.primary).toBe('SHOP');
  });

  // ตัวยืนยัน seed ตัวจริงย้ายมาที่ ACCOUNTANT: `accountant@bestchoice.com` เป็นอีเมลของ seed
  // ล้วน ไม่มี e2e ไฟล์ไหน upsert ทับ ค่าดิบในแถวจึงเชื่อได้ว่ามาจาก seed จริง
  //
  // ขอบเขตที่แท้จริง: ด่านนี้ยิงเฉพาะ environment ที่ **รัน seed แล้ว** (เครื่อง dev / staging)
  // ใน CI ไม่มีแถวนี้เลยเพราะ job integration รันแค่ migrate ไม่ได้ seed ⇒ เข้า guard แล้วผ่าน
  // ถ้าอยากให้กันใน CI ด้วยต้องเพิ่มขั้นตอน `prisma:seed` เข้า job ซึ่งกระทบสเปกอื่นที่นับแถว
  // ในฐาน จึงจงใจไม่ทำในรอบ hotfix นี้
  // และ primaryCompany ของ role นี้คือค่าที่เพิ่งแก้ในรอบนี้ (seed เดิมให้ 'SHOP' ทั้งที่
  // ZONE_CONFIG ตั้ง defaultZone ของ ACCOUNTANT เป็น 'fin') — ถ้าใครย้อน seed กลับ เทสต์นี้แดง
  // ⚠️ ห้ามลดกลับไปเป็น toHaveProperty และห้ามห่อด้วย resolveCompanyAccess ตรงนี้เด็ดขาด
  // จุดนี้ต้องดูค่าดิบเท่านั้น ไม่งั้นจะกลับไปเขียวแม้ seed เขียน [] เหมือนเดิม
  it('seeded ACCOUNTANT มี company grants จริงในแถว ไม่ใช่แค่มีคอลัมน์', async () => {
    const user = await prismaShop.user.findFirst({
      where: { email: 'accountant@bestchoice.com', deletedAt: null },
      select: { accessibleCompanies: true, primaryCompany: true },
    });
    if (!user) {
      console.warn('[SP7.1 e2e] accountant@bestchoice.com not in DB — skipping grants check');
      return;
    }

    expect([...user.accessibleCompanies].sort()).toEqual(['FINANCE', 'SHOP']);
    expect(user.primaryCompany).toBe('FINANCE');
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
