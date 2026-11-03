import type { PrismaService } from '../../prisma/prisma.service';
import { hasActivePdpaConsent } from '../pdpa/active-consent';

/** ข้อความของแถว SKIPPED เมื่อลูกค้าไม่มีความยินยอม — เหมือนกันทุกผู้ส่งที่ใช้ด่านนี้ */
export const NO_PDPA_CONSENT_SKIP_MESSAGE = 'ข้ามการแจ้งเตือน — ลูกค้าไม่มี PDPA consent';

/**
 * ด่านความยินยอม PDPA ของ**ผู้ส่งข้อความเรื่องงวดทาง LINE ที่ไม่ผ่าน `dispatch.send`** (จึงไม่ผ่าน `ComplianceService.canSend`) —
 * A1 เตือนค่างวด · A2 แจ้งค้างชำระ (`NotificationReminderService`) · การ์ดลิงก์ชำระอัตโนมัติ A6 (`CollectionsNotifierService.sendAutoPaymentLinks`) ·
 * บอทการเงินเตือน/ทวง (`AutoTriggerService` — Task 34 ข้อ 3: เดิม A6 และบอทส่งให้ลูกค้าที่ไม่มีความยินยอม) ·
 * ทาง Flex ของ `NotificationDispatchService.sendFromTemplate` สำหรับแม่แบบขั้นทวง `dunning.*` ทั้งที่ระบบส่งเอง (A4) และพนักงานกดส่ง
 * (`send-from-template` / `bulk` — ข้อยกเว้นส่งด้วยมือมีแค่ช่วงผ่อนผัน ไม่ใช่ PDPA · Task 34 รอบเก็บ) ·
 * **แจ้งล็อก `mdm.lock_notice` ไม่ผ่านด่านนี้โดยตั้งใจ** (คำสั่งเจ้าของ: ห้ามเปลี่ยนเรื่อง MDM)
 *
 * มีความยินยอม (นิยามเดียว `hasActivePdpaConsent` — ตัวเดียวกับ `canSend`) = `true` · ไม่มี = ลงแถว `notification_logs` IN_APP `SKIPPED`
 * (ผูก `relatedId` = id งวด · หัวข้อของผู้ส่ง) ให้ตรวจย้อนได้ แล้วคืน `false` — ผู้เรียกไม่ส่งทั้ง LINE และ SMS
 * · แถว SKIPPED ไม่ถูกนับเป็น "ส่งแล้ว" ในการกันซ้ำ (`payment-notice-dedupe.ts`)
 */
export async function ensurePdpaConsentOrLogSkip(
  prisma: Pick<PrismaService, 'pDPAConsent' | 'notificationLog'>,
  input: { customerId: string; relatedId: string; subject: string },
): Promise<boolean> {
  if (await hasActivePdpaConsent(prisma, input.customerId)) return true;
  await prisma.notificationLog.create({
    data: {
      channel: 'IN_APP',
      recipient: input.customerId,
      subject: input.subject,
      message: NO_PDPA_CONSENT_SKIP_MESSAGE,
      status: 'SKIPPED',
      relatedId: input.relatedId,
    },
  });
  return false;
}
