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

  it('formats amountDue as TH locale with 2 decimals', async () => {
    prisma.customer.findFirst.mockResolvedValue({ id: 'c-1', name: 'A', phone: null });
    prisma.contract.findFirst.mockResolvedValue({ id: 'con-1', contractNumber: 'BC-001' });
    prisma.payment.findFirst.mockResolvedValue({
      amountDue: 3500,
      dueDate: new Date('2026-05-15'),
      installmentNo: 3,
    });
    const result = await service.expandVariables(
      'ยอด {amountDue} งวด {installmentNo} ครบ {dueDate}',
      { roomId: 'r-1', customerId: 'c-1' },
    );
    expect(result).toContain('3,500.00');
    expect(result).toContain('งวด 3');
    expect(result).toContain('15/05/2026');
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
});
