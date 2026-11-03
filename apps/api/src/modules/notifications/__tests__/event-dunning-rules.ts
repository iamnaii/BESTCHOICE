/**
 * Task 30 — กฎทวงตามเหตุการณ์สำหรับสเปค DB บนฐานใดก็ได้: CI สร้างฐานด้วย `prisma migrate deploy` อย่างเดียว (ไม่ seed — `deploy-gcp.yml`)
 * ส่วนฐานบนเครื่อง (`bestchoice_ci`) มีกฎที่ seed ไว้แล้ว
 *
 * สร้างกฎของสเปคเอง (ข้อความ/ช่องทาง/ลิงก์จาก `EVENT_DUNNING_RULES` ใน seed — แหล่งเดียว ไม่คัดลอกข้อความ) `isActive = true` ·
 * พักกฎอื่นที่เปิดอยู่ของเหตุการณ์เดียวกันระหว่างสเปค (engine เลือกกฎด้วย `findFirst` — ให้ได้กฎของสเปคแน่นอน) · คืนฟังก์ชันเก็บกวาด:
 * เปิดกฎที่พักกลับ + ลบ DunningAction/กฎของสเปค (สเปค seed `collections-foundation.seed.spec.ts` นับกฎที่มี eventTrigger ทั้งตาราง)
 *
 * ไม่ใช่ไฟล์ spec
 */
import { PrismaClient } from '@prisma/client';
import {
  EVENT_DUNNING_RULES,
  EventDunningRuleSeed,
} from '../../../../prisma/seeds/collections-foundation.seed';

export async function useSeededEventDunningRules(
  prisma: PrismaClient,
  stamp: string,
  triggers: EventDunningRuleSeed['eventTrigger'][],
): Promise<() => Promise<void>> {
  const created: string[] = [];
  for (const trigger of triggers) {
    const seed = EVENT_DUNNING_RULES.find((rule) => rule.eventTrigger === trigger);
    if (!seed) throw new Error(`ไม่มีกฎ seed ของ ${trigger}`);
    const rule = await prisma.dunningRule.create({
      data: {
        name: `${stamp} ${seed.name}`,
        triggerDay: null,
        eventTrigger: seed.eventTrigger,
        channel: seed.channel,
        messageTemplate: seed.messageTemplate,
        includePaymentLink: seed.includePaymentLink,
        autoExecute: seed.autoExecute,
        isActive: true,
        sortOrder: seed.sortOrder,
      },
      select: { id: true },
    });
    created.push(rule.id);
  }
  const paused = (
    await prisma.dunningRule.findMany({
      where: { eventTrigger: { in: triggers }, isActive: true, id: { notIn: created } },
      select: { id: true },
    })
  ).map((rule) => rule.id);
  await prisma.dunningRule.updateMany({
    where: { id: { in: paused } },
    data: { isActive: false },
  });

  return async () => {
    await prisma.dunningRule.updateMany({
      where: { id: { in: paused } },
      data: { isActive: true },
    });
    await prisma.dunningAction.deleteMany({ where: { dunningRuleId: { in: created } } });
    await prisma.dunningRule.deleteMany({ where: { id: { in: created } } });
  };
}
