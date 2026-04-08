/**
 * Reminder templates สำหรับ auto-trigger service
 * Source: docs/reports/KNOWLEDGE-BASE-FINANCE-BOT.md section 2
 */

const BANK_BLOCK = `▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n🏦 ธนาคารกสิกรไทย\n🔢 เลขที่: 203-1-16520-5\n👤 บจก. เบสท์ช้อยส์โฟน\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬`;

const SUFFIX = `📞 สอบถาม: 063-134-6356`;

export interface ReminderPayload {
  customerName: string;
  amount: number;
  dueDate: string; // formatted Thai
  installmentNumber: number;
  daysOverdue?: number;
  fineAmount?: number;
  totalAmount?: number;
}

const fmt = (n: number): string => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const TEMPLATES = {
  T_MINUS_5: (p: ReminderPayload): string =>
    `สวัสดีค่ะ ☺️\n` +
    `🔔 แจ้งเตือน: อีก 5 วัน ครบกำหนดชำระ\n\n` +
    `📅 ครบกำหนด: ${p.dueDate}\n` +
    `💰 ยอดชำระ: ${fmt(p.amount)} บาท\n\n` +
    `${BANK_BLOCK}\n\n` +
    `✅ โอนแล้วฝากสลิปไว้ในไลน์นี้ได้เลยค่ะ 😊\n\n` +
    `${SUFFIX}`,

  T_MINUS_3: (p: ReminderPayload): string =>
    `😊 อีก 3 วัน ครบกำหนดนะคะ\n\n` +
    `📅 ครบกำหนด: ${p.dueDate}\n` +
    `💰 ยอดชำระ: ${fmt(p.amount)} บาท\n\n` +
    `${BANK_BLOCK}\n\n` +
    `📝 โอนเสร็จแล้ว ฝากแปะสลิปในนี้ได้เลยนะคะ`,

  T_MINUS_1: (p: ReminderPayload): string =>
    `🚀 พรุ่งนี้ครบกำหนดแล้วค่ะ\n\n` +
    `📅 ครบกำหนด: ${p.dueDate}\n` +
    `💰 ยอดชำระ: ${fmt(p.amount)} บาท\n\n` +
    `📌 ชำระล่วงหน้าได้เลย เพื่อการใช้งานที่ต่อเนื่อง 100%\n\n` +
    `${BANK_BLOCK}`,

  T_DAY: (p: ReminderPayload): string =>
    `🔔 แจ้งเตือนวันครบกำหนดชำระค่ะ\n\n` +
    `📅 กำหนดชำระ: วันนี้ (${p.dueDate})\n` +
    `💰 ยอดที่ต้องชำระ: ${fmt(p.amount)} บาท\n\n` +
    `✅ รบกวนโอนชำระภายในวันนี้\n` +
    `พร้อมแจ้งสลิปในไลน์นี้ทันทีหลังโอน\n\n` +
    `⚠️ หากชำระเกินกำหนด จะมีค่าปรับวันละ 50 บาท\n\n` +
    `${BANK_BLOCK}`,

  T_PLUS_1: (p: ReminderPayload): string =>
    `⚠️ แจ้งเตือน: ค่างวดเลยกำหนดชำระแล้ว 1 วัน\nระบบยังไม่ได้รับยอดค่ะ\n\n` +
    `📅 กำหนดชำระ: ${p.dueDate}\n` +
    `💰 ยอดงวด + ค่าปรับ (${fmt(p.fineAmount ?? 50)})\n` +
    `   = ยอดรวม: ${fmt(p.totalAmount ?? p.amount + 50)} บาท\n\n` +
    `${BANK_BLOCK}\n\n` +
    `✅ โอนแล้วฝากสลิปไว้ได้เลยค่ะ`,

  T_PLUS_3: (p: ReminderPayload): string =>
    `⚠️ ค่างวดเลยกำหนดชำระแล้ว 3 วันค่ะ\n\n` +
    `📅 กำหนดชำระ: ${p.dueDate}\n` +
    `💰 ยอดงวด + ค่าปรับ ${fmt(p.fineAmount ?? 150)} บาท\n` +
    `   = ยอดรวม: ${fmt(p.totalAmount ?? p.amount + 150)} บาท\n\n` +
    `📌 หากยังต้องการใช้งานต่อ กรุณาชำระและแจ้งสลิปก่อน 16:00 น.\n\n` +
    `${BANK_BLOCK}\n\n` +
    `${SUFFIX}`,
};
