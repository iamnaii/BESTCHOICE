import { Test } from '@nestjs/testing';
import { CustomerPreCheckService } from './customer-precheck.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerTierService } from './customer-tier.service';

describe('CustomerPreCheckService — decideOutcome (pure)', () => {
  let service: CustomerPreCheckService;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        CustomerPreCheckService,
        { provide: PrismaService, useValue: {} },
        { provide: CustomerTierService, useValue: {} },
      ],
    }).compile();
    service = mod.get(CustomerPreCheckService);
  });

  it('BLACKLIST always FAIL', () => {
    expect(service.decideOutcome('BLACKLIST', undefined).decision).toBe('FAIL');
  });
  it('RISKY always REVIEW', () => {
    expect(service.decideOutcome('RISKY', 80).decision).toBe('REVIEW');
  });
  it('GOLD always PASS — even without AI', () => {
    expect(service.decideOutcome('GOLD', undefined).decision).toBe('PASS');
  });
  it('GOOD with AI >= 50 PASS', () => {
    expect(service.decideOutcome('GOOD', 65).decision).toBe('PASS');
  });
  it('GOOD with AI 40-49 REVIEW', () => {
    expect(service.decideOutcome('GOOD', 45).decision).toBe('REVIEW');
  });
  it('GOOD with AI < 40 FAIL', () => {
    expect(service.decideOutcome('GOOD', 35).decision).toBe('FAIL');
  });
  it('GOOD without AI PASS', () => {
    expect(service.decideOutcome('GOOD', undefined).decision).toBe('PASS');
  });
  it('NEW with AI >= 50 PASS', () => {
    expect(service.decideOutcome('NEW', 60).decision).toBe('PASS');
  });
  it('NEW with AI 40-49 REVIEW', () => {
    expect(service.decideOutcome('NEW', 45).decision).toBe('REVIEW');
  });
  it('NEW with AI < 40 FAIL', () => {
    expect(service.decideOutcome('NEW', 30).decision).toBe('FAIL');
  });
  it('NEW without AI REVIEW', () => {
    expect(service.decideOutcome('NEW', undefined).decision).toBe('REVIEW');
  });
});
