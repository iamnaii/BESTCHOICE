import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { PeakService } from './peak.service';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

describe('PeakService', () => {
  let service: PeakService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let integrationConfig: any;

  beforeEach(async () => {
    prisma = {
      journalEntry: {
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    integrationConfig = {
      getValue: jest.fn(async (_ns: string, key: string) => {
        switch (key) {
          case 'baseUrl':
            return 'https://api.peakaccount.com/api/v1';
          case 'userToken':
            return 'testUserToken';
          case 'connectId':
            return 'testConnectId';
          case 'secretKey':
            return 'testSecret';
          default:
            return '';
        }
      }),
    };
    const mod = await Test.createTestingModule({
      providers: [
        PeakService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => '' } },
        { provide: IntegrationConfigService, useValue: integrationConfig },
      ],
    }).compile();
    service = mod.get(PeakService);
  });

  describe('generateTimeSignature (T6-C4)', () => {
    it('signs the time-stamp with secretKey as HMAC key (not connectId)', () => {
      const config = {
        baseUrl: '',
        userToken: '',
        connectId: 'testConnectId',
        secretKey: 'testSecret',
      };
      const timeStamp = '20260419120000';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sig = (service as any).generateTimeSignature(timeStamp, config);

      const expectedWithSecret = createHmac('sha1', 'testSecret').update(timeStamp).digest('hex');
      const legacyBugWithConnectId = createHmac('sha1', 'testConnectId')
        .update(timeStamp)
        .digest('hex');

      expect(sig).toBe(expectedWithSecret);
      expect(sig).not.toBe(legacyBugWithConnectId);
    });

    it('fixture vector: (timeStamp=20260419120000, secretKey=testSecret) → 0c592fa5db6e3cb5b2c10f1a0d79c49b295761a6', () => {
      const config = {
        baseUrl: '',
        userToken: '',
        connectId: 'anyConnectId',
        secretKey: 'testSecret',
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sig = (service as any).generateTimeSignature('20260419120000', config);
      expect(sig).toBe('0c592fa5db6e3cb5b2c10f1a0d79c49b295761a6');
    });

    it('signature is independent of connectId (proves key is secretKey)', () => {
      const configA = {
        baseUrl: '',
        userToken: '',
        connectId: 'connectA',
        secretKey: 'samesecret',
      };
      const configB = {
        baseUrl: '',
        userToken: '',
        connectId: 'connectB',
        secretKey: 'samesecret',
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = service as any;
      expect(s.generateTimeSignature('20260101000000', configA)).toBe(
        s.generateTimeSignature('20260101000000', configB),
      );
    });

    it('signature changes when secretKey changes', () => {
      const config1 = {
        baseUrl: '',
        userToken: '',
        connectId: 'c',
        secretKey: 'secret1',
      };
      const config2 = {
        baseUrl: '',
        userToken: '',
        connectId: 'c',
        secretKey: 'secret2',
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = service as any;
      expect(s.generateTimeSignature('20260101000000', config1)).not.toBe(
        s.generateTimeSignature('20260101000000', config2),
      );
    });
  });

  describe('isConfigured', () => {
    it('returns true when all three credentials present', async () => {
      await expect(service.isConfigured()).resolves.toBe(true);
    });

    it('returns false when secretKey missing', async () => {
      integrationConfig.getValue.mockImplementation(async (_ns: string, key: string) => {
        if (key === 'secretKey') return '';
        return 'x';
      });
      await expect(service.isConfigured()).resolves.toBe(false);
    });
  });

  describe('exportJournalEntries — T6-C5 idempotency', () => {
    beforeEach(() => {
      globalThis.fetch = jest.fn();
    });

    afterEach(() => {
      (globalThis.fetch as jest.Mock).mockReset();
    });

    const mockPeakHeaders = () => {
      // First call: ClientToken, second+: DailyJournals POST
      (globalThis.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.endsWith('/ClientToken')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ clientToken: 'ct-test' }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ resCode: '200', resDesc: 'OK' }),
        });
      });
    };

    it('skips gracefully when PEAK not configured', async () => {
      integrationConfig.getValue.mockResolvedValue('');
      const result = await service.exportJournalEntries(new Date(), new Date());
      expect(result).toEqual({ exported: 0, skipped: 0, errors: ['PEAK ยังไม่ได้ตั้งค่า'] });
    });

    it('returns empty result when no unsynced entries in window', async () => {
      mockPeakHeaders();
      prisma.journalEntry.findMany.mockResolvedValue([]);
      const result = await service.exportJournalEntries(new Date(), new Date());
      expect(result).toEqual({ exported: 0, skipped: 0, errors: [] });
    });

    it('only marks peakSyncedAt when update affects 1 row (race protection)', async () => {
      mockPeakHeaders();
      const entry = {
        id: 'je-1',
        entryNumber: 'JE-001',
        entryDate: new Date('2026-04-18'),
        description: 'Test',
        lines: [
          {
            accountCode: '11-1101',
            description: null,
            debit: { toString: () => '100' },
            credit: { toString: () => '0' },
          },
        ],
      };
      prisma.journalEntry.findMany.mockResolvedValue([entry]);
      prisma.journalEntry.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.exportJournalEntries(new Date(), new Date());

      expect(prisma.journalEntry.updateMany).toHaveBeenCalledWith({
        where: { id: 'je-1', peakSyncedAt: null },
        data: { peakSyncedAt: expect.any(Date) },
      });
      expect(result.exported).toBe(1);
    });

    it('treats concurrent double-sync as no-op (updateMany returns count=0)', async () => {
      mockPeakHeaders();
      prisma.journalEntry.findMany.mockResolvedValue([
        {
          id: 'je-1',
          entryNumber: 'JE-001',
          entryDate: new Date('2026-04-18'),
          description: 'Test',
          lines: [
            {
              accountCode: '11-1101',
              description: null,
              debit: { toString: () => '100' },
              credit: { toString: () => '0' },
            },
          ],
        },
      ]);
      prisma.journalEntry.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.exportJournalEntries(new Date(), new Date());

      expect(result.exported).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it('continues processing remaining entries when one throws', async () => {
      const entries = [
        {
          id: 'je-1',
          entryNumber: 'JE-001',
          entryDate: new Date('2026-04-18'),
          description: 'A',
          lines: [
            {
              accountCode: '11-1101',
              description: null,
              debit: { toString: () => '10' },
              credit: { toString: () => '0' },
            },
          ],
        },
        {
          id: 'je-2',
          entryNumber: 'JE-002',
          entryDate: new Date('2026-04-18'),
          description: 'B',
          lines: [
            {
              accountCode: '11-1101',
              description: null,
              debit: { toString: () => '20' },
              credit: { toString: () => '0' },
            },
          ],
        },
      ];
      prisma.journalEntry.findMany.mockResolvedValue(entries);
      prisma.journalEntry.updateMany.mockResolvedValue({ count: 1 });

      let call = 0;
      (globalThis.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.endsWith('/ClientToken')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ clientToken: 'ct-test' }),
          });
        }
        call++;
        if (call === 1) {
          return Promise.reject(new Error('network'));
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ resCode: '200' }),
        });
      });

      const result = await service.exportJournalEntries(new Date(), new Date());
      expect(result.exported).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('JE-001');
    });

    it('does not mark peakSyncedAt when PEAK returns non-200 resCode', async () => {
      (globalThis.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.endsWith('/ClientToken')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ clientToken: 'ct-test' }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ resCode: '500', resDesc: 'server fail' }),
        });
      });
      prisma.journalEntry.findMany.mockResolvedValue([
        {
          id: 'je-1',
          entryNumber: 'JE-001',
          entryDate: new Date('2026-04-18'),
          description: 'X',
          lines: [
            {
              accountCode: '11-1101',
              description: null,
              debit: { toString: () => '1' },
              credit: { toString: () => '0' },
            },
          ],
        },
      ]);

      const result = await service.exportJournalEntries(new Date(), new Date());
      expect(prisma.journalEntry.updateMany).not.toHaveBeenCalled();
      expect(result.exported).toBe(0);
      expect(result.errors[0]).toContain('server fail');
    });
  });
});
