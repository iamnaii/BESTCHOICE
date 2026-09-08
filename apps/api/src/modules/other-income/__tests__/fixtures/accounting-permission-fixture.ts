import { PrismaService } from '../../../../prisma/prisma.service';
import { AccountingPermission, ACCOUNTING_PERMISSIONS_KEY, parseAccountingPermissions } from '../../../../utils/accounting-permissions';

/** Explicit grants for isolated DB fixtures; does not alter any other actor's permissions. */
export async function setIncomeFixturePermissions(prisma: PrismaService, userId: string, permissions: AccountingPermission[]) {
  const row = await prisma.systemConfig.findUnique({ where: { key: ACCOUNTING_PERMISSIONS_KEY } });
  const assignments = parseAccountingPermissions(row?.value);
  if (permissions.length) assignments[userId] = permissions;
  else delete assignments[userId];
  const value = JSON.stringify(assignments);
  await prisma.systemConfig.upsert({
    where: { key: ACCOUNTING_PERMISSIONS_KEY },
    update: { value, deletedAt: null },
    create: { key: ACCOUNTING_PERMISSIONS_KEY, value },
  });
}
