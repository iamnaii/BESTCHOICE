import * as crypto from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';

/** ลิงก์สาธารณะของใบเสร็จขายสดมีอายุ 30 วัน — ต่ออายุทุกครั้งที่ออกเอกสาร/แชร์ (ไม่หมุน token). */
export const RECEIPT_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * token ลิงก์สาธารณะ `/r/:token` ของใบเสร็จขายสด (ก้อน 4 · 2026-10-23).
 *
 * แบบเดียวกับใบลดหนี้ (`credit-note-document.service.ts`): 256-bit random base64url,
 * TTL 30 วันเลื่อนไปข้างหน้าทุกครั้งที่มีคนออกเอกสาร — ลิงก์ที่เคยส่งให้ลูกค้าจึงไม่ตายกลางทาง
 * และ QR บนกระดาษที่พิมพ์ซ้ำยังชี้ลิงก์เดิม.
 */
@Injectable()
export class SaleReceiptTokenService {
  private readonly baseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    // แหล่งเดียวกับใบลดหนี้/ลิงก์ชำระ — ไม่เพิ่ม env ใหม่สำหรับลิงก์เอกสารลูกค้า
    const raw =
      this.config.get<string>('PAYMENT_LINK_BASE_URL') ||
      this.config.get<string>('FRONTEND_URL') ||
      'http://localhost:5173';
    this.baseUrl = raw.replace(/\/+$/, '');
  }

  /** ออก token ถ้ายังไม่มี และเลื่อนวันหมดอายุเป็น now + 30 วันเสมอ. */
  async ensureToken(saleId: string): Promise<{ token: string; expiresAt: Date }> {
    const sale = await this.prisma.sale.findFirst({
      where: { id: saleId, deletedAt: null },
      select: { id: true, receiptToken: true, receiptTokenExpiresAt: true },
    });
    if (!sale) throw new NotFoundException('ไม่พบใบขาย');

    const expiresAt = new Date(Date.now() + RECEIPT_TOKEN_TTL_MS);
    const token = sale.receiptToken ?? crypto.randomBytes(32).toString('base64url');
    await this.prisma.sale.update({
      where: { id: sale.id },
      data: {
        ...(sale.receiptToken ? {} : { receiptToken: token }),
        receiptTokenExpiresAt: expiresAt,
      },
    });
    return { token, expiresAt };
  }

  /** ใบขายที่ถือ token นี้และลิงก์ยังไม่หมดอายุ — ใบยกเลิก/ไม่พบ/หมดอายุ = null (ผู้เรียกตอบ 404 เดียวกัน). */
  async findSaleIdByToken(token: string): Promise<string | null> {
    const sale = await this.prisma.sale.findFirst({
      where: { receiptToken: token, deletedAt: null },
      select: { id: true, receiptTokenExpiresAt: true },
    });
    if (!sale?.receiptTokenExpiresAt) return null;
    if (sale.receiptTokenExpiresAt.getTime() <= Date.now()) return null;
    return sale.id;
  }

  publicUrl(token: string): string {
    return `${this.baseUrl}/r/${token}`;
  }
}
