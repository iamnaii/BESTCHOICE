/**
 * SaleCreationService — รั้วกันข้ามฝั่ง (spec 2026-09-05 §5.1 จุด POS)
 * เครื่อง TEST- ↔ ลูกค้าทดสอบ เท่านั้น / เครื่องจริง ↔ ลูกค้าจริง เท่านั้น — ตรวจทุกชิ้นในใบ
 */
import { BadRequestException } from '@nestjs/common';
import { INSTALLMENT_VIA_CONTRACT_MSG, SaleCreationService } from './sale-creation.service';
import { TEST_CUSTOMER_ADDRESS } from '../../../utils/test-data-markers';

const realCustomer = {
  id: 'cust-1',
  name: 'ลูกค้าจริง',
  phone: '0891234567',
  addressCurrent: 'กรุงเทพ',
};
const testCustomer = {
  id: 'cust-t',
  name: 'ทดสอบระบบ ลูกค้า',
  phone: 'TEST-0000001',
  addressCurrent: TEST_CUSTOMER_ADDRESS,
};
const realProduct = { id: 'prod-1', imeiSerial: '356789012345678', name: 'iPhone 15', po: null };
const testProduct = { id: 'prod-t', imeiSerial: 'TEST-0001', name: 'ทดสอบระบบ มือถือ', po: null };
const testAccessory = {
  id: 'prod-acc',
  imeiSerial: null,
  name: 'สายชาร์จ',
  po: { poNumber: 'TEST-PO-0001' },
};

const baseDto = {
  saleType: 'CASH',
  customerId: 'cust-1',
  productId: 'prod-1',
  branchId: 'br-1',
  sellingPrice: 10000,
  amountReceived: 10000,
};

function makeService(customer: unknown, products: unknown[]) {
  const prisma = {
    customer: {
      findFirst: jest.fn().mockResolvedValue(customer),
      findUnique: jest.fn().mockResolvedValue({ loyaltyBalance: 0, deletedAt: null }),
    },
    product: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ wasPreviouslyDamaged: false, deletedAt: null, costPrice: null }),
      findMany: jest.fn().mockResolvedValue(products),
    },
  };
  const writer = {
    createCashSale: jest.fn().mockResolvedValue({ id: 'sale-1' }),
    createExternalFinanceSale: jest.fn().mockResolvedValue({ id: 'sale-3' }),
  };
  const service = new SaleCreationService(
    prisma as never,
    writer as never,
    {} as never,
    { notify: jest.fn().mockResolvedValue(undefined) } as never,
  );
  return { service, prisma, writer };
}

describe('SaleCreationService.create — test-data fence', () => {
  it('จริง ↔ จริง ผ่าน และ writer ถูกเรียก', async () => {
    const { service, writer, prisma } = makeService(realCustomer, [realProduct]);
    await service.create(baseDto as never, 'sp-1', 'OWNER');
    expect(writer.createCashSale).toHaveBeenCalledTimes(1);
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['prod-1'] }, deletedAt: null },
        select: expect.objectContaining({ po: { select: { poNumber: true } } }),
      }),
    );
  });

  it('ทดสอบ ↔ ทดสอบ ผ่าน', async () => {
    const { service, writer } = makeService(testCustomer, [testProduct]);
    await service.create(
      { ...baseDto, customerId: 'cust-t', productId: 'prod-t' } as never,
      'sp-1',
    );
    expect(writer.createCashSale).toHaveBeenCalledTimes(1);
  });

  it('เครื่องทดสอบ → ลูกค้าจริง: BadRequest ก่อนถึง writer', async () => {
    const { service, writer } = makeService(realCustomer, [testProduct]);
    await expect(
      service.create({ ...baseDto, productId: 'prod-t' } as never, 'sp-1'),
    ).rejects.toThrow(/เครื่องทดสอบระบบ/);
    expect(writer.createCashSale).not.toHaveBeenCalled();
  });

  it('เครื่องจริง → ลูกค้าทดสอบ: BadRequest', async () => {
    const { service, writer } = makeService(testCustomer, [realProduct]);
    await expect(
      service.create({ ...baseDto, customerId: 'cust-t' } as never, 'sp-1'),
    ).rejects.toThrow(BadRequestException);
    expect(writer.createCashSale).not.toHaveBeenCalled();
  });

  it('ของแถมผิดฝั่ง (อุปกรณ์เสริมจาก PO ทดสอบ) ก็ต้องดัง', async () => {
    const { service, writer, prisma } = makeService(realCustomer, [realProduct, testAccessory]);
    await expect(
      service.create({ ...baseDto, bundleProductIds: ['prod-acc'] } as never, 'sp-1'),
    ).rejects.toThrow(/สายชาร์จ/);
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['prod-1', 'prod-acc'] }, deletedAt: null } }),
    );
    expect(writer.createCashSale).not.toHaveBeenCalled();
  });

  it('ไม่พบลูกค้า → NotFound ไทย', async () => {
    const { service } = makeService(null, [realProduct]);
    await expect(service.create(baseDto as never, 'sp-1')).rejects.toThrow('ไม่พบลูกค้า');
  });
});

describe('SaleCreationService.create — ขายผ่อนในเครือทำผ่านหน้าสัญญาทางเดียว (2026-09-20)', () => {
  it('INSTALLMENT → BadRequest ชี้ไปปุ่ม "สร้างสัญญา" ก่อนแตะลูกค้า/สินค้า/writer ใด ๆ', async () => {
    const { service, writer, prisma } = makeService(realCustomer, [realProduct]);
    await expect(
      service.create({ ...baseDto, saleType: 'INSTALLMENT' } as never, 'sp-1', 'OWNER'),
    ).rejects.toThrow(INSTALLMENT_VIA_CONTRACT_MSG);
    expect(prisma.customer.findFirst).not.toHaveBeenCalled();
    expect(prisma.product.findMany).not.toHaveBeenCalled();
    expect(writer.createCashSale).not.toHaveBeenCalled();
    expect(writer.createExternalFinanceSale).not.toHaveBeenCalled();
  });
});

describe('SaleCreationService.create — ด่านเบอร์ (spec 2026-09-13-chat-prospects)', () => {
  // A12: ข้อความแยกตาม isChatPlaceholder ⇒ ผู้สนใจต้องมีที่มา CHAT_* และไม่มีเลขบัตร (และ select ต้องโหลดสองคีย์นี้มาด้วย)
  const chatProspect = { ...realCustomer, name: 'Facebook #a1b2', phone: null, nationalId: null, acquisitionSource: 'CHAT_FACEBOOK' };

  it.each([
    ['CASH', 'createCashSale'],
    ['EXTERNAL_FINANCE', 'createExternalFinanceSale'],
  ] as const)('%s กับผู้สนใจที่ยังไม่มีเบอร์ → BadRequest ก่อนถึง writer', async (saleType, writerMethod) => {
    const { service, writer } = makeService(chatProspect, [realProduct]);
    await expect(
      service.create({ ...baseDto, saleType } as never, 'sp-1', 'OWNER'),
    ).rejects.toThrow('ผู้สนใจคนนี้ยังไม่มีเบอร์ — กด "เติมเบอร์" ในหน้าลูกค้า หรือ "เพิ่มเบอร์/ข้อมูล" ในการ์ดผู้สนใจที่อินบ็อกซ์ ก่อนเปิดใบขาย (ถ้าห้องแชทของผู้สนใจคนนี้มีพนักงานคนอื่นดูแลอยู่ ให้คนดูแลห้อง หรือเจ้าของ/ผู้จัดการสาขา/ผู้จัดการการเงิน เติมให้)');
    expect(writer[writerMethod]).not.toHaveBeenCalled();
  });

  it('โหลดลูกค้าพร้อมคีย์ที่ใช้ตัดสินผู้สนใจ (acquisitionSource/nationalId) · มีเลขบัตรแต่ไม่มีเบอร์ → ชี้ "แก้ไขข้อมูล"', async () => {
    const { service, writer, prisma } = makeService({ ...chatProspect, nationalId: '1103700012345' }, [realProduct]);
    await expect(
      service.create(baseDto as never, 'sp-1', 'OWNER'),
    ).rejects.toThrow('ลูกค้ายังไม่มีเบอร์โทร — ให้เจ้าของหรือผู้จัดการสาขากด "แก้ไขข้อมูล" ในหน้าลูกค้าเพื่อเติมเบอร์ก่อนเปิดใบขาย');
    expect(prisma.customer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ phone: true, acquisitionSource: true, nationalId: true, addressCurrent: true }),
      }),
    );
    expect(writer.createCashSale).not.toHaveBeenCalled();
  });

  it('ไม่มีรหัสสินค้าในใบ ก็ยังตรวจเบอร์ลูกค้า (ด่านไม่ขึ้นกับรายการเครื่อง)', async () => {
    const { service, writer, prisma } = makeService(chatProspect, []);
    await expect(
      service.create({ ...baseDto, productId: '' } as never, 'sp-1', 'OWNER'),
    ).rejects.toThrow('ผู้สนใจคนนี้ยังไม่มีเบอร์ — กด "เติมเบอร์" ในหน้าลูกค้า หรือ "เพิ่มเบอร์/ข้อมูล" ในการ์ดผู้สนใจที่อินบ็อกซ์ ก่อนเปิดใบขาย (ถ้าห้องแชทของผู้สนใจคนนี้มีพนักงานคนอื่นดูแลอยู่ ให้คนดูแลห้อง หรือเจ้าของ/ผู้จัดการสาขา/ผู้จัดการการเงิน เติมให้)');
    expect(prisma.product.findMany).not.toHaveBeenCalled();
    expect(writer.createCashSale).not.toHaveBeenCalled();
  });
});
