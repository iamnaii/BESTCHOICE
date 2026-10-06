import { ForbiddenException, Injectable } from '@nestjs/common';
import { CHAT_WORK_FLAGS, ChatWorkActor, WorkScope } from '@installment/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { ChatWorkAccessService, roomWorkWhere } from './chat-work-access.service';
import { UpdateChatWorkSettingsDto } from '../dto/chat-work-settings.dto';
import {
  policyVersion,
  readCurrentSlaPolicy,
  validateSlaPolicy,
} from '../../chat-engine/services/chat-sla-policy';

@Injectable()
export class ChatWorkSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ChatWorkAccessService,
  ) {}
  async read(actor: ChatWorkActor, scope: WorkScope) {
    roomWorkWhere(await this.access.currentActor(actor), scope);
    const config = await this.prisma.systemConfig.findMany({
      where: { key: { in: [...CHAT_WORK_FLAGS] }, deletedAt: null },
    });
    const flags = Object.fromEntries(
      CHAT_WORK_FLAGS.map((key) => [
        key,
        config.some((row) => row.key === key && row.value === 'true'),
      ]),
    );
    return {
      flags,
      policy: await readCurrentSlaPolicy(this.prisma),
      observedAt: new Date().toISOString(),
    };
  }
  async update(actor: ChatWorkActor, input: UpdateChatWorkSettingsDto) {
    const current = await this.access.currentActor(actor);
    if (current.role !== 'OWNER')
      throw new ForbiddenException('เฉพาะเจ้าของที่แก้ไขการตั้งค่างานแชทได้');
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('chat-work-settings'))`;
      const before = await readCurrentSlaPolicy(tx);
      const policy = {
        ...before,
        ownerMinutes: input.ownerMinutes ?? before.ownerMinutes,
        managerMinutes: input.managerMinutes ?? before.managerMinutes,
      };
      validateSlaPolicy(policy);
      const version = policyVersion(policy);
      for (const [key, value] of [
        ['chat_sla_policy', version],
        ['chat_sla_owner_minutes', String(policy.ownerMinutes)],
        ['chat_sla_manager_minutes', String(policy.managerMinutes)],
      ] as const) {
        await tx.systemConfig.upsert({
          where: { key },
          create: { key, value },
          update: { value, deletedAt: null },
        });
      }
      for (const flag of input.flags ?? []) {
        if (!CHAT_WORK_FLAGS.includes(flag.key) || typeof flag.enabled !== 'boolean')
          throw new ForbiddenException('ไม่อนุญาตให้แก้ไขการตั้งค่านี้');
        const value = String(flag.enabled);
        const existing = await tx.systemConfig.findUnique({ where: { key: flag.key } });
        // Only actual OFF→ON changes the eligibility cutover. An unchanged settings save must not hide work.
        if (existing?.value === value && !existing.deletedAt) continue;
        await tx.systemConfig.upsert({
          where: { key: flag.key },
          create: { key: flag.key, value },
          update: { value, deletedAt: null },
        });
      }
      await tx.auditLog.create({
        data: {
          userId: current.id,
          action: 'CHAT_WORK_SETTINGS_UPDATED',
          entity: 'SystemConfig',
          entityId: 'chat_sla_policy',
          oldValue: { policy: { ...before } },
          newValue: {
            policy,
            flags: input.flags?.map((flag) => ({ key: flag.key, enabled: flag.enabled })) ?? [],
          },
        },
      });
      return { policy, version };
    });
  }
}
