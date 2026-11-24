import { PrismaService } from '../../src/prisma/prisma.service';
import { isIsolatedPreview } from './preview-database';

/** Synthetic staff only. Never imported by the production module. */
export async function seedPreviewEmployeeAccess(db: PrismaService) {
  if (!isIsolatedPreview(process.env.CREDIT_PREVIEW_ROOT)) {
    throw new Error('Employee access fixtures require this preview disposable database');
  }
  const company = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  const branchIds: string[] = [];
  for (const name of ['สาขาทดสอบสิทธิ์ A', 'สาขาทดสอบสิทธิ์ B']) {
    const branch = await db.branch.findFirst({ where: { name, companyId: company.id, deletedAt: null } })
      ?? await db.branch.create({ data: { name, companyId: company.id } });
    branchIds.push(branch.id);
  }
  for (const person of [
    { email: 'preview-access-manager@test.invalid', name: 'ผู้จัดการทดสอบสิทธิ์', role: 'BRANCH_MANAGER' as const, isActive: true, branchId: branchIds[0] },
    { email: 'preview-access-sales@test.invalid', name: 'พนักงานทดสอบสิทธิ์', role: 'SALES' as const, isActive: true, branchId: branchIds[1] },
    { email: 'preview-access-inactive@test.invalid', name: 'พนักงานปิดบัญชีทดสอบ', role: 'SALES' as const, isActive: false, branchId: null },
  ]) {
    await db.user.upsert({
      where: { email: person.email }, update: {},
      create: { ...person, password: 'not-a-login', accessibleCompanies: ['SHOP'], primaryCompany: 'SHOP', canReverseOverride: true },
    });
  }
}
