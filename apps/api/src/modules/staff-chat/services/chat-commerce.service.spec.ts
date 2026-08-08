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

  // Review fix round 1 [I1] — idempotency ที่ระดับ sendProductCard (ไม่ใช่แค่ primitive):
  // bubble รูปสำเร็จ, bubble ข้อความล้มเหลว, retry ด้วย clientMessageId เดิม —
  // ลูกค้าต้องไม่ได้รูปซ้ำ (adapter IMAGE รวม 1 ครั้ง) แต่ต้องได้ข้อความ (adapter TEXT รวม 2 ครั้ง
  // เพราะครั้งแรกไม่เคยถึงลูกค้า). ใช้ MessageRouterService ตัวจริง + fake adapter เหมือนเคสข้างบน
  // แต่ roomManager เป็น in-memory store จริง (ไม่ใช่ mock เดี่ยว) เพื่อให้เห็นสถานะ
  // outboundSentAt ข้าม call ของ sendProductCard สองครั้ง
  it('retry หลัง bubble ข้อความล้มเหลว → resend เฉพาะข้อความ, ลูกค้าไม่ได้รูปซ้ำ (idempotent ที่ระดับ sendProductCard)', async () => {
    const prisma = { product: { findFirst: jest.fn().mockResolvedValue(PRODUCT) } };
    const productQuote = {
      getQuotes: jest.fn().mockResolvedValue([
        { cashPrice: 19500, installmentPrice: 20000, months: 12, monthlyPayment: 1926, downAmount: 4000 },
      ]),
    };

    type Row = { id: string; clientMessageId: string | null; createdAt: Date; outboundSentAt: Date | null };
    const rows = new Map<string, Row>();
    let seq = 0;
    const roomManager = {
      findById: jest.fn().mockResolvedValue({
        id: 'r1',
        channel: ChatChannel.LINE_SHOP,
        externalUserId: 'U1',
        lineUserId: null,
      }),
      findByClientMessageId: jest.fn(async (_roomId: string, clientMessageId: string) => rows.get(clientMessageId) ?? null),
      saveMessage: jest.fn(async (params: any) => {
        seq += 1;
        const row: Row = {
          id: `m${seq}`,
          clientMessageId: params.clientMessageId ?? null,
          createdAt: new Date(),
          outboundSentAt: null,
        };
        if (params.clientMessageId) rows.set(params.clientMessageId, row);
        return row;
      }),
      markOutboundSent: jest.fn(async (messageId: string) => {
        for (const row of rows.values()) {
          if (row.id === messageId) row.outboundSentAt = new Date();
        }
      }),
    };
    const adapter = {
      channel: ChatChannel.LINE_SHOP,
      sendMessage: jest
        .fn()
        .mockResolvedValueOnce({ success: true, externalMessageId: 'ext-img' }) // IMAGE ครั้งแรก สำเร็จ
        .mockResolvedValueOnce({ success: false, error: 'LINE 500' }) // TEXT ครั้งแรก ล้มเหลว
        .mockResolvedValueOnce({ success: true, externalMessageId: 'ext-txt' }), // TEXT retry สำเร็จ
    };
    const router = new MessageRouterService(
      roomManager as any,
      { initiateHandoff: jest.fn() } as any,
      { get: jest.fn().mockReturnValue(undefined) } as any,
    );
    router.registerAdapter(adapter as any);
    const svc = new ChatCommerceService(prisma as any, roomManager as any, router, productQuote as any);

    const first = await svc.sendProductCard({
      sessionId: 'r1',
      staffId: 'u1',
      productId: 'p1',
      clientMessageId: 'tok',
    });
    expect(first).toEqual({ sent: 1, photoSkipped: false, errors: ['LINE 500'] });

    // retry ด้วย clientMessageId เดิมเป๊ะ
    const second = await svc.sendProductCard({
      sessionId: 'r1',
      staffId: 'u1',
      productId: 'p1',
      clientMessageId: 'tok',
    });
    expect(second).toEqual({ sent: 2, photoSkipped: false, errors: [] }); // สภาพสุดท้าย = ครบ 2 bubble

    // IMAGE ถูกส่งออกช่องทางจริงแค่ 1 ครั้งรวม (dedup ข้าม retry — ลูกค้าไม่ได้รูปซ้ำ)
    const imageCalls = adapter.sendMessage.mock.calls.filter(([m]: any[]) => m.type === MessageType.IMAGE);
    expect(imageCalls).toHaveLength(1);
    // TEXT ถูกส่งออก 2 ครั้งรวม (ครั้งแรกล้มเหลวไม่เคยถึงลูกค้า + retry ส่งใหม่สำเร็จ)
    const textCalls = adapter.sendMessage.mock.calls.filter(([m]: any[]) => m.type === MessageType.TEXT);
    expect(textCalls).toHaveLength(2);
    expect(adapter.sendMessage).toHaveBeenCalledTimes(3);

    // DB: มีแถวจริงแค่ 2 แถว (IMAGE 1 + TEXT 1) — retry ไม่ insert ซ้ำ
    expect(roomManager.saveMessage).toHaveBeenCalledTimes(2);
    expect(rows.size).toBe(2);
  });
});
