import 'reflect-metadata';
import { HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { IntercompanyController } from './intercompany.controller';
import { IntercompanyService } from './intercompany.service';

/**
 * `POST /accounting/intercompany/settle` retired 2026-07-30 — replaced by
 * the "จ่ายให้หน้าร้าน (INTER-CO)" batch menu (`interco-settlement` module).
 * This spec proves (a) the route now always answers 410 GONE instead of
 * silently doing nothing or 404ing, and (b) `GET /balance` still delegates
 * normally to the (reformulated) `getOutstandingBalance`.
 */
describe('IntercompanyController', () => {
  const reflector = new Reflector();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let service: any;
  let controller: IntercompanyController;

  const methodRoles = (methodName: string): string[] | undefined => {
    const handler = (IntercompanyController.prototype as unknown as Record<string, unknown>)[
      methodName
    ];
    if (typeof handler !== 'function') return undefined;
    return reflector.get<string[]>(ROLES_KEY, handler as () => void);
  };

  beforeEach(() => {
    service = { getOutstandingBalance: jest.fn().mockResolvedValue({ balanced: true }) };
    controller = new IntercompanyController(service as unknown as IntercompanyService);
  });

  it('GET /balance allows OWNER, FINANCE_MANAGER, ACCOUNTANT — not SALES', () => {
    const roles = methodRoles('getBalance');
    expect(roles).toEqual(expect.arrayContaining(['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']));
    expect(roles).not.toContain('SALES');
  });

  it('GET /balance delegates to the (reformulated) getOutstandingBalance', async () => {
    const result = await controller.getBalance();
    expect(service.getOutstandingBalance).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ balanced: true });
  });

  it('POST /settle allows OWNER, FINANCE_MANAGER — not ACCOUNTANT/SALES', () => {
    const roles = methodRoles('settle');
    expect(roles).toEqual(expect.arrayContaining(['OWNER', 'FINANCE_MANAGER']));
    expect(roles).not.toContain('ACCOUNTANT');
    expect(roles).not.toContain('SALES');
  });

  it('POST /settle always throws 410 GONE pointing at the new menu', () => {
    expect(() => controller.settle()).toThrow(HttpException);
    try {
      controller.settle();
      fail('expected settle() to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      const httpErr = err as HttpException;
      expect(httpErr.getStatus()).toBe(HttpStatus.GONE);
      expect(httpErr.message).toContain('/interco-settlement');
    }
  });
});
