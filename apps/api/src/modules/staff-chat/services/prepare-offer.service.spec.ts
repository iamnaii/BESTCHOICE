import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrepareOfferService } from './prepare-offer.service';
import { RoomAiAccessService, StaffAiActor } from './room-ai-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AiTextService } from '../../ai-usage/ai-text.service';
import { SearchProductsTool } from '../../sales-bot/tools/search-products.tool';
import { CalculateInstallmentTool } from '../../sales-bot/tools/calculate-installment.tool';

const actor: StaffAiActor = { id: 'staff-1', role: 'SALES', branchId: 'branch-1', accessibleCompanies: ['SHOP'] };
const unit = { id: 'product-1', priceThb: 19900, branchName: 'สาขา 1', reserved: false, photoUrl: null };

describe('staff offer preparation', () => {
  const prisma = {
    chatRoom: { findFirst: jest.fn() },
    chatMessage: { findMany: jest.fn() },
  };
  const ai = { isAvailable: true, generate: jest.fn() };
  const search = { run: jest.fn() };
  const calculate = { run: jest.fn() };
  let service: PrepareOfferService;

  beforeEach(() => {
    jest.resetAllMocks();
    ai.isAvailable = true;
    prisma.chatRoom.findFirst.mockResolvedValue({ id: 'room-1', channel: 'LINE_SHOP', customerId: 'customer-1', assignedToId: actor.id, assignedTo: { branchId: actor.branchId }, customer: { id: 'customer-1', deletedAt: null } });
    prisma.chatMessage.findMany.mockResolvedValue([{ id: 'message-1', text: 'สนใจ iPhone 14 โทร 0812345678', createdAt: new Date('2026-09-08') }]);
    ai.generate.mockResolvedValue(JSON.stringify({ summary: 'สนใจ iPhone 14', searchQuery: 'iPhone 14', price: 1, approved: true }));
    search.run.mockResolvedValue({ groups: [{ brand: 'Apple', model: 'iPhone 14', storage: '128GB', units: [unit, { ...unit, id: 'reserved-1', reserved: true }] }] });
    calculate.run.mockResolvedValue({ monthlyThb: 2413.20, downAmountThb: 2985, tenureMonths: 12 });
    const db = prisma as unknown as PrismaService;
    service = new PrepareOfferService(db, new RoomAiAccessService(db), ai as unknown as AiTextService, search as unknown as SearchProductsTool, calculate as unknown as CalculateInstallmentTool);
  });

  it('uses actual scoped stock/calculator amounts, excludes reservations and ignores model prices/approval', async () => {
    const result = await service.prepare('room-1', { tenureMonths: 12, maxPriceThb: 20000 }, actor);
    expect(search.run).toHaveBeenCalledWith({ query: 'iPhone 14', maxPriceThb: 20000 }, { branchId: 'branch-1' });
    expect(calculate.run).toHaveBeenCalledTimes(1);
    expect(calculate.run).toHaveBeenCalledWith({ productId: 'product-1', tenureMonths: 12 }, { branchId: 'branch-1' }, true);
    expect(result).toMatchObject({ status: 'draft', aiStatus: 'ready', sources: [{ messageId: 'message-1' }] });
    expect(result.products).toHaveLength(1);
    expect(result.products[0]).toMatchObject({ quote: { monthlyThb: 2413.20 }, cashPriceThb: 19900 });
    expect(result.products[0].draft).toContain('2,413.20');
    expect(result.products[0].draft).toContain('ต้องผ่านการตรวจเครดิต');
    const params = new URL(result.products[0].contractPath!, 'https://local.invalid').searchParams;
    expect(params.get('customerId')).toBe('customer-1');
    expect(params.get('productId')).toBe('product-1');
    expect(params.get('fromRoom')).toBe('room-1');
    expect(params.get('downAmount')).toBe('2985');
    expect(params.has('approved')).toBe(false);
    expect(ai.generate.mock.calls[0][0].messages[0].content).not.toContain('0812345678');
    expect(ai.generate.mock.calls[0][1]).toEqual({ service: 'staff-workflow', method: 'prepareOffer', userId: actor.id });
    expect(prisma.chatMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { roomId: 'room-1', deletedAt: null, role: 'CUSTOMER', text: { not: null } } }));
  });

  it.each([
    ['another assigned salesperson', { assignedToId: 'someone-else' }, actor],
    ['another staff branch', { assignedTo: { branchId: 'branch-2' } }, { ...actor, role: 'BRANCH_MANAGER' }],
    ['unassigned staff branch', {}, { ...actor, branchId: null }],
    ['finance-only identity', {}, { ...actor, accessibleCompanies: ['FINANCE'] }],
    ['shop-only identity in an unassigned finance room', { channel: 'LINE_FINANCE', assignedToId: null }, actor],
    ['owner without the room company permission', { channel: 'LINE_FINANCE', assignedToId: null }, { ...actor, role: 'OWNER' }],
    ['unpermitted role', {}, { ...actor, role: 'VIEWER' }],
  ])('rejects %s before reading conversation or calling AI', async (_label, patch, identity) => {
    prisma.chatRoom.findFirst.mockResolvedValue({ id: 'room-1', channel: 'LINE_SHOP', assignedToId: actor.id, ...patch });
    await expect(service.prepare('room-1', { tenureMonths: 12 }, identity)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.chatMessage.findMany).not.toHaveBeenCalled();
    expect(ai.generate).not.toHaveBeenCalled();
    expect(search.run).not.toHaveBeenCalled();
  });

  // เดิมเคสนี้อยู่ในลิสต์ปฏิเสธข้างบนในชื่อ 'identity without company permissions' — พลิกด้าน
  // ไม่ใช่ลบ: ตั้งแต่ 2026-09-08 "ไม่มีค่าสิทธิ์บริษัท" (ว่าง/undefined) แปลว่า "ยังไม่ตั้งค่า"
  // ไม่ใช่ "ไม่มีสิทธิ์" — พนักงานทั้งบริษัทมีค่าเป็น array ว่างอยู่จริงบน prod และปุ่ม
  // 'เตรียมข้อเสนอ' หายไปเงียบ ๆ ทุกคน สิทธิ์จริงมาจาก role (SALES = SHOP) แทน
  it.each([
    ['ยังไม่ตั้งค่า (undefined)', undefined],
    ['ยังไม่ตั้งค่า (array ว่าง)', [] as string[]],
  ])('อนุญาตพนักงานหน้าร้านที่สิทธิ์บริษัท %s', async (_label, accessibleCompanies) => {
    const result = await service.prepare('room-1', { tenureMonths: 12 }, { ...actor, accessibleCompanies });
    expect(result.products).toHaveLength(1);
  });

  it('rejects a missing/deleted room before generating text', async () => {
    prisma.chatRoom.findFirst.mockResolvedValue(null);
    await expect(service.prepare('room-1', { tenureMonths: 12 }, actor)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.chatRoom.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'room-1', deletedAt: null } }));
    expect(ai.generate).not.toHaveBeenCalled();
  });

  it('allows unlinked rooms but requires customer linking before creating contracts', async () => {
    prisma.chatRoom.findFirst.mockResolvedValue({ id: 'room-1', channel: 'LINE_SHOP', customerId: null, assignedToId: null, customer: null });
    const result = await service.prepare('room-1', { tenureMonths: 12 }, actor);
    expect(result.products[0].contractPath).toBeNull();
    expect(result.nextStep).toContain('ผูกลูกค้า');
  });

  it('keeps explicit stock search usable without a provider and never invents a plan', async () => {
    ai.isAvailable = false;
    calculate.run.mockResolvedValue({ error: 'rate_not_configured' });
    const result = await service.prepare('room-1', { tenureMonths: 18, query: 'iPhone 15' }, actor);
    expect(ai.generate).not.toHaveBeenCalled();
    expect(search.run).toHaveBeenCalledWith({ query: 'iPhone 15', maxPriceThb: undefined }, { branchId: 'branch-1' });
    expect(result.aiStatus).toBe('unavailable');
    expect(result.products[0].quote).toBeNull();
    expect(result.products[0].draft).not.toContain('2,413');
  });

  it.each(['not JSON', '{"summary":"x","searchQuery":42}'])('does not turn malformed model output into a stock query: %s', async (output) => {
    ai.generate.mockResolvedValue(output);
    const result = await service.prepare('room-1', { tenureMonths: 12 }, actor);
    expect(result.aiStatus).not.toBe('ready');
    expect(result.products).toEqual([]);
    expect(search.run).not.toHaveBeenCalled();
  });

  it('drops stock sold/reserved after the initial search and bounds quote calls to three', async () => {
    search.run.mockResolvedValue({ groups: [{ brand: 'Apple', model: 'iPhone', units: Array.from({ length: 10 }, (_, i) => ({ ...unit, id: `product-${i}` })) }] });
    calculate.run.mockResolvedValue({ error: 'product_not_found' });
    const result = await service.prepare('room-1', { tenureMonths: 12 }, actor);
    expect(calculate.run).toHaveBeenCalledTimes(3);
    expect(result.products).toEqual([]);
  });

  it.each([
    ['สนใจ iPhone งบไม่เกิน 10,000 บาท', 10000],
    ['ขอ iPhone งบเงินสด 2 หมื่น', 20000],
    ['iPhone ราคาเงินสดสูงสุด 15k', 15000],
    ['งบซื้อเครื่อง 15000 บาท ผ่อนเดือนละ 1000', 15000],
  ])('uses the explicit cash budget in customer text: %s', async (text, amount) => {
    prisma.chatMessage.findMany.mockResolvedValue([{ id: 'budget-message', text, createdAt: new Date() }]);
    const result = await service.prepare('room-1', { tenureMonths: 12 }, actor);
    expect(search.run).toHaveBeenCalledWith({ query: 'iPhone 14', maxPriceThb: amount }, { branchId: actor.branchId });
    expect(result).toMatchObject({ maxPriceThb: amount, budgetSource: 'chat' });
  });

  it.each([
    'งบผ่อนเดือนละ 1000 บาท', 'งบ 1000 บาทต่อเดือน', 'งบ 1000 บาท/งวด',
    'ดาวน์ไม่เกิน 2000 บาท', 'งบ -1000 บาท', 'งบ 0 บาท', 'งบ 2 ล้าน', 'งบ Infinity',
  ])('does not turn monthly/down-payment/invalid amounts into a cash budget: %s', async (text) => {
    prisma.chatMessage.findMany.mockResolvedValue([{ id: 'budget-message', text, createdAt: new Date() }]);
    const result = await service.prepare('room-1', { tenureMonths: 12 }, actor);
    expect(search.run).toHaveBeenCalledWith({ query: 'iPhone 14', maxPriceThb: undefined }, { branchId: actor.branchId });
    expect(result).toMatchObject({ maxPriceThb: null, budgetSource: null });
  });

  it('prefers an explicit staff budget over the budget in chat', async () => {
    prisma.chatMessage.findMany.mockResolvedValue([{ id: 'budget-message', text: 'งบไม่เกิน 10000', createdAt: new Date() }]);
    const result = await service.prepare('room-1', { tenureMonths: 12, maxPriceThb: 15000 }, actor);
    expect(search.run).toHaveBeenCalledWith({ query: 'iPhone 14', maxPriceThb: 15000 }, { branchId: actor.branchId });
    expect(result).toMatchObject({ maxPriceThb: 15000, budgetSource: 'manual' });
  });

  it('lets the newest customer cash-budget change replace an older amount without requiring AI', async () => {
    ai.isAvailable = false;
    prisma.chatMessage.findMany.mockResolvedValue([
      { id: 'new-budget', text: 'งบไม่เกิน 15000', createdAt: new Date() },
      { id: 'old-budget', text: 'งบไม่เกิน 10000', createdAt: new Date() },
    ]);
    const result = await service.prepare('room-1', { tenureMonths: 12, query: 'iPhone 14' }, actor);
    expect(result).toMatchObject({ maxPriceThb: 15000, budgetSource: 'chat' });
    expect(ai.generate).not.toHaveBeenCalled();
  });

  it('preserves a fractional quoted down payment when opening the contract form', async () => {
    calculate.run.mockResolvedValue({ monthlyThb: 2413.20, downAmountThb: 2985.15, tenureMonths: 12 });
    const result = await service.prepare('room-1', { tenureMonths: 12 }, actor);
    expect(new URL(result.products[0].contractPath!, 'https://local.invalid').searchParams.get('downAmount')).toBe('2985.15');
  });

  it('returns bounded customer source excerpts with IDs/timestamps and the same PII redaction as model input', async () => {
    const createdAt = new Date('2026-09-08');
    const privateText = `สนใจ iPhone โทร 081-234-5678 เลขบัตร 1-2345-67890-12-3 ${'รายละเอียดเพิ่มเติม '.repeat(30)}`;
    prisma.chatMessage.findMany.mockResolvedValue([{ id: 'source-1', text: privateText, createdAt }]);
    const result = await service.prepare('room-1', { tenureMonths: 12 }, actor);
    expect(result.sources[0]).toMatchObject({ messageId: 'source-1', createdAt });
    expect(result.sources[0].excerpt).toHaveLength(250);
    expect(result.sources[0].excerpt).toContain('สนใจ iPhone โทร [ข้อมูลส่วนบุคคล] เลขบัตร [ข้อมูลส่วนบุคคล]');
    expect(result.sources[0].excerpt).not.toContain('081-234-5678');
    const modelInput = JSON.parse(ai.generate.mock.calls[0][0].messages[0].content);
    expect(result.sources[0].excerpt).toBe(modelInput[0].text.slice(0, 250));
    expect(prisma.chatMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { roomId: 'room-1', deletedAt: null, role: 'CUSTOMER', text: { not: null } },
      take: 20,
    }));
  });

  it('uses the newer quote-read cash price in both displayed product and draft', async () => {
    calculate.run.mockResolvedValue({ monthlyThb: 2413.20, downAmountThb: 2985, tenureMonths: 12, cashPriceThb: 19500 });
    const result = await service.prepare('room-1', { tenureMonths: 12, maxPriceThb: 20000 }, actor);
    expect(result.products[0].cashPriceThb).toBe(19500);
    expect(result.products[0].draft).toContain('19,500.00');
    expect(result.products[0].draft).not.toContain('19,900.00');
  });

  it.each([21000, 0, null, Number.NaN])('drops a candidate whose refreshed cash price is over budget or no longer configured: %s', async (cashPriceThb) => {
    calculate.run.mockResolvedValue({ monthlyThb: 2413.20, downAmountThb: 2985, tenureMonths: 12, cashPriceThb });
    const result = await service.prepare('room-1', { tenureMonths: 12, maxPriceThb: 20000 }, actor);
    expect(result.products).toEqual([]);
  });
});
