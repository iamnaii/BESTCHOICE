import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RoomManagerService } from '../../chat-engine/services/room-manager.service';
import { MessageRole } from '@prisma/client';

/**
 * ChatCommerceService — payment links & product cards in staff chat.
 *
 * Enables staff to:
 * - Generate PaySolutions payment links and send to customer in chat
 * - Search in-stock products for sharing
 * - Send product info cards as chat messages
 */
@Injectable()
export class ChatCommerceService {
  private readonly logger = new Logger(ChatCommerceService.name);

  constructor(
    private prisma: PrismaService,
    private roomManager: RoomManagerService,
  ) {}

  /**
   * Generate a payment link and send it to the customer in chat.
   * Uses PaySolutionsService.createPaymentIntent() under the hood.
   */
  async createPaymentLinkInChat(params: {
    sessionId: string;
    staffId: string;
    contractId: string;
    installmentNo?: number;
  }): Promise<{ contractId: string; contractNumber: string; installmentNo: number; amount: number; paymentId: string }> {
    // 1. Find session to get customer lineUserId
    const session = await this.prisma.chatRoom.findUnique({
      where: { id: params.sessionId },
      select: {
        id: true,
        lineUserId: true,
        customerId: true,
        customer: { select: { id: true, name: true, lineId: true } },
      },
    });

    if (!session) {
      throw new NotFoundException('ไม่พบห้องแชท');
    }

    if (!session.customerId || !session.customer) {
      throw new BadRequestException('ห้องแชทนี้ยังไม่ได้เชื่อมกับลูกค้า');
    }

    const customerLineId = session.customer.lineId || session.lineUserId;
    if (!customerLineId) {
      throw new BadRequestException('ลูกค้าไม่มี LINE ID ไม่สามารถสร้างลิงก์ชำระเงินได้');
    }

    // 2. Find the contract and payment record
    const contract = await this.prisma.contract.findUnique({
      where: { id: params.contractId },
      include: {
        customer: { select: { id: true, lineId: true } },
        payments: {
          where: { deletedAt: null },
          orderBy: { installmentNo: 'asc' },
        },
      },
    });

    if (!contract || contract.deletedAt) {
      throw new NotFoundException('ไม่พบสัญญาที่ระบุ');
    }

    // Verify the contract belongs to the same customer in this chat session
    if (contract.customerId !== session.customerId) {
      throw new BadRequestException('สัญญานี้ไม่ตรงกับลูกค้าในเซสชันแชท');
    }

    // 3. Determine which installment to pay
    let targetPayment: (typeof contract.payments)[number] | undefined;

    if (params.installmentNo) {
      targetPayment = contract.payments.find(
        (p) => p.installmentNo === params.installmentNo,
      );
      if (!targetPayment) {
        throw new NotFoundException(`ไม่พบงวดที่ ${params.installmentNo}`);
      }
      if (targetPayment.status === 'PAID') {
        throw new BadRequestException(`งวดที่ ${params.installmentNo} ชำระเรียบร้อยแล้ว`);
      }
    } else {
      // Find next unpaid installment
      targetPayment = contract.payments.find((p) => p.status !== 'PAID');
      if (!targetPayment) {
        throw new BadRequestException('ไม่มีงวดที่ค้างชำระ');
      }
    }

    // Calculate outstanding amount for this installment
    const amount =
      Number(targetPayment.amountDue) +
      Number(targetPayment.lateFee) -
      Number(targetPayment.amountPaid);

    if (amount <= 0) {
      throw new BadRequestException('ยอดค้างชำระเป็น 0 บาท');
    }

    // 4. Save staff message with payment info
    const messageText = [
      `💳 ข้อมูลชำระเงิน`,
      `สัญญา: ${contract.contractNumber}`,
      `งวดที่: ${targetPayment.installmentNo}/${contract.payments.length}`,
      `ยอดชำระ: ${amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท`,
      ``,
      `กรุณาชำระผ่านระบบ หรือติดต่อเจ้าหน้าที่ค่ะ`,
    ].join('\n');

    await this.roomManager.saveMessage({
      roomId: params.sessionId,
      role: MessageRole.STAFF,
      text: messageText,
      staffId: params.staffId,
    });

    this.logger.log(
      `Payment info sent in chat: session=${params.sessionId}, contract=${contract.contractNumber}, installment=${targetPayment.installmentNo}`,
    );

    return {
      contractId: params.contractId,
      contractNumber: contract.contractNumber,
      installmentNo: targetPayment.installmentNo,
      amount,
      paymentId: targetPayment.id,
    };
  }

  /**
   * Search in-stock products for sharing in chat.
   * Searches by name, brand, or model.
   */
  async searchProducts(query: string, limit = 10) {
    if (!query || query.trim().length < 2) {
      return [];
    }

    const searchTerm = query.trim();

    const products = await this.prisma.product.findMany({
      where: {
        deletedAt: null,
        status: 'IN_STOCK',
        OR: [
          { name: { contains: searchTerm, mode: 'insensitive' } },
          { brand: { contains: searchTerm, mode: 'insensitive' } },
          { model: { contains: searchTerm, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        name: true,
        brand: true,
        model: true,
        color: true,
        storage: true,
        status: true,
        photos: true,
        prices: {
          where: { deletedAt: null },
          orderBy: { isDefault: 'desc' },
          take: 1,
          select: { amount: true, label: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: Math.min(limit, 20),
    });

    return products.map((p) => ({
      id: p.id,
      name: p.name,
      brand: p.brand,
      model: p.model,
      color: p.color,
      storage: p.storage,
      status: p.status,
      photoUrl: p.photos.length > 0 ? p.photos[0] : null,
      price: p.prices.length > 0 ? Number(p.prices[0].amount) : null,
      priceLabel: p.prices.length > 0 ? p.prices[0].label : null,
    }));
  }

  /**
   * Send a product info card as a text message in chat.
   */
  async sendProductCard(params: {
    sessionId: string;
    staffId: string;
    productId: string;
  }): Promise<void> {
    // 1. Find product with prices
    const product = await this.prisma.product.findUnique({
      where: { id: params.productId },
      include: {
        prices: {
          where: { deletedAt: null },
          orderBy: { isDefault: 'desc' },
        },
      },
    });

    if (!product || product.deletedAt) {
      throw new NotFoundException('ไม่พบสินค้าที่ระบุ');
    }

    // 2. Build product info text
    const nameParts = [product.brand, product.model, product.color, product.storage]
      .filter(Boolean)
      .join(' ');

    const defaultPrice = product.prices.find((p) => p.isDefault) || product.prices[0];
    const priceText = defaultPrice
      ? `${Number(defaultPrice.amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท`
      : 'สอบถามราคา';

    const statusMap: Record<string, string> = {
      IN_STOCK: 'มีสินค้า',
      RESERVED: 'จองแล้ว',
      SOLD_CASH: 'ขายแล้ว',
      SOLD_INSTALLMENT: 'ขายผ่อนแล้ว',
    };

    const statusText = statusMap[product.status] || product.status;

    const messageText = [
      `📱 ${nameParts}`,
      `💰 ราคา: ${priceText}`,
      `สถานะ: ${statusText}`,
      `ผ่อนได้สูงสุด 12 งวด`,
    ].join('\n');

    // 3. Save as staff message
    await this.roomManager.saveMessage({
      roomId: params.sessionId,
      role: MessageRole.STAFF,
      text: messageText,
      staffId: params.staffId,
    });

    this.logger.log(
      `Product card sent in chat: session=${params.sessionId}, product=${product.id} (${nameParts})`,
    );
  }
}
