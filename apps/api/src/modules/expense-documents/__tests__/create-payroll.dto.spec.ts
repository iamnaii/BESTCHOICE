import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePayrollDto } from '../dto/create-payroll.dto';

/**
 * Fix #C11 — SSO 750/person/month cap. Per Thai SSO law: employee + employer
 * each contribute 5% of min(salary, 15000) → max 750 each. payroll.template.ts
 * reuses ssoEmployee for the employer side, so the single Max enforces both.
 */
describe('CreatePayrollDto — SSO 750 cap (Fix #C11)', () => {
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

  it('rejects ssoEmployee=900 (over 750 cap)', async () => {
    const errors = await validateDto(baseDto({ ssoEmployee: 900 }));
    // Nested validation errors live under .children[0].children[?].constraints
    const flat = JSON.stringify(errors);
    expect(flat).toMatch(/SSO ต่อคนไม่เกิน 750/);
  });

  it('accepts ssoEmployee=750 (exact cap)', async () => {
    const errors = await validateDto(baseDto({ ssoEmployee: 750 }));
    const flat = JSON.stringify(errors);
    expect(flat).not.toMatch(/SSO ต่อคนไม่เกิน 750/);
  });

  it('accepts ssoEmployee=375 (salary 7500 × 5% = 375)', async () => {
    const errors = await validateDto(baseDto({ baseSalary: 7500, ssoEmployee: 375 }));
    const flat = JSON.stringify(errors);
    expect(flat).not.toMatch(/SSO ต่อคนไม่เกิน 750/);
  });

  it('accepts ssoEmployee=0 (new hire mid-month, salary=0)', async () => {
    // baseSalary must be > 0 (min 0.01), but ssoEmployee=0 is valid (no contribution).
    const errors = await validateDto(baseDto({ baseSalary: 0.01, ssoEmployee: 0 }));
    const flat = JSON.stringify(errors);
    expect(flat).not.toMatch(/SSO ต่อคนไม่เกิน 750/);
  });

  it('accepts when ssoEmployee is omitted (optional)', async () => {
    const errors = await validateDto(baseDto({}));
    const flat = JSON.stringify(errors);
    expect(flat).not.toMatch(/SSO ต่อคนไม่เกิน 750/);
  });

  it('rejects ssoEmployee=751 (off by 1 above cap)', async () => {
    const errors = await validateDto(baseDto({ ssoEmployee: 751 }));
    const flat = JSON.stringify(errors);
    expect(flat).toMatch(/SSO ต่อคนไม่เกิน 750/);
  });
});
