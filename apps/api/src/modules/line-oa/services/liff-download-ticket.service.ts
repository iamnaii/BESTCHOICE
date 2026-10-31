import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/** เอกสารที่หน้า LIFF การเงินเปิดด้วยลิงก์ธรรมดา (`<a href>` แท็บใหม่ — แนบ header `X-Liff-Id-Token` ไม่ได้) */
export const LIFF_DOWNLOAD_KINDS = ['contract-document', 'receipt'] as const;
export type LiffDownloadKind = (typeof LIFF_DOWNLOAD_KINDS)[number];

/** อายุตั๋ว — หน้าเว็บขอตั๋วแล้วเปิดลิงก์ทันที (ไม่กี่ร้อยมิลลิวินาที) */
export const LIFF_DOWNLOAD_TICKET_TTL_MS = 60_000;

/** คีย์แถวตั๋วในตาราง chatbot_otp_requests (LINE user id จริงขึ้นต้น `U` — ชนกันไม่ได้) */
export const LIFF_DOWNLOAD_TICKET_KEY_PREFIX = 'liff-dl:';

const keyOf = (ticket: string) =>
  `${LIFF_DOWNLOAD_TICKET_KEY_PREFIX}${createHash('sha256').update(ticket).digest('hex')}`;
const bindingOf = (lineUserId: string, kind: LiffDownloadKind, resourceId: string) =>
  `${kind}|${resourceId}|${lineUserId}`;

/**
 * Task 22 M-3 — ตั๋วดาวน์โหลดครั้งเดียวของหน้า LIFF แทน `?idToken=` ใน URL (id_token ใช้ยืนยันตัวตนกับ LINE ได้จนหมดอายุ
 * และไปอยู่ใน access log ของ Cloud Run/Firebase).
 *
 * - ออกตั๋ว: `POST line-oa/liff/download-ticket` (LiffTokenGuard ผ่าน header) → สุ่ม 256 บิต (base64url) ·
 *   **เก็บเฉพาะ sha256** ของตั๋ว · ผูกกับ (LINE user, ชนิดเอกสาร, id เอกสาร) · อายุ 60 วิ
 * - ใช้ตั๋ว: `GET …?dl=<ตั๋ว>` → ลบแถว (ผู้ลบได้คนเดียว = ใช้ครั้งเดียว แม้ยิงพร้อมกัน) แล้วเทียบอายุ + ชนิด + id เอกสาร
 *   ไม่ตรงข้อใด = null (ตั๋วถูกเผาไปแล้ว — เดาซ้ำไม่ได้) · ผู้เรียกตรวจความเป็นเจ้าของซ้ำด้วย LINE ที่ผูกกับตั๋ว
 *
 * ที่เก็บ: ตาราง `chatbot_otp_requests` เดิม (คีย์ `line_user_id` = `liff-dl:<sha256>` แบบเดียวกับแถวนับเพดาน OTP `otp-quota:` ·
 * `hash` = `<ชนิด>|<id เอกสาร>|<LINE user>` · `expires_at` = อายุตั๋ว) — ไม่ต้อง migration · cron `cleanupExpiredOtps`
 * (ทุก 10 นาที) ลบแถวที่หมดอายุแล้วให้เอง · ใช้ร่วมได้หลาย instance ของ Cloud Run (cache ในหน่วยความจำ/`CACHE_MANAGER`
 * ที่ไม่มี Redis บน prod ใช้ข้าม instance ไม่ได้)
 */
@Injectable()
export class LiffDownloadTicketService {
  constructor(private readonly prisma: PrismaService) {}

  async issue(lineUserId: string, kind: LiffDownloadKind, resourceId: string): Promise<string> {
    const ticket = randomBytes(32).toString('base64url');
    const now = new Date();
    await this.prisma.chatbotOtpRequest.create({
      data: {
        lineUserId: keyOf(ticket),
        customerId: '',
        phone: '',
        hash: bindingOf(lineUserId, kind, resourceId),
        expiresAt: new Date(now.getTime() + LIFF_DOWNLOAD_TICKET_TTL_MS),
        lastRequestAt: now,
      },
    });
    return ticket;
  }

  /** ใช้ตั๋ว (ครั้งเดียว) — คืน LINE user ที่ผูกกับตั๋ว หรือ null เมื่อไม่มี/ถูกใช้แล้ว/หมดอายุ/ไม่ใช่เอกสารนี้ */
  async consume(
    ticket: string | undefined,
    kind: LiffDownloadKind,
    resourceId: string,
  ): Promise<string | null> {
    if (typeof ticket !== 'string' || ticket.length === 0 || ticket.length > 128) return null;
    const row = await this.prisma.chatbotOtpRequest.findUnique({
      where: { lineUserId: keyOf(ticket) },
      select: { id: true, hash: true, expiresAt: true },
    });
    if (!row) return null;
    const { count } = await this.prisma.chatbotOtpRequest.deleteMany({ where: { id: row.id } });
    if (count !== 1) return null; // อีกคำขอใช้ไปก่อนแล้ว
    if (row.expiresAt.getTime() <= Date.now()) return null;
    const prefix = `${kind}|${resourceId}|`;
    if (!row.hash.startsWith(prefix)) return null;
    const lineUserId = row.hash.slice(prefix.length);
    return lineUserId || null;
  }
}
