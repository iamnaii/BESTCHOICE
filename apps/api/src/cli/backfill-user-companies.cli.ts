import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';

export const ROLE_ACCESS_MAP: Record<string, { accessible: string[]; primary: string }> = {
  OWNER: { accessible: ['SHOP', 'FINANCE'], primary: 'SHOP' },
  ACCOUNTANT: { accessible: ['SHOP', 'FINANCE'], primary: 'FINANCE' },
  FINANCE_MANAGER: { accessible: ['FINANCE'], primary: 'FINANCE' },
  BRANCH_MANAGER: { accessible: ['SHOP'], primary: 'SHOP' },
  SALES: { accessible: ['SHOP'], primary: 'SHOP' },
};

async function main() {
  const logger = new Logger('BackfillUserCompanies');
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  const users = await prisma.user.findMany({
    where: {
      accessibleCompanies: { equals: [] },
      deletedAt: null,
    },
    select: { id: true, email: true, role: true },
  });

  logger.log(`Backfilling ${users.length} users with empty accessibleCompanies`);

  let updated = 0;
  for (const user of users) {
    const access = ROLE_ACCESS_MAP[user.role] ?? { accessible: ['SHOP'], primary: 'SHOP' };
    await prisma.user.update({
      where: { id: user.id },
      data: {
        accessibleCompanies: access.accessible,
        primaryCompany: access.primary,
      },
    });
    logger.log(`  ${user.email} (${user.role}) → ${access.accessible.join(',')} primary=${access.primary}`);
    updated++;
  }

  await app.close();
  logger.log(`Done — ${updated} users updated`);
}

// Only run when executed directly (not when imported by tests)
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
