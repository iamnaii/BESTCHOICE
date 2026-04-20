import { Test, TestingModule } from '@nestjs/testing';
import { LoginAuditService } from './login-audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LineOaService } from '../line-oa/line-oa.service';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
}));

describe('LoginAuditService.record', () => {
  let service: LoginAuditService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lineOaService: any;

  beforeEach(async () => {
    prisma = {
      loginAuditLog: { create: jest.fn().mockResolvedValue({ id: 'la-1' }) },
      knownDevice: {
        findUnique: jest.fn().mockResolvedValue(null), // default: new device
        upsert: jest.fn().mockResolvedValue({ id: 'kd-1', loginCount: 1 }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          email: 'test@example.com',
          name: 'Test User',
          role: 'SALES',
        }),
      },
    };
    lineOaService = {
      pushMessage: jest.fn().mockResolvedValue(undefined),
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        LoginAuditService,
        { provide: PrismaService, useValue: prisma },
        { provide: LineOaService, useValue: lineOaService },
      ],
    }).compile();
    service = mod.get(LoginAuditService);
  });

  it('persists success entry', async () => {
    prisma.knownDevice.findUnique.mockResolvedValue({ id: 'kd-existing' }); // known device
    await service.record({
      userId: 'u-1',
      emailTried: 'test@example.com',
      success: true,
      ipAddress: '1.2.3.4',
    });
    const data = prisma.loginAuditLog.create.mock.calls[0][0].data;
    expect(data.userId).toBe('u-1');
    expect(data.success).toBe(true);
    expect(data.failureKind).toBeNull();
  });

  it('persists failure entry with kind', async () => {
    await service.record({
      emailTried: 'attacker@example.com',
      success: false,
      failureKind: 'wrong_password',
      ipAddress: '9.9.9.9',
    });
    const data = prisma.loginAuditLog.create.mock.calls[0][0].data;
    expect(data.success).toBe(false);
    expect(data.failureKind).toBe('wrong_password');
    expect(data.userId).toBeNull();
  });

  it('truncates long userAgent to 500 chars', async () => {
    prisma.knownDevice.findUnique.mockResolvedValue({ id: 'kd-existing' }); // known device
    await service.record({
      emailTried: 'x@x',
      success: true,
      userId: 'u-1',
      userAgent: 'x'.repeat(2000),
    });
    expect(prisma.loginAuditLog.create.mock.calls[0][0].data.userAgent.length).toBe(500);
  });

  it('swallows DB failure (never blocks login)', async () => {
    prisma.loginAuditLog.create.mockRejectedValue(new Error('db down'));
    await expect(
      service.record({ emailTried: 'x@x', success: true }),
    ).resolves.toBeUndefined();
  });

  // ─── New device fingerprinting tests ─────────────────────────────────────────

  it('new device: marks isNewDevice=true, creates KnownDevice, triggers LINE alert', async () => {
    const origEnv = process.env.SHOP_STAFF_LINE_ID;
    process.env.SHOP_STAFF_LINE_ID = 'U-staff-line-id';

    // knownDevice.findUnique returns null → new device
    prisma.knownDevice.findUnique.mockResolvedValue(null);

    await service.record({
      userId: 'u-new',
      emailTried: 'new@example.com',
      success: true,
      ipAddress: '10.0.0.1',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/124.0.0.0',
      acceptLanguage: 'th-TH',
    });

    // Should have upserted a KnownDevice
    expect(prisma.knownDevice.upsert).toHaveBeenCalledTimes(1);

    // The audit log should record isNewDevice = true
    const logData = prisma.loginAuditLog.create.mock.calls[0][0].data;
    expect(logData.isNewDevice).toBe(true);

    // Wait for fire-and-forget to settle
    await new Promise((r) => setImmediate(r));

    // LINE alert should have been sent
    expect(lineOaService.pushMessage).toHaveBeenCalledTimes(1);
    const [lineId, messages] = lineOaService.pushMessage.mock.calls[0];
    expect(lineId).toBe('U-staff-line-id');
    expect(messages[0].type).toBe('text');
    // message is built from the mocked user (test@example.com / Test User)
    expect(messages[0].text).toContain('test@example.com');
    expect(messages[0].text).toContain('แจ้งเตือน');

    process.env.SHOP_STAFF_LINE_ID = origEnv;
  });

  it('repeat device: marks isNewDevice=false, increments loginCount, no LINE alert', async () => {
    // findUnique returns existing record → repeat device
    prisma.knownDevice.findUnique.mockResolvedValue({ id: 'kd-existing' });

    await service.record({
      userId: 'u-repeat',
      emailTried: 'repeat@example.com',
      success: true,
      ipAddress: '10.0.0.2',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/124',
    });

    // KnownDevice upsert still called (to increment loginCount)
    expect(prisma.knownDevice.upsert).toHaveBeenCalledTimes(1);
    const upsertCall = prisma.knownDevice.upsert.mock.calls[0][0];
    expect(upsertCall.update.loginCount).toEqual({ increment: 1 });

    const logData = prisma.loginAuditLog.create.mock.calls[0][0].data;
    expect(logData.isNewDevice).toBe(false);

    // No LINE alert for repeat device
    await new Promise((r) => setImmediate(r));
    expect(lineOaService.pushMessage).not.toHaveBeenCalled();
  });

  it('failed login: does NOT create KnownDevice (security)', async () => {
    await service.record({
      userId: 'u-attacker',
      emailTried: 'victim@example.com',
      success: false,
      failureKind: 'wrong_password',
      ipAddress: '5.5.5.5',
    });

    // knownDevice should not be touched on failed login
    expect(prisma.knownDevice.findUnique).not.toHaveBeenCalled();
    expect(prisma.knownDevice.upsert).not.toHaveBeenCalled();

    // LINE alert should not be sent
    await new Promise((r) => setImmediate(r));
    expect(lineOaService.pushMessage).not.toHaveBeenCalled();
  });
});
