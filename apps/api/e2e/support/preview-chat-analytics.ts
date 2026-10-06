import { Controller, Post, Param, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RoomManagerService } from '../../src/modules/chat-engine/services/room-manager.service';
import { generateContractNumber, generateSaleNumber } from '../../src/utils/sequence.util';
/** Synthetic source documents + real response-cycle writers, only on the disposable preview DB. */
export function previewChatAnalytics(
  db: PrismaService,
  manager: RoomManagerService,
  actorId: () => string,
  receiverId: string,
) {
  if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.'))
    throw new Error('Analytics fixture requires isolated PostgreSQL');
  const fixtures = new Map<string, { customerId: string; aliasId: string; branchId: string }>();
  @Controller('preview/analytics')
  class PreviewAnalyticsController {
    @Post('fixture') async fixture() {
      const customer = await db.customer.create({ data: { name: 'ลูกค้ารายงานจำลอง' } });
      const alias = await db.customer.create({
        data: { name: 'ผู้สนใจจำลองที่รวมแล้ว', mergedIntoId: customer.id, deletedAt: new Date() },
      });
      const branch = await db.branch.findFirstOrThrow({ where: { name: 'LOCAL PREVIEW BRANCH' } });
      const room = await db.chatRoom.create({
        data: {
          customerId: customer.id,
          displayName: 'ทดสอบรายงานคนและบอท',
          channel: 'FACEBOOK',
          assignedToId: actorId(),
        },
      });
      const sibling = await db.chatRoom.create({
        data: {
          customerId: alias.id,
          displayName: 'ตัวตนเดิมที่รวมแล้ว',
          channel: 'FACEBOOK',
          assignedToId: actorId(),
        },
      });
      await manager.saveMessage({
        roomId: sibling.id,
        role: 'CUSTOMER',
        text: 'ข้อความจำลองก่อนรวมตัวตน',
      });
      await manager.saveMessage({ roomId: room.id, role: 'CUSTOMER', text: 'สนใจสินค้าทดลอง' });
      fixtures.set(room.id, { customerId: customer.id, aliasId: alias.id, branchId: branch.id });
      return { roomId: room.id, customerId: customer.id, branchId: branch.id };
    }
    @Post(':id/bot') async bot(@Param('id') id: string) {
      if (!fixtures.has(id)) throw new NotFoundException();
      const message = await manager.saveMessage({ roomId: id, role: 'BOT', text: 'คำตอบบอทจำลอง' });
      await manager.prepareOutboundAttempt(message.id);
      await manager.markOutboundSent(message.id, `analytics-bot:${message.id}`);
      return { synthetic: true };
    }
    @Post(':id/sales') async sales(@Param('id') id: string) {
      const f = fixtures.get(id);
      if (!f) throw new NotFoundException();
      const result = await db.$transaction(async (tx) => {
        const product = await tx.product.create({
          data: {
            name: 'เครื่องรายงานจำลอง',
            brand: 'LOCAL',
            model: 'Analytics',
            category: 'PHONE_USED',
            branchId: f.branchId,
            costPrice: 1,
            status: 'SOLD_CASH',
          },
        });
        const contract = await tx.contract.create({
          data: {
            contractNumber: await generateContractNumber(tx),
            customerId: f.customerId,
            productId: product.id,
            branchId: f.branchId,
            salespersonId: receiverId,
            status: 'ACTIVE',
            planType: 'STORE_DIRECT',
            sellingPrice: '200.20',
            downPayment: 50,
            financedAmount: '150.20',
            interestRate: 0.02,
            interestTotal: 0,
            totalMonths: 10,
            monthlyPayment: '15.02',
            notes: 'LOCAL SYNTHETIC ANALYTICS SOURCE',
          },
        });
        const base = {
          productId: product.id,
          branchId: f.branchId,
          salespersonId: receiverId,
          notes: 'LOCAL SYNTHETIC ANALYTICS SOURCE',
        };
        const cash = await tx.sale.create({
          data: {
            ...base,
            saleNumber: await generateSaleNumber(tx),
            customerId: f.aliasId,
            saleType: 'CASH',
            sellingPrice: '100.10',
            netAmount: '100.10',
          },
        });
        const installment = await tx.sale.create({
          data: {
            ...base,
            saleNumber: await generateSaleNumber(tx),
            customerId: f.customerId,
            saleType: 'INSTALLMENT',
            contractId: contract.id,
            sellingPrice: '200.20',
            netAmount: '200.20',
          },
        });
        await tx.chatRoom.update({ where: { id }, data: { assignedToId: receiverId } });
        return { saleIds: [cash.id, installment.id], salespersonId: receiverId };
      });
      fixtures.delete(id);
      return { ...result, synthetic: true };
    }
  }
  return PreviewAnalyticsController;
}
