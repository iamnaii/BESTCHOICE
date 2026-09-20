import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationTemplateService } from '../../notifications/notification-template.service';

const prisma = new PrismaClient();
const eventType = 'DEVICE_RETURN_CANCELED';
const legacyMessage =
  'ใบรับเครื่องคืน ${docNumber} สัญญา ${contractNumber} ถูกยกเลิก สัญญาเดินต่อตามเดิม หากมีข้อสงสัยติดต่อสาขา ${branchName}';
const migrationsDir = resolve(__dirname, '../../../../prisma/migrations');
// Run the real seed and its additive template corrections, in deployment order.
// Before the correction exists this intentionally exercises the old seeded wording.
const templateMigrations = readdirSync(migrationsDir)
  .filter((name) => /^\d+_.*device_return.*template/.test(name))
  .sort()
  .map((name) => readFileSync(resolve(migrationsDir, name, 'migration.sql'), 'utf8'));

async function applyTemplateMigrations(tx: Prisma.TransactionClient) {
  for (const sql of templateMigrations) await tx.$executeRawUnsafe(sql);
}

// All seeded/modified template rows roll back, even when an assertion fails.
// No dispatch service or external transport is instantiated.
async function withTemplates(check: (tx: Prisma.TransactionClient) => Promise<void>) {
  const rollback = new Error('rollback template fixture');
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(templateMigrations[0]);
      await tx.notificationTemplate.update({
        where: { eventType },
        data: { messageTemplate: legacyMessage },
      });
      await check(tx);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe('device return cancellation template migration (real DB, no sending)', () => {
  it.each(['VOLUNTARY', 'REPOSSESSION'])(
    'renders neutral cancellation for %s without promising contract restoration',
    async (returnKindLabel) => {
      await withTemplates(async (tx) => {
        const before = await tx.notificationTemplate.findUniqueOrThrow({ where: { eventType } });
        await applyTemplateMigrations(tx);
        const after = await tx.notificationTemplate.findUniqueOrThrow({ where: { eventType } });
        const service = new NotificationTemplateService(tx as unknown as PrismaService);
        const { rendered } = await service.renderPreview(eventType, {
          docNumber: 'DR-20260920-0001',
          contractNumber: 'BCP2609-00042',
          branchName: 'ลาดพร้าว',
          returnKindLabel,
          appraisalPrice: '7000',
        });

        expect(rendered).toBe(
          'ใบรับเครื่องคืน DR-20260920-0001 สัญญา BCP2609-00042 ถูกยกเลิก หากมีข้อสงสัยติดต่อสาขา ลาดพร้าว',
        );
        expect(rendered).not.toContain('7000');
        expect(service.extractVariables(after.messageTemplate)).toEqual([
          'docNumber',
          'contractNumber',
          'branchName',
        ]);
        const { messageTemplate: _oldMessage, updatedAt: _oldUpdated, ...oldMetadata } = before;
        const { messageTemplate: _newMessage, updatedAt: _newUpdated, ...newMetadata } = after;
        expect(newMetadata).toEqual(oldMetadata);
      });
    },
  );

  it.each([legacyMessage + ' กรุณาติดต่อผู้จัดการ', 'ข้อความที่เจ้าของแก้เอง ${docNumber}'])(
    'preserves customized cancellation text: %s',
    async (messageTemplate) => {
      await withTemplates(async (tx) => {
        const customized = await tx.notificationTemplate.update({
          where: { eventType },
          data: { messageTemplate },
        });
        await applyTemplateMigrations(tx);
        expect(await tx.notificationTemplate.findUniqueOrThrow({ where: { eventType } })).toEqual(
          customized,
        );
      });
    },
  );

  it('is idempotent and leaves other event templates unchanged even with the same text', async () => {
    await withTemplates(async (tx) => {
      const intake = await tx.notificationTemplate.update({
        where: { eventType: 'DEVICE_RETURNED' },
        data: { messageTemplate: legacyMessage },
      });
      await applyTemplateMigrations(tx);
      const first = await tx.notificationTemplate.findUniqueOrThrow({ where: { eventType } });
      await applyTemplateMigrations(tx);
      expect(await tx.notificationTemplate.findUniqueOrThrow({ where: { eventType } })).toEqual(
        first,
      );
      expect(
        await tx.notificationTemplate.findUniqueOrThrow({
          where: { eventType: 'DEVICE_RETURNED' },
        }),
      ).toEqual(intake);
    });
  });
});
