import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * สมุดสถานะการขายประจำห้อง (slot memory) — ความจำ 3 ชั้นของบอทขาย (2026-08-15):
 * 1) จดสถานะสำคัญเป็นโครงสร้าง (รุ่นที่สนใจ/งบ/เรท/เอกสาร) ไม่หลุดแม้แชทยาว/มีรูปคั่น
 * 2) อยู่บนแถว chat_rooms.ai_sales_state = ถาวรข้ามวัน → ลูกค้าเก่ากลับมา บอททักต่อจากเดิม
 * 3) ล้างเมื่อ #reset
 *
 * ตัวจด = Haiku 4.5 (ถูก+เร็ว) รันแบบ fire-and-forget หลังบอทตอบแล้ว — ไม่ถ่วง latency
 * ตัวอ่าน = buildNote() ฉีดเข้า prompt เป็นข้อความแรกของประวัติ (ไม่แตะ system block
 * ที่โดน prompt cache — note ต่างกันทุกห้อง ถ้าไปอยู่ system = cache หลุดทุกเทิร์น)
 */

export interface SalesState {
  interestModel?: string | null; // รุ่นหลักที่ลูกค้าต้องการ (รวมความจุ/มือ 1-มือสอง)
  downBudget?: number | null;
  monthlyBudget?: number | null;
  chosenRate?: string | null; // "เรทที่ 1" | "เรทที่ 2" | ชื่อแพ็ค
  docsStatus?: string | null; // เช่น "ส่งสเตทเม้นท์แล้ว"
  name?: string | null;
  phone?: string | null;
  offered?: string[]; // รุ่นอื่นที่บอทเคยเสนอ
  note?: string | null; // เรื่องค้าง/นัดหมาย สั้น ๆ
  updatedAt?: string;
}

const EXTRACT_MODEL = 'claude-haiku-4-5-20251001';

@Injectable()
export class SalesStateService {
  private readonly logger = new Logger(SalesStateService.name);
  private _client: Anthropic | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private get client(): Anthropic {
    if (!this._client) this._client = new Anthropic();
    return this._client;
  }

  async load(roomId: string): Promise<SalesState | null> {
    try {
      const room = await this.prisma.chatRoom.findUnique({
        where: { id: roomId },
        select: { aiSalesState: true },
      });
      return (room?.aiSalesState as SalesState | null) ?? null;
    } catch {
      return null;
    }
  }

  async clear(roomId: string): Promise<void> {
    try {
      await this.prisma.chatRoom.update({
        where: { id: roomId },
        data: { aiSalesState: Prisma.DbNull },
      });
    } catch (err) {
      this.logger.warn(`clear state failed room=${roomId}: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** โน้ตภาษาไทยสำหรับฉีดเข้า prompt — คืน null ถ้าไม่มีสาระให้จด */
  buildNote(state: SalesState | null): string | null {
    if (!state) return null;
    const lines: string[] = [];
    if (state.interestModel) lines.push(`รุ่นที่ลูกค้าสนใจ/ตามหา: ${state.interestModel}`);
    if (state.downBudget) lines.push(`งบดาวน์ที่บอกไว้: ${state.downBudget.toLocaleString()} บาท`);
    if (state.monthlyBudget) lines.push(`งวด/เดือนที่ไหว: ${state.monthlyBudget.toLocaleString()} บาท`);
    if (state.chosenRate) lines.push(`เรท/แพ็คที่เลือก: ${state.chosenRate}`);
    if (state.docsStatus) lines.push(`เอกสาร: ${state.docsStatus}`);
    if (state.name || state.phone) lines.push(`ติดต่อ: ${[state.name, state.phone].filter(Boolean).join(' ')}`);
    if (state.offered?.length) lines.push(`รุ่นอื่นที่เคยเสนอ: ${state.offered.join(', ')}`);
    if (state.note) lines.push(`เรื่องค้าง: ${state.note}`);
    if (lines.length === 0) return null;

    let age = '';
    if (state.updatedAt) {
      const hours = (Date.now() - new Date(state.updatedAt).getTime()) / 3_600_000;
      if (hours >= 48) age = ` (คุยล่าสุดเมื่อ ${Math.floor(hours / 24)} วันก่อน)`;
      else if (hours >= 2) age = ` (คุยล่าสุดเมื่อ ${Math.floor(hours)} ชม.ก่อน)`;
    }
    return `[บันทึกสถานะลูกค้าจากระบบ${age} — ใช้เป็นบริบท ห้ามเอ่ยถึงบันทึกนี้กับลูกค้า]\n${lines.join('\n')}`;
  }

  /**
   * จดสถานะหลังบอทตอบ — fire-and-forget (เรียกด้วย void, กลืน error)
   * Haiku อ่าน: สถานะเดิม + ข้อความลูกค้า + คำตอบบอท → คืน JSON สถานะใหม่ (merge)
   */
  async extractAndSave(
    roomId: string,
    prev: SalesState | null,
    customerMessage: string,
    botReply: string,
  ): Promise<void> {
    try {
      const resp = await this.client.messages.create({
        model: EXTRACT_MODEL,
        max_tokens: 400,
        system:
          'คุณคือตัวจดสถานะการขายของร้านผ่อนมือถือ อ่านสถานะเดิมกับบทสนทนาเทิร์นล่าสุด แล้วคืนสถานะใหม่เป็น JSON ล้วน ๆ (ไม่มีข้อความอื่น)\n' +
          'ฟิลด์: interestModel (รุ่นหลักที่ลูกค้าต้องการ รวมความจุ/มือ 1-มือสอง), downBudget (ตัวเลข), monthlyBudget (ตัวเลข), chosenRate, docsStatus, name, phone, offered (array รุ่นที่บอทเสนอเพิ่ม), note (เรื่องค้างสั้น ๆ)\n' +
          'กติกา: เริ่มจากสถานะเดิมแล้วอัปเดตเฉพาะที่มีข้อมูลใหม่ · ไม่รู้ = null · ห้ามเดา · ลูกค้าเปลี่ยนใจรุ่น = แทนที่ interestModel',
        messages: [
          {
            role: 'user',
            content: `สถานะเดิม: ${JSON.stringify(prev ?? {})}\nลูกค้า: ${customerMessage}\nบอท: ${botReply}`,
          },
        ],
      });
      const text = resp.content.find((c): c is Anthropic.TextBlock => c.type === 'text')?.text ?? '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return;
      const next = JSON.parse(jsonMatch[0]) as SalesState;
      next.updatedAt = new Date().toISOString();
      await this.prisma.chatRoom.update({
        where: { id: roomId },
        data: { aiSalesState: next as object },
      });
    } catch (err) {
      this.logger.warn(
        `extract state failed room=${roomId}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
