/**
 * D1.2.4.1 — สวิตช์รวมของระบบแม่แบบรายจ่าย (`templates_enabled`) — ใช้ร่วมกันโดย
 * `ExpenseTemplatesService` (create/update/delete/instantiate) และบิลประจำ (cron + การ์ด + หน้า)
 * สเปกบิลประจำ §13 ข้อ 4: สวิตช์เดียว. explicit 'false'/'0' เท่านั้นที่ปิด — ไม่มีแถว/อ่านพัง = เปิด.
 */
export const TEMPLATES_DISABLED_MESSAGE = 'ระบบรายการโปรดถูกปิดใช้งานชั่วคราว — กรุณาติดต่อผู้ดูแลระบบ';

type SystemConfigReader = {
  systemConfig: {
    findFirst(args: {
      where: { key: string; deletedAt: null };
      select: { value: true };
    }): Promise<{ value: string | null } | null>;
  };
};

export async function isTemplatesEnabled(prisma: SystemConfigReader): Promise<boolean> {
  try {
    const row = await prisma.systemConfig.findFirst({
      where: { key: 'templates_enabled', deletedAt: null },
      select: { value: true },
    });
    const raw = row?.value?.trim().toLowerCase();
    return !(raw === 'false' || raw === '0');
  } catch {
    return true; // DB read failure → fail-open (พฤติกรรมเดิม)
  }
}
