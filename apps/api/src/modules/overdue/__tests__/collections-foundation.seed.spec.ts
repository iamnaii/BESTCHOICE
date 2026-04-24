import { PrismaClient } from '@prisma/client';
import { seedCollectionsFoundation } from '../../../../prisma/seeds/collections-foundation.seed';

const prisma = new PrismaClient();

describe('seedCollectionsFoundation', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('is idempotent — running twice yields same counts', async () => {
    await seedCollectionsFoundation(prisma);

    const systemUser = await prisma.user.findUnique({
      where: { email: 'system@bestchoice.internal' },
    });
    expect(systemUser?.isSystemUser).toBe(true);
    expect(systemUser?.isActive).toBe(false);

    const rules1 = await prisma.dunningRule.count({
      where: { eventTrigger: { not: null } },
    });
    const configs1 = await prisma.systemConfig.count({
      where: {
        OR: [
          { key: 'collections_v2_enabled' },
          { key: { startsWith: 'mdm_' } },
          { key: { startsWith: 'letter_' } },
        ],
      },
    });
    expect(rules1).toBe(8);
    expect(configs1).toBe(10);

    // Run seed a second time — counts must not change
    await seedCollectionsFoundation(prisma);

    const rules2 = await prisma.dunningRule.count({
      where: { eventTrigger: { not: null } },
    });
    const configs2 = await prisma.systemConfig.count({
      where: {
        OR: [
          { key: 'collections_v2_enabled' },
          { key: { startsWith: 'mdm_' } },
          { key: { startsWith: 'letter_' } },
        ],
      },
    });
    expect(rules2).toBe(8);
    expect(configs2).toBe(10);
  });
});
