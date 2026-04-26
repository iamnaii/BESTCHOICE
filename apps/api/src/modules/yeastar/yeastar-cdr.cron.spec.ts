import { YeastarCdrCron } from './yeastar-cdr.cron';
import { YeastarService } from './yeastar.service';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { StorageService } from '../storage/storage.service';

const mockYeastarService = {
  queryCdr: jest.fn(),
  downloadRecording: jest.fn(),
} as unknown as YeastarService;

const mockPrisma = {
  callLog: {
    upsert: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    update: jest.fn(),
  },
  customer: { findFirst: jest.fn() },
  contract: { findFirst: jest.fn() },
  user: { findFirst: jest.fn() },
} as unknown as PrismaService;

const mockConfigService = {
  isConfigured: jest.fn().mockResolvedValue(true),
} as unknown as IntegrationConfigService;

const mockStorage = {
  upload: jest.fn().mockResolvedValue('key'),
  configured: true,
} as unknown as StorageService;

describe('YeastarCdrCron', () => {
  let cron: YeastarCdrCron;

  beforeEach(() => {
    cron = new YeastarCdrCron(mockYeastarService, mockPrisma, mockConfigService, mockStorage);
    jest.clearAllMocks();
  });

  it('skips run if Yeastar not configured', async () => {
    (mockConfigService.isConfigured as jest.Mock).mockResolvedValueOnce(false);
    await cron.pullCdr();
    expect(mockYeastarService.queryCdr).not.toHaveBeenCalled();
  });

  it('processes CDR records and upserts CallLog', async () => {
    (mockYeastarService.queryCdr as jest.Mock).mockResolvedValue([
      {
        id: 'cdr-1',
        callFrom: '0812345678',
        callTo: '1001',
        callType: 'Inbound',
        startTime: '2026-04-25T10:00:00Z',
        duration: 120,
        talkDuration: 100,
      },
    ]);
    (mockPrisma.customer.findFirst as jest.Mock).mockResolvedValue({ id: 'cust-1' });
    (mockPrisma.contract.findFirst as jest.Mock).mockResolvedValue({ id: 'con-1' });
    (mockPrisma.user.findFirst as jest.Mock).mockResolvedValue({ id: 'user-1' });

    await cron.pullCdr();

    expect(mockPrisma.callLog.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { yeastarCallId: 'cdr-1' },
      }),
    );
  });
});
