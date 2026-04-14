import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DunningRuleService } from './dunning-rule.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DunningChannel } from '@prisma/client';

const mockPrismaService = {
  dunningRule: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

describe('DunningRuleService', () => {
  let service: DunningRuleService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DunningRuleService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<DunningRuleService>(DunningRuleService);
    jest.clearAllMocks();
  });

  // Test 1: findAll — returns only non-deleted rules ordered by sortOrder
  describe('findAll', () => {
    it('should return non-deleted rules ordered by sortOrder asc', async () => {
      const mockRules = [
        { id: 'rule-1', name: 'Rule A', sortOrder: 0, deletedAt: null },
        { id: 'rule-2', name: 'Rule B', sortOrder: 1, deletedAt: null },
      ];
      mockPrismaService.dunningRule.findMany.mockResolvedValue(mockRules);

      const result = await service.findAll();

      expect(mockPrismaService.dunningRule.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null },
        orderBy: { sortOrder: 'asc' },
      });
      expect(result).toEqual(mockRules);
      expect(result).toHaveLength(2);
    });
  });

  // Test 2: findActiveRulesForDay — returns matching active rules
  describe('findActiveRulesForDay', () => {
    it('should return active non-deleted rules matching the given triggerDay', async () => {
      const triggerDay = 3;
      const mockRules = [
        { id: 'rule-1', name: 'Day 3 Rule', triggerDay: 3, isActive: true, deletedAt: null },
      ];
      mockPrismaService.dunningRule.findMany.mockResolvedValue(mockRules);

      const result = await service.findActiveRulesForDay(triggerDay);

      expect(mockPrismaService.dunningRule.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null, isActive: true, triggerDay },
        orderBy: { sortOrder: 'asc' },
      });
      expect(result).toEqual(mockRules);
    });
  });

  // Test 3: create — creates new rule
  describe('create', () => {
    it('should create and return a new dunning rule', async () => {
      const dto = {
        name: 'แจ้งเตือน 3 วันก่อนครบกำหนด',
        triggerDay: -3,
        channel: DunningChannel.LINE,
        messageTemplate: 'กรุณาชำระค่างวดของท่านภายใน 3 วัน',
      };
      const created = {
        id: 'new-rule-id',
        ...dto,
        includePaymentLink: false,
        autoExecute: true,
        escalateTo: null,
        isActive: true,
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      mockPrismaService.dunningRule.create.mockResolvedValue(created);

      const result = await service.create(dto);

      expect(mockPrismaService.dunningRule.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: dto.name,
          triggerDay: dto.triggerDay,
          channel: dto.channel,
          messageTemplate: dto.messageTemplate,
        }),
      });
      expect(result).toEqual(created);
    });
  });

  // Test 4: update — updates existing rule; throws for deleted/missing rule
  describe('update', () => {
    it('should update and return the rule when it exists', async () => {
      const id = 'existing-rule-id';
      const existing = { id, name: 'Old Name', deletedAt: null };
      const dto = { name: 'New Name', isActive: false };
      const updated = { ...existing, ...dto };

      mockPrismaService.dunningRule.findFirst.mockResolvedValue(existing);
      mockPrismaService.dunningRule.update.mockResolvedValue(updated);

      const result = await service.update(id, dto);

      expect(mockPrismaService.dunningRule.findFirst).toHaveBeenCalledWith({
        where: { id, deletedAt: null },
      });
      expect(mockPrismaService.dunningRule.update).toHaveBeenCalledWith({
        where: { id },
        data: expect.objectContaining({ name: 'New Name', isActive: false }),
      });
      expect(result).toEqual(updated);
    });

    it('should throw NotFoundException when rule does not exist or is deleted', async () => {
      mockPrismaService.dunningRule.findFirst.mockResolvedValue(null);

      await expect(service.update('missing-id', { name: 'Test' })).rejects.toThrow(
        new NotFoundException('ไม่พบ Dunning Rule'),
      );
      expect(mockPrismaService.dunningRule.update).not.toHaveBeenCalled();
    });
  });

  // Test 5: softDelete — sets deletedAt; throws for missing rule
  describe('softDelete', () => {
    it('should set deletedAt when rule exists', async () => {
      const id = 'rule-to-delete';
      const existing = { id, name: 'Some Rule', deletedAt: null };
      const deleted = { ...existing, deletedAt: new Date() };

      mockPrismaService.dunningRule.findFirst.mockResolvedValue(existing);
      mockPrismaService.dunningRule.update.mockResolvedValue(deleted);

      const result = await service.softDelete(id);

      expect(mockPrismaService.dunningRule.findFirst).toHaveBeenCalledWith({
        where: { id, deletedAt: null },
      });
      expect(mockPrismaService.dunningRule.update).toHaveBeenCalledWith({
        where: { id },
        data: { deletedAt: expect.any(Date) },
      });
      expect(result.deletedAt).toBeTruthy();
    });

    it('should throw NotFoundException when rule is missing', async () => {
      mockPrismaService.dunningRule.findFirst.mockResolvedValue(null);

      await expect(service.softDelete('non-existent-id')).rejects.toThrow(
        new NotFoundException('ไม่พบ Dunning Rule'),
      );
      expect(mockPrismaService.dunningRule.update).not.toHaveBeenCalled();
    });
  });
});
