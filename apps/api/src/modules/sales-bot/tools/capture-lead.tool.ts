import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import generatePayload from 'promptpay-qr';
import * as QRCode from 'qrcode';
import {
  IChatGateway,
  CHAT_GATEWAY_TOKEN,
} from '../../chat-engine/interfaces/chat-gateway.interface';

export const CAPTURE_LEAD_TOOL = {
  name: 'capture_lead',
  description:
    'Call after customer confirms purchase (says "เอา/โอเค/สนใจ"). Captures lead, creates Customer draft, initiates handoff to staff for KYC verification + PromptPay QR delivery. ' +
    'Works for BOTH in-stock sales (pass productId + packageChoice from search_products/calculate_installment) ' +
    'AND order-taking of out-of-stock models (omit productId/packageChoice, pass productNote instead — never invent a productId).',
  input_schema: {
    type: 'object',
    properties: {
      customerName: { type: 'string', description: 'ชื่อลูกค้า (ขออย่างน้อย firstname)' },
      phone: { type: 'string', description: 'เบอร์โทร 10 หลัก' },
      address: {
        type: 'string',
        description:
          'ที่อยู่ — ห้ามถามลูกค้าเด็ดขาด (ร้านไม่มีบริการจัดส่ง ลูกค้ารับเครื่องที่ร้าน) ใส่เฉพาะเมื่อลูกค้าพิมพ์มาเอง',
      },
      visitPlan: {
        type: 'string',
        description: 'แผนเข้ามาที่ร้าน/ช่วงที่วางแผนซื้อ ตามคำลูกค้า เช่น "เสาร์นี้บ่าย" "สิ้นเดือน"',
      },
      productId: {
        type: 'string',
        description: 'productId จาก search_products — เฉพาะของที่มีในสต็อก (ห้ามแต่งเอง)',
      },
      packageChoice: {
        type: 'string',
        enum: ['A', 'B', 'C'],
        description: 'แพ็คผ่อนที่ลูกค้าเลือก (A=ดาวน์เบา, B=กลาง, C=หนัก) — เฉพาะของในสต็อก',
      },
      productNote: {
        type: 'string',
        description:
          'กรณีรับออเดอร์ (ของไม่มีในสต็อก ไม่มี productId): รุ่น+ความจุ+มือ 1/มือสอง+เรทที่เลือก เช่น "iPhone 15 Plus 128GB มือสอง สั่งเข้า เรทร้าน"',
      },
      downAmount: { type: 'number', description: 'ยอดดาวน์ที่จะส่ง QR (จากแพ็คหรือเรทที่ลูกค้าเลือก)' },
    },
    required: ['customerName', 'phone', 'downAmount'],
  },
};

export interface CaptureLeadInput {
  customerName: string;
  phone: string;
  address?: string;
  visitPlan?: string;
  productId?: string;
  packageChoice?: 'A' | 'B' | 'C';
  productNote?: string;
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

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(CHAT_GATEWAY_TOKEN)
    private readonly gateway?: IChatGateway,
  ) {}

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
        key: { in: ['shop_bot_central_branch_id', 'shop_bot_promptpay_id'] },
        deletedAt: null,
      },
    });
    const configMap = new Map(configs.map((c) => [c.key, c.value]));
    const branchId = configMap.get('shop_bot_central_branch_id');
    const promptpayId = configMap.get('shop_bot_promptpay_id');

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
            productId: input.productId ?? null,
            packageChoice: input.packageChoice ?? null,
            productNote: input.productNote ?? null,
            downAmount: input.downAmount,
            address: input.address ?? null,
            visitPlan: input.visitPlan ?? null,
          },
        },
      });

      return cId;
    });

    // Real-time refresh so the "ต้องตอบ" badge + "รอตอบ" filter chip
    // light up in UnifiedInboxPage's ConversationList immediately.
    this.gateway?.emitRoomUpdate(input.roomId, {
      roomId: input.roomId,
      handoffMode: true,
      customerId,
    });

    // Generate PromptPay QR if configured; fall back to lead-only otherwise
    let promptPayQr: string | null = null;
    // ประโยคท้าย = privacy notice ตาม พ.ร.บ.คุ้มครองข้อมูลฯ (ใช้ข้อมูลเพื่อคำสั่งซื้อนี้เท่านั้น)
    const pdpaNote = 'ข้อมูลชื่อ-เบอร์จะใช้ติดต่อเรื่องคำสั่งซื้อนี้เท่านั้นนะคะ';
    let handoffMessage = `ทางแอดมินจะส่ง QR ดาวน์ ${input.downAmount.toLocaleString()} บาท ให้พี่ในแชทนี้นะคะ 🙏 ${pdpaNote}`;

    if (promptpayId) {
      try {
        const payload = generatePayload(promptpayId, { amount: input.downAmount });
        promptPayQr = await QRCode.toDataURL(payload);
        handoffMessage = `ส่ง QR ดาวน์ ${input.downAmount.toLocaleString()} บาท แล้วนะคะ พอโอนเสร็จแอดมินจะติดต่อกลับเพื่อยืนยันสัญญาค่ะ 🙏 ${pdpaNote}`;
      } catch (err) {
        this.logger.error(
          `PromptPay QR generation failed for room ${input.roomId}: ${err instanceof Error ? err.message : err}`,
        );
        // Fall through to lead-only mode
      }
    }

    return {
      customerId,
      promptPayQr,
      downAmount: input.downAmount,
      handoffMessage,
    };
  }
}
