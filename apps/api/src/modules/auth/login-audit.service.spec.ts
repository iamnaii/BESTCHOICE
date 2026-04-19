import { Test, TestingModule } from '@nestjs/testing';
import { LoginAuditService } from './login-audit.service';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
}));

describe('LoginAuditService.record', () => {
  let service: LoginAuditService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      loginAuditLog: { create: jest.fn().mockResolvedValue({ id: 'la-1' }) },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [LoginAuditService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(LoginAuditService);
  });

  it('persists success entry', async () => {
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
    await service.record({
      emailTried: 'x@x',
      success: true,
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
});
