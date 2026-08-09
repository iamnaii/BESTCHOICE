import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { MessageRole, MessageType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { RoomManagerService } from '../../chat-engine/services/room-manager.service';
import { MessageRouterService } from '../../chat-engine/services/message-router.service';
import { ProductQuoteService } from './product-quote.service';
import { buildProductCardText } from './product-card-text.util';
import { shopBaseUrl } from '../../../utils/shop-base-url.util';
import { evaluateReadiness } from '../../../utils/product-readiness.util';

export type ProductCardPart = 'PHOTO' | 'TEXT';

/**
 * ลิงก์หน้าเว็บร้านจะใช้ได้ก็ต่อเมื่อสินค้าผ่าน readiness ของ B0 เท่านั้น —
 * `/products/:id` ของ web-shop กรองด้วย `productReadinessWhere({requireInStock:false})`
 * (B0 Task 11) ถ้าไม่ผ่านลูกค้าจะเจอ 404. ตัดเช็ก `inStock` ทิ้งเพราะเครื่อง
 * RESERVED/ขายแล้ว หน้าเว็บยังเปิดได้ (permalink)
 */
function buildShareUrl(p: Parameters<typeof evaluateReadiness>[0] & { id: string }): string | null {
  const base = shopBaseUrl();
  if (!base) return null;
  const { checks } = evaluateReadiness(p);
  const webReady = checks.every((c) => c.key === 'inStock' || c.ok);
  return webReady ? `${base}/api/shop/share/${p.id}` : null;
}

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
    private messageRouter: MessageRouterService,
    private productQuote: ProductQuoteService,
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
    // 1. Find session to get customer lineUserId. We pick the customer LINE ID
    //    matching the chat channel (LINE_FINANCE → lineIdFinance, LINE_SHOP → lineIdShop).
    const session = await this.prisma.chatRoom.findUnique({
      where: { id: params.sessionId },
      select: {
        id: true,
        lineUserId: true,
        channel: true,
        customerId: true,
        customer: {
          select: { id: true, name: true, lineIdFinance: true, lineIdShop: true },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('ไม่พบห้องแชท');
    }

    if (!session.customerId || !session.customer) {
      throw new BadRequestException('ห้องแชทนี้ยังไม่ได้เชื่อมกับลูกค้า');
    }

    // Resolve customer LINE ID per chat channel. Non-LINE channels (FACEBOOK,
    // TIKTOK, WEB) have no LINE ID by definition — we still allow the staff
    // payment-info message to be saved into the chat thread (the customer
    // sees it on their native channel), but we don't try to look up a LINE
    // user ID. The legacy ternary fell back to lineIdFinance for any
    // non-LINE_SHOP channel which was incorrect for FB/TikTok/Web.
    let customerLineIdForChannel: string | null = null;
    switch (session.channel) {
      case 'LINE_SHOP':
        customerLineIdForChannel = session.customer.lineIdShop;
        break;
      case 'LINE_FINANCE':
        customerLineIdForChannel = session.customer.lineIdFinance;
        break;
      case 'FACEBOOK':
      case 'TIKTOK':
      case 'WEB':
        // No LINE ID applicable — fall through to session.lineUserId
        // (which is also typically null for these channels)
        customerLineIdForChannel = null;
        break;
    }
    const customerLineId = customerLineIdForChannel || session.lineUserId;
    if (!customerLineId) {
      throw new BadRequestException('ลูกค้าไม่มี LINE ID ไม่สามารถสร้างลิงก์ชำระเงินได้');
    }

    // 2. Find the contract and payment record
    const contract = await this.prisma.contract.findUnique({
      where: { id: params.contractId },
      include: {
        customer: { select: { id: true, lineIdFinance: true, lineIdShop: true } },
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
   * ค้นสินค้าสำหรับ product picker ในกล่องแชท.
   * ห้าม select `photos` — เป็น base64 data URL (products-online-listing.service.ts:8)
   * ส่ง LINE/FB ไม่ได้และทำ payload บวมระดับ MB. รูปที่ส่งลูกค้าได้คือ gallery[] เท่านั้น
   */
  async searchProducts(query: string, limit = 10) {
    if (!query || query.trim().length < 2) {
      return [];
    }
    const searchTerm = query.trim();

    const products = await this.prisma.product.findMany({
      where: {
        deletedAt: null,
        status: { in: ['IN_STOCK', 'RESERVED'] },
        OR: [
          { name: { contains: searchTerm, mode: 'insensitive' } },
          { brand: { contains: searchTerm, mode: 'insensitive' } },
          { model: { contains: searchTerm, mode: 'insensitive' } },
          { imeiSerial: { contains: searchTerm, mode: 'insensitive' } },
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
        category: true,
        conditionGrade: true,
        batteryHealth: true,
        shopWarrantyDays: true,
        cashPrice: true,
        installmentPrice: true,
        gallery: true,
        // 2 ฟิลด์นี้ใช้เฉพาะตอนตัดสิน shareUrl (evaluateReadiness ของ B0)
        isOnlineVisible: true,
        deletedAt: true,
        branch: { select: { name: true } },
        prices: {
          where: { deletedAt: null },
          select: { label: true, amount: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: Math.min(limit, 20),
    });

    const quotes = await this.productQuote.getQuotes(
      products.map((p) => ({
        category: p.category,
        cashPrice: p.cashPrice,
        installmentPrice: p.installmentPrice,
        prices: p.prices,
      })),
    );

    return products.map((p, i) => ({
      id: p.id,
      name: p.name,
      brand: p.brand,
      model: p.model,
      color: p.color,
      storage: p.storage,
      status: p.status,
      category: p.category,
      conditionGrade: p.conditionGrade,
      batteryHealth: p.batteryHealth,
      branchName: p.branch?.name ?? null,
      photoUrl: p.gallery[0] ?? null,
      cashPrice: quotes[i].cashPrice,
      installmentPrice: quotes[i].installmentPrice,
      months: quotes[i].months,
      monthlyPayment: quotes[i].monthlyPayment,
      downAmount: quotes[i].downAmount,
      // null = ยังไม่พร้อมขึ้นเว็บ → การ์ดจะไม่มีบรรทัดลิงก์ (ห้ามส่งลิงก์ 404 ให้ลูกค้า)
      shareUrl: buildShareUrl(p),
    }));
  }

  /**
   * ข้อมูลการ์ดสินค้าชุดเดียวที่ทั้ง "แทรกสรุป" (ฝั่ง UI) และ "ส่งการ์ด"
   * (ฝั่ง server) ใช้ร่วมกัน — ข้อความจึงไม่มีทาง drift ระหว่าง 2 ทาง
   */
  async getProductSummary(productId: string): Promise<{
    productId: string;
    title: string;
    text: string;
    photoUrl: string | null;
    shareUrl: string | null;
  }> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: {
        id: true,
        name: true,
        brand: true,
        model: true,
        color: true,
        storage: true,
        status: true,
        category: true,
        conditionGrade: true,
        batteryHealth: true,
        shopWarrantyDays: true,
        cashPrice: true,
        installmentPrice: true,
        gallery: true,
        // ใช้ตัดสิน shareUrl (evaluateReadiness ของ B0)
        isOnlineVisible: true,
        deletedAt: true,
        branch: { select: { name: true } },
        prices: { where: { deletedAt: null }, select: { label: true, amount: true } },
      },
    });
    if (!product) {
      throw new NotFoundException('ไม่พบสินค้าที่ระบุ');
    }

    const [quote] = await this.productQuote.getQuotes([
      {
        category: product.category,
        cashPrice: product.cashPrice,
        installmentPrice: product.installmentPrice,
        prices: product.prices,
      },
    ]);
    // ชี้ share endpoint ของ API (B4) ที่เสิร์ฟ Open Graph แล้วเด้งต่อไปที่
    // /products/:id — แต่ใส่ได้เฉพาะเครื่องที่ผ่าน readiness ของ B0 ไม่งั้นลูกค้ากดแล้วเจอ 404
    const shareUrl = buildShareUrl(product);
    const facts = {
      name: product.name,
      brand: product.brand,
      model: product.model,
      color: product.color,
      storage: product.storage,
      category: product.category,
      status: product.status,
      conditionGrade: product.conditionGrade,
      batteryHealth: product.batteryHealth,
      shopWarrantyDays: product.shopWarrantyDays,
      branchName: product.branch?.name ?? null,
    };

    return {
      productId: product.id,
      title: [product.brand, product.model, product.storage, product.color]
        .filter(Boolean)
        .join(' ')
        .trim() || product.name,
      text: buildProductCardText(facts, quote, shareUrl),
      photoUrl: product.gallery[0] ?? null,
      shareUrl,
    };
  }

  /**
   * ส่งการ์ดสินค้าเป็น 2 bubble (รูป → ข้อความ) ผ่าน primitive เดียวกับ
   * ข้อความปกติ. token ของแต่ละ bubble คำนวณจาก clientMessageId ของผู้เรียก
   * แบบ deterministic (`-img` / `-txt`) → กด "ส่ง" ซ้ำหรือ retry ทั้ง request
   * ลูกค้าจะไม่ได้รับซ้ำ (unique [roomId, clientMessageId])
   */
  async sendProductCard(params: {
    sessionId: string;
    staffId: string;
    productId: string;
    clientMessageId: string;
    parts?: ProductCardPart[];
  }): Promise<{ sent: number; photoSkipped: boolean; errors: string[] }> {
    const summary = await this.getProductSummary(params.productId);
    const parts: ProductCardPart[] = params.parts?.length ? params.parts : ['PHOTO', 'TEXT'];
    const errors: string[] = [];
    let sent = 0;
    let photoSkipped = false;

    if (parts.includes('PHOTO')) {
      if (!summary.photoUrl) {
        photoSkipped = true;
      } else {
        // gallery[] เป็น public URL อยู่แล้ว (products-online-listing.service.ts:90
        // `storage.getPublicUrl(key)`) จึงไม่ต้อง deliveryMediaUrl และ signMessageMedia
        // ปล่อยผ่านเพราะไม่ใช่ storage key. ไม่ส่ง mediaType → MessageBubble.tsx:342-357
        // เข้า branch ChatImage (เงื่อนไข file คือ type==='FILE' หรือ mediaType ไม่ใช่ image/*)
        const r = await this.messageRouter.sendStaffMessage({
          roomId: params.sessionId,
          staffId: params.staffId,
          type: MessageType.IMAGE,
          mediaUrl: summary.photoUrl,
          clientMessageId: `${params.clientMessageId}-img`,
        });
        if (r.success) sent += 1;
        else errors.push(r.error ?? 'ส่งรูปสินค้าไม่สำเร็จ');
      }
    }

    if (parts.includes('TEXT')) {
      const r = await this.messageRouter.sendStaffMessage({
        roomId: params.sessionId,
        staffId: params.staffId,
        text: summary.text,
        clientMessageId: `${params.clientMessageId}-txt`,
      });
      if (r.success) sent += 1;
      else errors.push(r.error ?? 'ส่งข้อความสินค้าไม่สำเร็จ');
    }

    // ไม่มี bubble ไหนถูกส่งและไม่มี error รายทาง (เช่น parts=['PHOTO'] แต่ gallery ว่าง)
    // ต้องไม่เงียบ — ไม่งั้น UI toast "ส่งแล้ว" ทั้งที่ลูกค้าไม่ได้อะไรเลย (final-review fast-follow)
    if (sent === 0 && errors.length === 0) {
      errors.push('ไม่มีข้อความหรือรูปที่ส่งได้ (เครื่องนี้อาจไม่มีรูป)');
    }

    this.logger.log(
      `Product card sent: room=${params.sessionId} product=${params.productId} sent=${sent} skipped=${photoSkipped}`,
    );
    return { sent, photoSkipped, errors };
  }
}
