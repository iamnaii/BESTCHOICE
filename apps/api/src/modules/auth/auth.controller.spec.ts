import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TwoFactorService } from './two-factor.service';

/**
 * T7-C5: Refresh endpoint is cookie-only. Body `refreshToken` is no longer
 * honoured — CSRF exfil risk if SameSite drops. These tests pin the contract.
 */
describe('AuthController /auth/refresh (T7-C5 cookie-only)', () => {
  let controller: AuthController;
  let authService: jest.Mocked<Pick<AuthService, 'refreshToken'>>;

  beforeEach(async () => {
    authService = {
      refreshToken: jest.fn().mockResolvedValue({
        accessToken: 'new-access-token',
        refreshToken: 'rotated-refresh-token',
      }),
    } as unknown as jest.Mocked<Pick<AuthService, 'refreshToken'>>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: TwoFactorService, useValue: { isTwoFactorEnabled: jest.fn() } },
      ],
    }).compile();

    controller = module.get(AuthController);
  });

  function makeReq(overrides: Partial<Request> = {}): Request {
    return {
      cookies: {},
      headers: {},
      ...overrides,
    } as unknown as Request;
  }

  function makeRes(): Response {
    const res = {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    return res as unknown as Response;
  }

  it('accepts valid refresh token from cookie only', async () => {
    const req = makeReq({ cookies: { refresh_token: 'cookie-token' } });
    const res = makeRes();

    const result = await controller.refresh(req, res);

    expect(authService.refreshToken).toHaveBeenCalledTimes(1);
    expect(authService.refreshToken).toHaveBeenCalledWith('cookie-token');
    expect(result).toEqual({ accessToken: 'new-access-token' });
    expect((res.cookie as jest.Mock)).toHaveBeenCalledWith(
      'refresh_token',
      'rotated-refresh-token',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
    );
  });

  it('rejects 401 when no cookie is present (body token not accepted)', async () => {
    const req = makeReq({ cookies: {} });
    const res = makeRes();

    await expect(controller.refresh(req, res)).rejects.toThrow(UnauthorizedException);
    await expect(controller.refresh(req, res)).rejects.toThrow(
      'Refresh token ไม่ถูกต้องหรือหมดอายุ',
    );
    expect(authService.refreshToken).not.toHaveBeenCalled();
  });

  it('ignores body payload and uses cookie only when both present', async () => {
    // Simulate a malicious caller sending a body token hoping we still honor it.
    // The controller signature no longer binds @Body at all — body is invisible to the handler.
    const req = makeReq({
      cookies: { refresh_token: 'good-cookie-token' },
      // body is set on the request object, but controller doesn't read it.
      body: { refreshToken: 'attacker-supplied-token' },
    } as Partial<Request>);
    const res = makeRes();

    await controller.refresh(req, res);

    expect(authService.refreshToken).toHaveBeenCalledTimes(1);
    expect(authService.refreshToken).toHaveBeenCalledWith('good-cookie-token');
    expect(authService.refreshToken).not.toHaveBeenCalledWith('attacker-supplied-token');
  });
});
