import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ContractLetterService } from './contract-letter.service';

const mockPrisma = {
  contractLetter: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
};

describe('ContractLetterService', () => {
  let service: ContractLetterService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractLetterService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(ContractLetterService);
  });

  describe('createIfNotExists', () => {
    it('returns existing letter if present (idempotent)', async () => {
      const existing = { id: 'letter-1', contractId: 'c1', letterType: 'RETURN_DEVICE_45D' };
      mockPrisma.contractLetter.findUnique.mockResolvedValueOnce(existing);

      const result = await service.createIfNotExists('c1', 'RETURN_DEVICE_45D');
      expect(result).toBe(existing);
      expect(mockPrisma.contractLetter.create).not.toHaveBeenCalled();
    });

    it('creates with sequential letterNumber ST-YYYY-NNNNN when none exists', async () => {
      mockPrisma.contractLetter.findUnique.mockResolvedValueOnce(null);
      mockPrisma.contractLetter.count.mockResolvedValueOnce(4);
      mockPrisma.contractLetter.create.mockResolvedValueOnce({ id: 'letter-2', letterNumber: 'x' });

      await service.createIfNotExists('c2', 'RETURN_DEVICE_45D');

      const createArg = mockPrisma.contractLetter.create.mock.calls[0][0];
      expect(createArg.data.letterNumber).toMatch(/^ST-\d{4}-\d{5}$/);
      expect(createArg.data.letterNumber.endsWith('00005')).toBe(true);
      expect(createArg.data.status).toBe('PENDING_DISPATCH');
    });
  });

  describe('cancel', () => {
    it('cancels when in PENDING_DISPATCH', async () => {
      mockPrisma.contractLetter.findUnique.mockResolvedValueOnce({
        id: 'letter-3', status: 'PENDING_DISPATCH',
      });
      mockPrisma.contractLetter.update.mockResolvedValueOnce({ id: 'letter-3', status: 'CANCELLED' });

      const result = await service.cancel('letter-3', 'u1', 'ลูกค้าชำระครบแล้ว');
      expect(result.status).toBe('CANCELLED');
      const updateArg = mockPrisma.contractLetter.update.mock.calls[0][0];
      expect(updateArg.data.cancelReason).toBe('ลูกค้าชำระครบแล้ว');
    });

    it('throws when letter is DISPATCHED', async () => {
      mockPrisma.contractLetter.findUnique.mockResolvedValueOnce({
        id: 'letter-4', status: 'DISPATCHED',
      });
      await expect(service.cancel('letter-4', 'u1', 'ลูกค้าชำระครบแล้ว')).rejects.toThrow(/ยกเลิก/);
    });

    it('requires reason length ≥ 5', async () => {
      mockPrisma.contractLetter.findUnique.mockResolvedValueOnce({
        id: 'letter-5', status: 'PENDING_DISPATCH',
      });
      await expect(service.cancel('letter-5', 'u1', 'no')).rejects.toThrow(/เหตุผล/);
    });

    it('throws NotFound when letter missing', async () => {
      mockPrisma.contractLetter.findUnique.mockResolvedValueOnce(null);
      await expect(service.cancel('nope', 'u1', 'abcde')).rejects.toThrow(/ไม่พบหนังสือ/);
    });
  });
});
