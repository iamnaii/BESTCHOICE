import { Test, TestingModule } from '@nestjs/testing';
import { CannedResponseVariableService } from './canned-response-variable.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('CannedResponseVariableService.expandVariables', () => {
  let service: CannedResponseVariableService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      customer: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      contract: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      payment: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      chatRoom: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        CannedResponseVariableService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = mod.get(CannedResponseVariableService);
  });

  it('returns template unchanged when no { variables', async () => {
    const result = await service.expandVariables('สวัสดีครับ', {
      roomId: 'r-1',
      customerId: 'c-1',
    });
    expect(result).toBe('สวัสดีครับ');
    expect(prisma.customer.findFirst).not.toHaveBeenCalled();
  });

  it('replaces unknown variables with "-"', async () => {
    const result = await service.expandVariables(
      'hi {customerName} / {unknownVar}',
      { roomId: 'r-1' },
    );
    expect(result).toBe('hi - / -');
  });

  it('substitutes customer fields when customerId provided', async () => {
    prisma.customer.findFirst.mockResolvedValue({
      id: 'c-1',
      name: 'สมชาย',
      phone: '0891234567',
    });
    const result = await service.expandVariables(
      'คุณ{customerName} เบอร์ {customerPhone}',
      { roomId: 'r-1', customerId: 'c-1' },
    );
    expect(result).toBe('คุณสมชาย เบอร์ 0891234567');
  });

  it('falls back to "ลูกค้า" / "-" when customer field is null', async () => {
    prisma.customer.findFirst.mockResolvedValue({
      id: 'c-1',
      name: null,
      phone: null,
    });
    const result = await service.expandVariables(
      'คุณ{customerName} เบอร์ {customerPhone}',
      { roomId: 'r-1', customerId: 'c-1' },
    );
    expect(result).toBe('คุณลูกค้า เบอร์ -');
  });

  it('substitutes contract number when active contract exists', async () => {
    prisma.customer.findFirst.mockResolvedValue({ id: 'c-1', name: 'A', phone: null });
    prisma.contract.findFirst.mockResolvedValue({ id: 'con-1', contractNumber: 'BC-0001' });
    const result = await service.expandVariables(
      'สัญญา {contractNumber}',
      { roomId: 'r-1', customerId: 'c-1' },
    );
    expect(result).toBe('สัญญา BC-0001');
  });

  it('formats amountDue with thousands separators and 2 decimals (พ.ศ. dueDate)', async () => {
    prisma.customer.findFirst.mockResolvedValue({ id: 'c-1', name: 'A', phone: null });
    prisma.contract.findFirst.mockResolvedValue({ id: 'con-1', contractNumber: 'BC-001' });
    prisma.payment.findFirst.mockResolvedValue({
      amountDue: 3500,
      // 2026-05-15T12:00:00Z → BKK 19:00 May 15 → still May 15 in BKK
      dueDate: new Date('2026-05-15T12:00:00Z'),
      installmentNo: 3,
    });
    const result = await service.expandVariables(
      'ยอด {amountDue} งวด {installmentNo} ครบ {dueDate}',
      { roomId: 'r-1', customerId: 'c-1' },
    );
    expect(result).toContain('3,500.00');
    expect(result).toContain('งวด 3');
    // 2026 (ค.ศ.) + 543 = 2569 (พ.ศ.)
    expect(result).toContain('15/05/2569');
  });

  it('formats Prisma.Decimal amountDue without losing precision (no Number cast)', async () => {
    prisma.customer.findFirst.mockResolvedValue({ id: 'c-1', name: 'A', phone: null });
    prisma.contract.findFirst.mockResolvedValue({ id: 'con-1', contractNumber: 'BC-001' });
    // Simulate a Prisma.Decimal — value exposed via toString() to preserve precision
    const fakeDecimal = { toString: () => '1234567.5' } as unknown as number;
    prisma.payment.findFirst.mockResolvedValue({
      amountDue: fakeDecimal,
      dueDate: new Date('2026-05-15T12:00:00Z'),
      installmentNo: 1,
    });
    const result = await service.expandVariables('{amountDue}', {
      roomId: 'r-1',
      customerId: 'c-1',
    });
    expect(result).toBe('1,234,567.50');
  });

  it('formats dueDate in Asia/Bangkok timezone (BKK = UTC+7)', async () => {
    prisma.customer.findFirst.mockResolvedValue({ id: 'c-1', name: 'A', phone: null });
    prisma.contract.findFirst.mockResolvedValue({ id: 'con-1', contractNumber: 'BC-001' });
    prisma.payment.findFirst.mockResolvedValue({
      amountDue: 100,
      // 2026-05-15T18:00:00Z → BKK 2026-05-16 01:00 → next day in BKK
      dueDate: new Date('2026-05-15T18:00:00Z'),
      installmentNo: 1,
    });
    const result = await service.expandVariables('{dueDate}', {
      roomId: 'r-1',
      customerId: 'c-1',
    });
    expect(result).toBe('16/05/2569');
  });

  it('swallows DB errors and replaces variables with "-"', async () => {
    prisma.customer.findFirst.mockRejectedValue(new Error('db down'));
    const result = await service.expandVariables(
      'คุณ{customerName}',
      { roomId: 'r-1', customerId: 'c-1' },
    );
    expect(result).toBe('คุณ-');
  });

  it('no customerId → all variables become "-"', async () => {
    const result = await service.expandVariables(
      '{customerName}/{contractNumber}/{amountDue}',
      { roomId: 'r-1' },
    );
    expect(result).toBe('-/-/-');
    expect(prisma.customer.findFirst).not.toHaveBeenCalled();
  });

  it('queries only ACTIVE + non-deleted contract', async () => {
    prisma.customer.findFirst.mockResolvedValue({ id: 'c-1', name: 'A', phone: null });
    await service.expandVariables('{contractNumber}', {
      roomId: 'r-1',
      customerId: 'c-1',
    });
    const contractWhere = prisma.contract.findFirst.mock.calls[0][0].where;
    expect(contractWhere.status).toBe('ACTIVE');
    expect(contractWhere.deletedAt).toBeNull();
  });

  describe('{branchName} expansion', () => {
    it('expands {branchName} from assignedTo.branch.name when room has assigned staff with branch', async () => {
      prisma.customer.findFirst.mockResolvedValue({
        id: 'c1',
        name: 'สมชาย',
        phone: '0812345678',
      });
      prisma.contract.findFirst.mockResolvedValue(null);
      prisma.chatRoom.findFirst.mockResolvedValue({
        id: 'r1',
        assignedTo: { branch: { name: 'ลาดพร้าว' } },
      });

      const result = await service.expandVariables(
        'รับเครื่องที่สาขา {branchName} ครับ',
        { roomId: 'r1', customerId: 'c1' },
      );

      expect(result).toBe('รับเครื่องที่สาขา ลาดพร้าว ครับ');
    });

    it('falls back to "-" when room has no assigned staff', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'c1', name: 'สมชาย', phone: '0' });
      prisma.contract.findFirst.mockResolvedValue(null);
      prisma.chatRoom.findFirst.mockResolvedValue({ id: 'r1', assignedTo: null });

      const result = await service.expandVariables(
        'สาขา {branchName}',
        { roomId: 'r1', customerId: 'c1' },
      );

      expect(result).toBe('สาขา -');
    });
  });
});
