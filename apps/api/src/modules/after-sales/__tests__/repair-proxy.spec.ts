import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AfterSalesRepairService } from '../services/after-sales-repair.service';
import { MAX_INTAKE_PHOTOS } from '../services/after-sales-case.service';

const USER = { id: 'u-1', role: 'SALES', branchId: 'b-1' };

function mockFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    mimetype: 'image/jpeg',
    size: 4,
    originalname: 'a.jpg',
    ...overrides,
  } as Express.Multer.File;
}

describe('AfterSalesRepairService', () => {
  let prisma: any;
  let storage: any;
  let repair: any;
  let query: any;
  let audit: any;
  let svc: AfterSalesRepairService;

  beforeEach(() => {
    jest.clearAllMocks();

    prisma = {
      repairTicket: { findFirst: jest.fn() },
      afterSalesCase: {
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn(),
      },
    };
    storage = {
      upload: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      getStream: jest.fn().mockResolvedValue('stream-1'),
    };
    repair = {
      send: jest.fn().mockResolvedValue(undefined),
      markRepaired: jest.fn().mockResolvedValue(undefined),
      sendBack: jest.fn().mockResolvedValue(undefined),
      returnToCustomer: jest.fn().mockResolvedValue(undefined),
      cancel: jest.fn().mockResolvedValue(undefined),
    };
    query = { getCase: jest.fn() };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    // residual sweep — bare exchange cancel ใช้ $transaction (tx = prisma ตัวเดียวกันใน unit test)
    prisma.$transaction = jest.fn().mockImplementation((cb: any) => cb(prisma));

    svc = new AfterSalesRepairService(
      prisma as never,
      storage as never,
      repair as never,
      query as never,
      audit as never,
    );
  });

  // (a) send → repair.send(ticketId, dto, user) แล้ว update เคส stage='IN_REPAIR' + event REPAIR_SENT
  it('(a) send เรียก repair.send(ticketId, dto, user) แล้ว update stage=IN_REPAIR + event REPAIR_SENT', async () => {
    query.getCase.mockResolvedValue({
      id: 'case-1',
      stage: 'RECEIVED',
      repairTicket: { id: 'rt-1', status: 'OPEN' },
    });
    prisma.repairTicket.findFirst.mockResolvedValue({ status: 'IN_PROGRESS', deletedAt: null });
    prisma.afterSalesCase.update.mockResolvedValue({ id: 'case-1', stage: 'IN_REPAIR' });

    const dto = { repairSupplierId: 'sup-1', externalClaimNo: 'CLAIM-1' };
    const result = await svc.send('case-1', dto as never, USER);

    expect(repair.send).toHaveBeenCalledWith('rt-1', dto, USER);
    expect(prisma.repairTicket.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { afterSalesCase: { id: 'case-1' } } }),
    );
    expect(prisma.afterSalesCase.update).toHaveBeenCalledTimes(1);
    const updateArg = prisma.afterSalesCase.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: 'case-1' });
    expect(updateArg.data.stage).toBe('IN_REPAIR');
    expect(updateArg.data.events.create).toEqual(
      expect.objectContaining({ kind: 'REPAIR_SENT', actorId: USER.id }),
    );
    expect(updateArg.data.closedAt).toBeUndefined();
    expect(result).toEqual({ id: 'case-1', stage: 'IN_REPAIR' });
  });

  // R21 — markRepaired บนเคส stage RECEIVED (ticket OPEN ไม่มีศูนย์) = ซ่อมที่ร้าน
  // → sync เป็น READY_FOR_PICKUP ตามปกติ แต่ event REPAIR_DONE ใช้คำ "ซ่อมที่ร้านเสร็จ"
  it('markRepaired บนเคส stage RECEIVED (ticket OPEN ไม่มีศูนย์) → sync READY_FOR_PICKUP + event REPAIR_DONE note "ซ่อมที่ร้านเสร็จ"', async () => {
    query.getCase.mockResolvedValue({
      id: 'case-1',
      stage: 'RECEIVED',
      repairTicket: { id: 'rt-1', status: 'OPEN', repairSupplier: null },
    });
    prisma.repairTicket.findFirst.mockResolvedValue({
      status: 'READY_FOR_PICKUP',
      deletedAt: null,
    });
    prisma.afterSalesCase.update.mockResolvedValue({ id: 'case-1', stage: 'READY_FOR_PICKUP' });

    const dto = { actualCost: 500, payer: 'SHOP' };
    const result = await svc.markRepaired('case-1', dto as never, USER);

    expect(repair.markRepaired).toHaveBeenCalledWith('rt-1', dto, USER);
    expect(prisma.afterSalesCase.update).toHaveBeenCalledTimes(1);
    const updateArg = prisma.afterSalesCase.update.mock.calls[0][0];
    expect(updateArg.data.stage).toBe('READY_FOR_PICKUP');
    expect(updateArg.data.events.create).toEqual(
      expect.objectContaining({
        kind: 'REPAIR_DONE',
        actorId: USER.id,
        note: 'ซ่อมที่ร้านเสร็จ · ค่าซ่อมจริง 500 · ผู้จ่าย SHOP',
      }),
    );
    expect(result).toEqual({ id: 'case-1', stage: 'READY_FOR_PICKUP' });
  });

  // Regression guard — เคสที่มีศูนย์ซ่อมยังใช้คำ "ซ่อมเสร็จ" เหมือนเดิม ไม่ถูกกิ่งใหม่แตะ
  it('markRepaired บนเคสที่มีศูนย์ซ่อม → event REPAIR_DONE note ยังเป็น "ซ่อมเสร็จ" เหมือนเดิม', async () => {
    query.getCase.mockResolvedValue({
      id: 'case-2',
      stage: 'IN_REPAIR',
      repairTicket: {
        id: 'rt-2',
        status: 'IN_PROGRESS',
        repairSupplier: { id: 'sup-1', name: 'ศูนย์ A' },
      },
    });
    prisma.repairTicket.findFirst.mockResolvedValue({
      status: 'READY_FOR_PICKUP',
      deletedAt: null,
    });
    prisma.afterSalesCase.update.mockResolvedValue({ id: 'case-2', stage: 'READY_FOR_PICKUP' });

    const dto = { actualCost: 1500, payer: 'SHOP' };
    await svc.markRepaired('case-2', dto as never, USER);

    const updateArg = prisma.afterSalesCase.update.mock.calls[0][0];
    expect(updateArg.data.events.create).toEqual(
      expect.objectContaining({ note: 'ซ่อมเสร็จ · ค่าซ่อมจริง 1500 · ผู้จ่าย SHOP' }),
    );
  });

  // (b) returnToCustomer → stage='CLOSED', closedAt ตั้ง, event DELIVERED+CLOSED
  it('(b) returnToCustomer เรียก repair.returnToCustomer แล้ว sync สองครั้ง (DELIVERED แล้ว CLOSED) ปิดด้วย closedAt', async () => {
    query.getCase.mockResolvedValue({
      id: 'case-1',
      stage: 'READY_FOR_PICKUP',
      repairTicket: { id: 'rt-1', status: 'READY_FOR_PICKUP' },
    });
    prisma.repairTicket.findFirst.mockResolvedValue({ status: 'CLOSED', deletedAt: null });
    prisma.afterSalesCase.update.mockResolvedValue({ id: 'case-1', stage: 'CLOSED' });

    const dto = { returnedToCustomerAt: '2026-09-24T00:00:00.000Z' };
    const result = await svc.returnToCustomer('case-1', dto as never, USER);

    expect(repair.returnToCustomer).toHaveBeenCalledWith('rt-1', dto, USER);
    expect(prisma.afterSalesCase.update).toHaveBeenCalledTimes(2);

    const [deliveredCall, closedCall] = prisma.afterSalesCase.update.mock.calls.map(
      (c: any) => c[0],
    );
    expect(deliveredCall.data.events.create).toEqual(
      expect.objectContaining({ kind: 'DELIVERED', actorId: USER.id }),
    );
    expect(deliveredCall.data.stage).toBe('CLOSED');
    expect(deliveredCall.data.closedAt).toBeInstanceOf(Date);

    expect(closedCall.data.events.create).toEqual(
      expect.objectContaining({ kind: 'CLOSED', actorId: USER.id }),
    );
    expect(closedCall.data.stage).toBe('CLOSED');
    expect(closedCall.data.closedAt).toBeInstanceOf(Date);

    expect(result).toEqual({ id: 'case-1', stage: 'CLOSED' });
  });

  // (c) cancelCase — ใบซ่อม OPEN → repair.cancel({note: reason}); ใบซ่อม IN_PROGRESS → BadRequestException
  describe('(c) cancelCase', () => {
    it('ใบซ่อม OPEN → เรียก repair.cancel(ticketId, { note: reason }, user) แล้ว sync CANCELLED', async () => {
      query.getCase.mockResolvedValue({
        id: 'case-1',
        stage: 'RECEIVED',
        repairTicket: { id: 'rt-1', status: 'OPEN' },
      });
      prisma.repairTicket.findFirst.mockResolvedValue({ status: 'CANCELLED', deletedAt: null });
      prisma.afterSalesCase.update.mockResolvedValue({ id: 'case-1', stage: 'CANCELLED' });

      const dto = { reason: 'ลูกค้าขอยกเลิกเอง ไม่ซ่อมแล้ว' };
      const result = await svc.cancelCase('case-1', dto as never, USER);

      expect(repair.cancel).toHaveBeenCalledWith('rt-1', { note: dto.reason }, USER);
      expect(prisma.afterSalesCase.update).toHaveBeenCalledTimes(1);
      const updateArg = prisma.afterSalesCase.update.mock.calls[0][0];
      expect(updateArg.data.stage).toBe('CANCELLED');
      expect(updateArg.data.cancelledAt).toBeInstanceOf(Date);
      expect(updateArg.data.cancelReason).toBe(dto.reason);
      expect(updateArg.data.events.create).toEqual(
        expect.objectContaining({ kind: 'CANCELLED', note: dto.reason, actorId: USER.id }),
      );
      expect(result).toEqual({ id: 'case-1', stage: 'CANCELLED' });
    });

    it('ใบซ่อม IN_PROGRESS → BadRequestException ข้อความ "ยกเลิกไม่ได้ เครื่องอยู่ที่ศูนย์ — บันทึกส่งซ่อมต่อ/ซ่อมเสร็จก่อน" และไม่แตะ repair.cancel/update', async () => {
      query.getCase.mockResolvedValue({
        id: 'case-1',
        stage: 'IN_REPAIR',
        repairTicket: { id: 'rt-1', status: 'IN_PROGRESS' },
      });

      const dto = { reason: 'ลูกค้าขอยกเลิกเอง ไม่ซ่อมแล้ว' };

      await expect(svc.cancelCase('case-1', dto as never, USER)).rejects.toThrow(
        new BadRequestException(
          'ยกเลิกไม่ได้ เครื่องอยู่ที่ศูนย์ — บันทึกส่งซ่อมต่อ/ซ่อมเสร็จก่อน',
        ),
      );
      expect(repair.cancel).not.toHaveBeenCalled();
      expect(prisma.afterSalesCase.update).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });
  });

  // (d) addPhoto รูปที่ 7 → 400 และไม่ upload
  // M1/M2 (partial) — เคสเปลี่ยนเครื่องที่ไม่มีอะไรฝั่ง engine เลย ต้องยกเลิกได้ (ไม่งั้นบล็อก IMEI ตลอดไป)
  describe('cancelCase — เคสเปลี่ยนเครื่องที่ไม่มีอะไรฝั่ง engine', () => {
    const MGR = { id: 'u-mgr', role: 'BRANCH_MANAGER', branchId: 'b-1' };
    const dto = { reason: 'ลูกค้าไม่มาต่อ ยกเลิกเรื่อง' };
    const exchangeCase = (o: Record<string, unknown> = {}) => ({
      id: 'case-9',
      stage: 'AWAITING_APPROVAL',
      outcome: 'PRICED_EXCHANGE',
      repairTicket: null,
      repairTicketId: null,
      replacementContractId: null,
      exchangeRequestId: null,
      ...o,
    });

    it.each(['PRICED_EXCHANGE', 'SAME_MODEL_EXCHANGE'])(
      '%s ไม่มีใบซ่อม/สัญญาใหม่/คำขอ → CAS ยกเลิก + event CANCELLED ไม่แตะ repair.cancel',
      async (outcome) => {
        query.getCase.mockResolvedValue(exchangeCase({ outcome }));
        prisma.afterSalesCase.update.mockResolvedValue({ id: 'case-9', stage: 'CANCELLED' });

        const result = await svc.cancelCase('case-9', dto as never, MGR);

        expect(prisma.afterSalesCase.updateMany).toHaveBeenCalledWith({
          where: {
            id: 'case-9',
            deletedAt: null,
            outcome,
            repairTicketId: null,
            replacementContractId: null,
            exchangeRequestId: null,
            cancelledAt: null,
            stage: { notIn: ['CLOSED', 'CANCELLED'] },
          },
          data: { stage: 'CANCELLED', cancelledAt: expect.any(Date), cancelReason: dto.reason },
        });
        expect(prisma.afterSalesCase.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'case-9' },
            data: {
              events: { create: { kind: 'CANCELLED', actorId: MGR.id, note: dto.reason } },
            },
          }),
        );
        expect(repair.cancel).not.toHaveBeenCalled();
        expect(result).toEqual({ id: 'case-9', stage: 'CANCELLED' });
        // residual sweep — CAS ไม่ล็อก approvedAt · audit หลัง tx
        expect(prisma.afterSalesCase.updateMany.mock.calls[0][0].where).not.toHaveProperty(
          'approvedAt',
        );
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(audit.log).toHaveBeenCalledWith({
          userId: MGR.id,
          action: 'AFTER_SALES_CASE_CANCELLED',
          entity: 'after_sales_case',
          entityId: 'case-9',
          newValue: { outcome, reason: dto.reason },
        });
        expect(prisma.afterSalesCase.update.mock.invocationCallOrder[0]).toBeLessThan(
          audit.log.mock.invocationCallOrder[0],
        );
      },
    );

    it('residual sweep: เคสจองค้าง (approvedAt ตั้งอยู่ ไม่มีสัญญาใหม่/คำขอ — confirm ล้มแล้วปล่อยจองไม่สำเร็จ) → ยกเลิกได้', async () => {
      query.getCase.mockResolvedValue(
        exchangeCase({
          outcome: 'SAME_MODEL_EXCHANGE',
          approvedAt: new Date('2026-09-24T01:00:00Z'),
          approvedById: 'u-other',
        }),
      );
      prisma.afterSalesCase.update.mockResolvedValue({ id: 'case-9', stage: 'CANCELLED' });

      const result = await svc.cancelCase('case-9', dto as never, MGR);

      expect(result).toEqual({ id: 'case-9', stage: 'CANCELLED' });
      expect(prisma.afterSalesCase.updateMany.mock.calls[0][0].where).not.toHaveProperty(
        'approvedAt',
      );
      expect(audit.log).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['มีคำขอผูกอยู่', { exchangeRequestId: 'req-1' }],
      ['มีสัญญาใหม่แล้ว', { outcome: 'SAME_MODEL_EXCHANGE', replacementContractId: 'ct-new' }],
    ])('%s → 400 ไม่เขียนอะไร', async (_l, o) => {
      query.getCase.mockResolvedValue(exchangeCase(o));
      await expect(svc.cancelCase('case-9', dto as never, MGR)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.afterSalesCase.updateMany).not.toHaveBeenCalled();
      expect(prisma.afterSalesCase.update).not.toHaveBeenCalled();
    });

    it('CAS แพ้ (มีคนยืนยัน/ผูกคำขอไปพร้อมกัน) → 409', async () => {
      query.getCase.mockResolvedValue(exchangeCase());
      prisma.afterSalesCase.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(svc.cancelCase('case-9', dto as never, MGR)).rejects.toThrow(
        'เคสนี้ถูกดำเนินการไปแล้ว',
      );
      expect(prisma.afterSalesCase.update).not.toHaveBeenCalled();
    });
  });

  it('(d) addPhoto เมื่อมีรูปครบ MAX_INTAKE_PHOTOS แล้ว → BadRequestException และไม่ upload/ไม่ update', async () => {
    query.getCase.mockResolvedValue({ id: 'case-1', stage: 'RECEIVED' });
    prisma.afterSalesCase.findUniqueOrThrow.mockResolvedValue({
      photoKeys: Array.from(
        { length: MAX_INTAKE_PHOTOS },
        (_, i) => `after-sales/case-1/intake-${i}.jpg`,
      ),
    });

    await expect(svc.addPhoto('case-1', mockFile(), USER)).rejects.toThrow(
      new BadRequestException(`รูปตอนรับฝากได้ไม่เกิน ${MAX_INTAKE_PHOTOS} รูป`),
    );
    expect(storage.upload).not.toHaveBeenCalled();
    expect(prisma.afterSalesCase.update).not.toHaveBeenCalled();
  });

  // (e) getPhoto(index=5) เมื่อมี 3 รูป → NotFoundException
  it('(e) getPhoto(index=5) เมื่อมี 3 รูป → NotFoundException และไม่เรียก storage.getStream', async () => {
    query.getCase.mockResolvedValue({ id: 'case-1', stage: 'RECEIVED' });
    prisma.afterSalesCase.findUniqueOrThrow.mockResolvedValue({
      photoKeys: ['a.jpg', 'b.jpg', 'c.jpg'],
    });

    await expect(svc.getPhoto('case-1', 5, USER)).rejects.toThrow(
      new NotFoundException('ไม่มีรูปลำดับนี้'),
    );
    expect(storage.getStream).not.toHaveBeenCalled();
  });
});
