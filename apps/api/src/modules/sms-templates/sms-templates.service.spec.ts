import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SmsTemplatesService } from './sms-templates.service';

const mockPrisma = {
  smsTemplate: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
};

describe('SmsTemplatesService', () => {
  let service: SmsTemplatesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        SmsTemplatesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = moduleRef.get(SmsTemplatesService);
  });

  describe('CRUD', () => {
    it('rejects create when name already exists (uniqueness)', async () => {
      mockPrisma.smsTemplate.findFirst.mockResolvedValueOnce({ id: 'existing' });

      await expect(
        service.create({
          name: 'Reminder D-3',
          channel: 'LINE',
          body: 'สวัสดี {{customerName}}',
          variables: [{ name: 'customerName', label: 'ชื่อลูกค้า' }],
        }),
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.smsTemplate.create).not.toHaveBeenCalled();
    });

    it('soft-deletes by setting deletedAt and active=false', async () => {
      mockPrisma.smsTemplate.findFirst.mockResolvedValueOnce({
        id: 't1',
        deletedAt: null,
        name: 'Reminder',
      });
      mockPrisma.smsTemplate.update.mockResolvedValueOnce({
        id: 't1',
        deletedAt: new Date('2026-04-25T00:00:00Z'),
      });

      const result = await service.remove('t1');

      const arg = mockPrisma.smsTemplate.update.mock.calls[0][0];
      expect(arg.where.id).toBe('t1');
      expect(arg.data.deletedAt).toBeInstanceOf(Date);
      expect(arg.data.active).toBe(false);
      expect(result.id).toBe('t1');
    });
  });

  describe('preview', () => {
    it('renders {{variable}} placeholders against sample data and falls back to defaults', async () => {
      mockPrisma.smsTemplate.findFirst.mockResolvedValueOnce({
        id: 't1',
        deletedAt: null,
        body: 'สวัสดี {{customerName}} ยอด {{amount}} บาท สัญญา {{contractNumber}}',
      });

      const result = await service.preview('t1', { customerName: 'นาย ก' });

      // user-supplied wins
      expect(result.rendered).toContain('นาย ก');
      // default fallback fills in others
      expect(result.rendered).toContain('5,400');
      expect(result.rendered).toContain('CT-2026-000123');
      // unknown variables left as-is to surface typos
      const unknownTpl = service.renderTemplate('hi {{nonexistent}}', { other: 'x' });
      expect(unknownTpl).toBe('hi {{nonexistent}}');
    });
  });

  describe('createVariant', () => {
    it('creates an A/B variant linked to parent (variantOf), inheriting channel + variables', async () => {
      mockPrisma.smsTemplate.findFirst
        // parent lookup
        .mockResolvedValueOnce({
          id: 'parent1',
          name: 'Reminder D-3',
          channel: 'LINE',
          subject: null,
          body: 'parent body',
          variables: [{ name: 'customerName', label: 'ชื่อลูกค้า' }],
          variantOf: null,
        })
        // resolveUniqueName → no conflict
        .mockResolvedValueOnce(null);
      mockPrisma.smsTemplate.create.mockResolvedValueOnce({
        id: 'variant1',
        variantOf: 'parent1',
      });

      const result = await service.createVariant('parent1', { body: 'variant body' });

      const arg = mockPrisma.smsTemplate.create.mock.calls[0][0];
      expect(arg.data.variantOf).toBe('parent1');
      expect(arg.data.channel).toBe('LINE');
      expect(arg.data.body).toBe('variant body');
      expect(arg.data.name).toBe('Reminder D-3 (variant)');
      expect(result.id).toBe('variant1');
    });

    it('refuses to create a variant of a variant (single-layer enforcement)', async () => {
      mockPrisma.smsTemplate.findFirst.mockResolvedValueOnce({
        id: 'variant1',
        variantOf: 'parent1',
      });

      await expect(
        service.createVariant('variant1', {}),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.smsTemplate.create).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('rejects invalid channel filter', async () => {
      await expect(service.list('INVALID')).rejects.toThrow(BadRequestException);
    });
  });

  describe('findOne', () => {
    it('throws NotFound when missing', async () => {
      mockPrisma.smsTemplate.findFirst.mockResolvedValueOnce(null);
      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });
});
