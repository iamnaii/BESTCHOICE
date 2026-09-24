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
  let svc: AfterSalesRepairService;

  beforeEach(() => {
    jest.clearAllMocks();

    prisma = {
      repairTicket: { findFirst: jest.fn() },
      afterSalesCase: {
        update: jest.fn(),
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

    svc = new AfterSalesRepairService(
      prisma as never,
      storage as never,
      repair as never,
      query as never,
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
    });
  });

  // (d) addPhoto รูปที่ 7 → 400 และไม่ upload
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
