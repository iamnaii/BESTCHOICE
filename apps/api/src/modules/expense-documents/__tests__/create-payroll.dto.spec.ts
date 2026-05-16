import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePayrollDto } from '../dto/create-payroll.dto';

/**
 * DTO-layer validation tests. The 750 cap was lifted from this DTO in
 * B1 (SSO 875 Configurable) — the period-effective cap now lives in
 * `sso_config` table and is enforced at the service layer via
 * `SsoConfigService.validateContribution(documentDate, ssoEmployee)`.
 * Cap-logic tests live in `sso-config.service.spec.ts`.
 */
describe('CreatePayrollDto — shape validation', () => {
  const baseDto = (overrides: Record<string, unknown>) => ({
    branchId: 'branch-1',
    documentDate: '2026-05-11',
    payrollPeriod: '2026-05',
    depositAccountCode: '11-1101',
    lines: [
      {
        employeeName: 'พนักงาน A',
        baseSalary: 15000,
        ...overrides,
      },
    ],
  });

  async function validateDto(payload: Record<string, unknown>) {
    const inst = plainToInstance(CreatePayrollDto, payload);
    return validate(inst, { whitelist: true, forbidNonWhitelisted: false });
  }

  it('accepts ssoEmployee within plausible range (875)', async () => {
    const errors = await validateDto(baseDto({ ssoEmployee: 875 }));
    expect(errors).toEqual([]);
  });

  it('accepts ssoEmployee=0 (no contribution)', async () => {
    const errors = await validateDto(baseDto({ baseSalary: 0.01, ssoEmployee: 0 }));
    expect(errors).toEqual([]);
  });

  it('accepts when ssoEmployee is omitted (optional)', async () => {
    const errors = await validateDto(baseDto({}));
    expect(errors).toEqual([]);
  });

  it('rejects negative ssoEmployee', async () => {
    const errors = await validateDto(baseDto({ ssoEmployee: -1 }));
    const flat = JSON.stringify(errors);
    expect(flat).toMatch(/min/i);
  });

  it('rejects non-numeric ssoEmployee', async () => {
    const errors = await validateDto(baseDto({ ssoEmployee: 'abc' }));
    const flat = JSON.stringify(errors);
    expect(flat).toMatch(/number/i);
  });

  // DTO no longer enforces the 750/875 cap — that lives in SsoConfigService.
  // This test documents the deliberate lift: a value that LOOKS over-cap
  // now passes DTO validation; service layer is the one that rejects it.
  it('accepts ssoEmployee=900 at DTO layer (cap moved to service)', async () => {
    const errors = await validateDto(baseDto({ ssoEmployee: 900 }));
    expect(errors).toEqual([]);
  });
});
