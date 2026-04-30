import { Test } from '@nestjs/testing';
import { NotificationTemplateService } from './notification-template.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

describe('NotificationTemplateService', () => {
  let service: NotificationTemplateService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      notificationTemplate: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationTemplateService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(NotificationTemplateService);
  });

  describe('findByEventType', () => {
    it('returns template when found', async () => {
      const tpl = { id: 't1', eventType: 'dunning.reminder', isActive: true };
      prisma.notificationTemplate.findUnique.mockResolvedValueOnce(tpl);
      const result = await service.findByEventType('dunning.reminder');
      expect(result).toEqual(tpl);
    });

    it('returns null when not found', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValueOnce(null);
      const result = await service.findByEventType('missing.template');
      expect(result).toBeNull();
    });
  });

  describe('renderPreview', () => {
    it('renders template with sampleData', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValueOnce({
        eventType: 'dunning.reminder',
        messageTemplate: 'Hi ${name}, you owe ${amount}',
        sampleData: { name: 'John', amount: '1500' },
        format: 'text',
      });
      const result = await service.renderPreview('dunning.reminder');
      expect(result.rendered).toBe('Hi John, you owe 1500');
    });

    it('throws NotFoundException for missing template', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValueOnce(null);
      await expect(service.renderPreview('missing.template')).rejects.toThrow(NotFoundException);
    });

    it('uses overrideData if provided', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValueOnce({
        eventType: 'dunning.reminder',
        messageTemplate: 'Hi ${name}',
        sampleData: { name: 'Sample' },
        format: 'text',
      });
      const result = await service.renderPreview('dunning.reminder', { name: 'Custom' });
      expect(result.rendered).toBe('Hi Custom');
    });

    it('leaves missing variables as ${var} literal', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValueOnce({
        eventType: 'test',
        messageTemplate: 'Hi ${name}, ${missing}',
        sampleData: { name: 'John' },
        format: 'text',
      });
      const result = await service.renderPreview('test');
      expect(result.rendered).toBe('Hi John, ${missing}');
    });
  });

  describe('extractVariables', () => {
    it('parses ${var} placeholders ordered + deduplicated', () => {
      const vars = service.extractVariables('Hi ${name}, you owe ${amount} for ${name}');
      expect(vars).toEqual(['name', 'amount']);
    });

    it('returns empty for template without placeholders', () => {
      expect(service.extractVariables('No placeholders here')).toEqual([]);
    });
  });

  describe('softDelete', () => {
    it('throws NotFoundException for missing template', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValueOnce(null);
      await expect(service.softDelete('missing.template')).rejects.toThrow(NotFoundException);
    });
  });
});
