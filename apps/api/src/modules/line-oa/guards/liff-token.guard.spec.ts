import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { LineChannelType } from '@prisma/client';
import { LiffTokenGuard } from './liff-token.guard';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * T6-C15: LIFF cross-company boundary check
 *
 * The guard, when a handler is tagged with @LiffChannel, must refuse to serve
 * a lineUserId that is already linked to a customer on a different channel.
 */
describe('LiffTokenGuard — channel boundary (T6-C15)', () => {
  let guard: LiffTokenGuard;
  let reflector: Reflector;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const config = {
    get: jest.fn().mockReturnValue('liff-channel-id'),
  } as unknown as ConfigService;

  beforeEach(() => {
    reflector = new Reflector();
    prisma = {
      customerLineLink: {
        findMany: jest.fn(),
      },
    };
    guard = new LiffTokenGuard(config, reflector, prisma as PrismaService);

    // Seed the cache so we skip the LINE API fetch entirely
    const now = Date.now();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (guard as any).cache.set('cached-token', {
      lineUserId: 'U_line_123',
      expiresAt: now + 60_000,
    });
  });

  function mockContext(
    expectedChannel: LineChannelType | undefined,
    idToken = 'cached-token',
  ): ExecutionContext {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req: any = {
      headers: { 'x-liff-id-token': idToken },
    };
    const handler = () => undefined;
    const controllerClass = class TestController {};
    if (expectedChannel) {
      Reflect.defineMetadata('liffChannel', expectedChannel, handler);
      Reflect.defineMetadata('liffChannel', expectedChannel, controllerClass);
    }
    return {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => handler,
      getClass: () => controllerClass,
    } as unknown as ExecutionContext;
  }

  it('allows when link channel matches expected (FINANCE → FINANCE)', async () => {
    prisma.customerLineLink.findMany.mockResolvedValue([
      { channel: LineChannelType.FINANCE },
    ]);
    const ctx = mockContext(LineChannelType.FINANCE);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = (ctx.switchToHttp().getRequest() as any);
    expect(req.liffUserId).toBe('U_line_123');
  });

  it('rejects when link exists on different channel (SHOP link → FINANCE endpoint)', async () => {
    prisma.customerLineLink.findMany.mockResolvedValue([
      { channel: LineChannelType.SHOP },
    ]);
    const ctx = mockContext(LineChannelType.FINANCE);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(ctx)).rejects.toThrow('ไม่สามารถเข้าถึงข้อมูลได้');
  });

  it('allows when no CustomerLineLink exists (registration flow)', async () => {
    prisma.customerLineLink.findMany.mockResolvedValue([]);
    const ctx = mockContext(LineChannelType.FINANCE);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('skips boundary check when handler has no @LiffChannel metadata', async () => {
    const ctx = mockContext(undefined);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(prisma.customerLineLink.findMany).not.toHaveBeenCalled();
  });
});
