import { CustomerQueryService } from '../customer-query.service';
import { CustomerPurchaseSummaryService } from '../customer-purchase-summary.service';
import { CustomerChatRoomsService } from '../customer-chat-rooms.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { CustomerTierService } from '../../customer-tier.service';

/**
 * mock ของโมเดลที่ "การเพิ่มข้อมูลต่อหน้า" ของ findAll ใช้
 * (sale/contract/payment/chatRoom) — ขาดตัวใดตัวหนึ่ง findAll พังทันที
 * ตั้งใจให้พังดัง ไม่ใช่คืนค่าว่างเงียบ ๆ
 */
export function enrichmentMocks() {
  return {
    sale: { groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn().mockResolvedValue([]) },
    contract: { groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn().mockResolvedValue([]) },
    payment: { groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn().mockResolvedValue([]) },
    chatRoom: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

export function buildQueryService(db: unknown, tier: unknown): CustomerQueryService {
  return new CustomerQueryService(
    db as unknown as PrismaService,
    tier as unknown as CustomerTierService,
    new CustomerPurchaseSummaryService(db as unknown as PrismaService),
    new CustomerChatRoomsService(db as unknown as PrismaService),
  );
}
