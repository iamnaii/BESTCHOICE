import { ChatChannel, MessageType } from '@prisma/client';
import { ChatCommerceService } from './chat-commerce.service';
import { MessageRouterService } from '../../chat-engine/services/message-router.service';

function makeService(product?: any) {
  const prisma = {
    product: {
      findMany: jest.fn().mockResolvedValue(product ? [product] : []),
      findFirst: jest.fn().mockResolvedValue(product ?? null),
    },
  };
  const roomManager = { saveMessage: jest.fn() };
  const messageRouter = { sendStaffMessage: jest.fn().mockResolvedValue({ success: true }) };
  const productQuote = {
    getQuotes: jest.fn().mockResolvedValue([
      { cashPrice: 19500, installmentPrice: 20000, months: 12, monthlyPayment: 1926, downAmount: 4000 },
    ]),
  };
  const svc = new ChatCommerceService(
    prisma as any,
    roomManager as any,
    messageRouter as any,
    productQuote as any,
  );
  return { svc, prisma, messageRouter, productQuote };
}

const PRODUCT = {
  id: 'p1',
  name: 'iPhone 13 128GB',
  brand: 'Apple',
  model: 'iPhone 13',
  color: 'สีชมพู',
  storage: '128GB',
  status: 'IN_STOCK',
  category: 'PHONE_USED',
  conditionGrade: 'A',
  batteryHealth: 92,
  shopWarrantyDays: 30,
  cashPrice: '19500',
  installmentPrice: '20000',
  gallery: ['https://cdn.example/p1-0.jpg', 'https://cdn.example/p1-1.jpg'],
  branch: { name: 'ลาดพร้าว' },
  prices: [],
  // ฟิลด์ที่ evaluateReadiness (B0) ต้องใช้ — ขาดตัวใดตัวหนึ่ง shareUrl ต้องเป็น null
  isOnlineVisible: true,
  deletedAt: null,
};

beforeEach(() => {
  process.env.SHOP_BASE_URL = 'https://www.bestchoicephone.com';
});

describe('ChatCommerceService.searchProducts', () => {
  it('ห้าม select photos[] (base64) และคืนรูปจาก gallery[0]', async () => {
    const { svc, prisma } = makeService(PRODUCT);
    const rows = await svc.searchProducts('iphone');

    const select = prisma.product.findMany.mock.calls[0][0].select;
    expect(select.photos).toBeUndefined();
    expect(select.gallery).toBe(true);
    expect(rows[0].photoUrl).toBe('https://cdn.example/p1-0.jpg');
    expect(rows[0].monthlyPayment).toBe(1926);
    expect(rows[0].branchName).toBe('ลาดพร้าว');
  });

  it('รวมเครื่องติดจองด้วย (แอดมินต้องเห็นว่ามีของแต่ถูกจอง)', async () => {
    const { svc, prisma } = makeService(PRODUCT);
    await svc.searchProducts('iphone');
    expect(prisma.product.findMany.mock.calls[0][0].where.status).toEqual({
      in: ['IN_STOCK', 'RESERVED'],
    });
  });

  it('คำค้นสั้นกว่า 2 ตัว → คืน [] โดยไม่ยิง DB', async () => {
    const { svc, prisma } = makeService(PRODUCT);
    expect(await svc.searchProducts('i')).toEqual([]);
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it('ยังไม่มีรูปขึ้นเว็บ (gallery ว่าง) → shareUrl = null (หน้าเว็บจะ 404 หลัง B0)', async () => {
    const ready = await makeService(PRODUCT).svc.searchProducts('iphone');
    expect(ready[0].shareUrl).toBe('https://www.bestchoicephone.com/products/p1');

    const { svc } = makeService({ ...PRODUCT, gallery: [] });
    const rows = await svc.searchProducts('iphone');
    expect(rows[0].shareUrl).toBeNull();
    expect(rows[0].photoUrl).toBeNull();
  });
});

describe('ChatCommerceService.sendProductCard — 2 bubble idempotent', () => {
  it('ส่งรูปก่อนแล้วตามด้วยข้อความ ด้วย token คนละตัวที่คำนวณได้แน่นอน', async () => {
    const { svc, messageRouter } = makeService(PRODUCT);
    const res = await svc.sendProductCard({
      sessionId: 'r1',
      staffId: 'u1',
      productId: 'p1',
      clientMessageId: 'tok',
    });

    expect(res).toEqual({ sent: 2, photoSkipped: false, errors: [] });
    expect(messageRouter.sendStaffMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        roomId: 'r1',
        type: 'IMAGE',
        mediaUrl: 'https://cdn.example/p1-0.jpg',
        clientMessageId: 'tok-img',
      }),
    );
    const second = messageRouter.sendStaffMessage.mock.calls[1][0];
    expect(second.clientMessageId).toBe('tok-txt');
    expect(second.text).toContain('ผ่อน 12 งวด งวดละ 1,926 บาท');
  });

  it('เครื่องไม่มี gallery → ข้าม bubble รูป ส่งเฉพาะข้อความ + แจ้ง photoSkipped', async () => {
    const { svc, messageRouter } = makeService({ ...PRODUCT, gallery: [] });
    const res = await svc.sendProductCard({
      sessionId: 'r1',
      staffId: 'u1',
      productId: 'p1',
      clientMessageId: 'tok',
    });

    expect(res.photoSkipped).toBe(true);
    expect(res.sent).toBe(1);
    expect(messageRouter.sendStaffMessage).toHaveBeenCalledTimes(1);
  });

  it('parts=["PHOTO"] → ส่งเฉพาะรูป', async () => {
    const { svc, messageRouter } = makeService(PRODUCT);
    const res = await svc.sendProductCard({
      sessionId: 'r1',
      staffId: 'u1',
      productId: 'p1',
      clientMessageId: 'tok',
      parts: ['PHOTO'],
    });
    expect(res.sent).toBe(1);
    expect(messageRouter.sendStaffMessage).toHaveBeenCalledTimes(1);
    expect(messageRouter.sendStaffMessage.mock.calls[0][0].type).toBe('IMAGE');
  });

  it('bubble ใดล้มเหลว → รายงาน error โดยไม่ throw', async () => {
    const { svc, messageRouter } = makeService(PRODUCT);
    messageRouter.sendStaffMessage
      .mockResolvedValueOnce({ success: false, error: 'LINE 400' })
      .mockResolvedValueOnce({ success: true });
    const res = await svc.sendProductCard({
      sessionId: 'r1',
      staffId: 'u1',
      productId: 'p1',
      clientMessageId: 'tok',
    });
    expect(res.sent).toBe(1);
    expect(res.errors).toEqual(['LINE 400']);
  });

  // เส้นทางเดิม (dead code) แค่ saveMessage แล้วจบ — ลูกค้าไม่เคยได้รับอะไร
  // เคสนี้จึงต่อ MessageRouterService ตัวจริงเข้ากับ adapter ปลอม เพื่อพิสูจน์ว่า
  // การ์ดใหม่ "ออกช่องทางจริง" ไม่ใช่แค่บันทึกลง DB
  it('เดินทะลุถึง adapter จริง (ไม่ใช่ saveMessage เฉยๆ แบบโค้ดเดิม)', async () => {
    const prisma = { product: { findFirst: jest.fn().mockResolvedValue(PRODUCT) } };
    const productQuote = {
      getQuotes: jest.fn().mockResolvedValue([
        { cashPrice: 19500, installmentPrice: 20000, months: 12, monthlyPayment: 1926, downAmount: 4000 },
      ]),
    };
    const roomManager = {
      findById: jest.fn().mockResolvedValue({
        id: 'r1',
        channel: ChatChannel.LINE_SHOP,
        externalUserId: 'U1',
        lineUserId: null,
      }),
      findByClientMessageId: jest.fn().mockResolvedValue(null),
      saveMessage: jest.fn(async () => ({ id: 'm1', clientMessageId: null, createdAt: new Date() })),
      markOutboundSent: jest.fn(),
    };
    const adapter = {
      channel: ChatChannel.LINE_SHOP,
      sendMessage: jest.fn().mockResolvedValue({ success: true, externalMessageId: 'ext-1' }),
    };
    const router = new MessageRouterService(
      roomManager as any,
      { initiateHandoff: jest.fn() } as any,
      { get: jest.fn().mockReturnValue(undefined) } as any,
    );
    router.registerAdapter(adapter as any);

    const svc = new ChatCommerceService(
      prisma as any,
      roomManager as any,
      router,
      productQuote as any,
    );
    const res = await svc.sendProductCard({
      sessionId: 'r1',
      staffId: 'u1',
      productId: 'p1',
      clientMessageId: 'tok',
    });

    expect(res.sent).toBe(2);
    expect(adapter.sendMessage).toHaveBeenCalledTimes(2); // ← หัวใจของเคสนี้
    expect(adapter.sendMessage.mock.calls[0][0]).toEqual(
      expect.objectContaining({ type: MessageType.IMAGE, imageUrl: 'https://cdn.example/p1-0.jpg' }),
    );
    expect(adapter.sendMessage.mock.calls[1][0].text).toContain('เงินสด 19,500 บาท');
  });
});
