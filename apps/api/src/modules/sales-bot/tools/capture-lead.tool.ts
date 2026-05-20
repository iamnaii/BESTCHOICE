import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export const CAPTURE_LEAD_TOOL = {
  name: 'capture_lead',
  description:
    'Call after customer confirms purchase (says "เอา/โอเค/สนใจ"). Captures lead, creates Customer draft, initiates handoff to staff for KYC verification + PromptPay QR delivery.',
  input_schema: {
    type: 'object',
    properties: {
      customerName: { type: 'string', description: 'ชื่อลูกค้า (ขออย่างน้อย firstname)' },
      phone: { type: 'string', description: 'เบอร์โทร 10 หลัก' },
      address: { type: 'string', description: 'ที่อยู่จัดส่ง (ตัวเลือก ถ้ามี)' },
      productId: { type: 'string', description: 'productId จาก search_products' },
      packageChoice: {
        type: 'string',
        enum: ['A', 'B', 'C'],
        description: 'แพ็คผ่อนที่ลูกค้าเลือก (A=ดาวน์เบา, B=กลาง, C=หนัก)',
      },
      downAmount: { type: 'number', description: 'ยอดดาวน์ที่จะส่ง QR' },
    },
    required: ['customerName', 'phone', 'productId', 'packageChoice', 'downAmount'],
  },
};

export interface CaptureLeadInput {
  customerName: string;
  phone: string;
  address?: string;
  productId: string;
  packageChoice: 'A' | 'B' | 'C';
  downAmount: number;
  roomId: string;
}

export interface CaptureLeadResult {
  customerId: string;
  promptPayQr: string | null;
  downAmount: number;
  handoffMessage: string;
}

@Injectable()
export class CaptureLeadTool {
  private readonly logger = new Logger(CaptureLeadTool.name);

  constructor(private readonly prisma: PrismaService) {}

  async run(input: CaptureLeadInput): Promise<CaptureLeadResult> {
    const room = await this.prisma.chatRoom.findUnique({
      where: { id: input.roomId },
      select: { id: true, lineUserId: true, customerId: true },
    });
    if (!room) {
      throw new Error(`Room not found: ${input.roomId}`);
    }

    // System user required for AuditLog.userId (AI-driven action has no human staff).
    // Same pattern as cron jobs: e.g. installment-accrual.cron.ts:145
    const systemUser = await this.prisma.user.findFirst({
      where: { isSystemUser: true },
      select: { id: true },
    });
    if (!systemUser) {
      throw new Error('System user (isSystemUser=true) not found — required for AI audit logs');
    }

    const configs = await this.prisma.systemConfig.findMany({
      where: {
        key: { in: ['shop_bot_central_branch_id'] },
        deletedAt: null,
      },
    });
    const configMap = new Map(configs.map((c) => [c.key, c.value]));
    const branchId = configMap.get('shop_bot_central_branch_id');

    // Validate central branch is configured — it's required downstream when
    // SALES converts this lead into a Contract (Contract.branchId is NOT NULL).
    // Customer model itself has no branchId, so we don't store it on Customer —
    // we just fail-fast here so leads aren't captured into a system that can't
    // convert them.
    if (!branchId) {
      throw new Error('shop_bot_central_branch_id not configured');
    }

    const customerId = await this.prisma.$transaction(async (tx) => {
      let cId: string;

      // Branch 1: room already bound to a customer (SALES-linked OR prior capture)
      // → update that customer, never overwrite room.customerId
      if (room.customerId) {
        await tx.customer.update({
          where: { id: room.customerId },
          data: {
            name: input.customerName,
            acquisitionSource: 'AI_CHAT_RETURN',
          },
        });
        cId = room.customerId;
      } else if (room.lineUserId) {
        // Branch 2: LINE channel with lineUserId set — composite match safe
        const existing = await tx.customer.findFirst({
          where: {
            phone: input.phone,
            lineIdShop: room.lineUserId,
            deletedAt: null,
          },
        });
        if (existing) {
          await tx.customer.update({
            where: { id: existing.id },
            data: {
              name: input.customerName,
              acquisitionSource: 'AI_CHAT_RETURN',
            },
          });
          cId = existing.id;
        } else {
          const created = await tx.customer.create({
            data: {
              name: input.customerName,
              phone: input.phone,
              chatConsent: true,
              chatConsentAt: new Date(),
              lineIdShop: room.lineUserId,
              status: 'ACTIVE',
              acquisitionSource: 'AI_CHAT',
            },
          });
          cId = created.id;
        }
      } else {
        // Branch 3: FB/Web/TikTok (no lineUserId) → always create new.
        // Cannot composite-match safely (null=null in SQL would attribute to
        // wrong existing customer). SALES merges duplicates later.
        const created = await tx.customer.create({
          data: {
            name: input.customerName,
            phone: input.phone,
            chatConsent: true,
            chatConsentAt: new Date(),
            lineIdShop: room.lineUserId, // null for non-LINE channels — correct
            status: 'ACTIVE',
            acquisitionSource: 'AI_CHAT',
          },
        });
        cId = created.id;
      }

      await tx.chatRoom.update({
        where: { id: input.roomId },
        data: {
          customerId: cId,
          handoffMode: true,
          handoffReason: 'lead_captured',
          handoffTaggedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          userId: systemUser.id,
          action: 'AI_LEAD_CAPTURED',
          entity: 'customer',
          entityId: cId,
          newValue: {
            productId: input.productId,
            packageChoice: input.packageChoice,
            downAmount: input.downAmount,
            address: input.address ?? null,
          },
        },
      });

      return cId;
    });

    // Phase A: PromptPay QR generation deferred — SALES sends QR manually in chat.
    // To enable QR: install `promptpay-qr` lib + use shop_bot_promptpay_id config.
    const handoffMessage = `ทางแอดมินจะส่ง QR ดาวน์ ${input.downAmount.toLocaleString()} บาท ให้พี่ในแชทนี้นะคะ 🙏`;

    return {
      customerId,
      promptPayQr: null,
      downAmount: input.downAmount,
      handoffMessage,
    };
  }
}
