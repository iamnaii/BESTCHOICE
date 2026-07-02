import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { AiUsageService } from '../ai-usage/ai-usage.service';
import { CreditCheckService } from './credit-check.service';

/**
 * Characterization tests for CreditCheckService.performRuleBasedAnalysis (Wave 3 backfill).
 *
 * This is the rule-based credit-approval scoring engine — the path that runs in
 * production whenever the Claude API key is absent. It had ZERO tests yet its
 * score drives APPROVED / MANUAL_REVIEW / REJECTED on regulated installment
 * lending (review finding D7). These goldens lock the band boundaries
 * (affordability 0.2 / 0.3 / 0.4) and the recommendation thresholds (70 / 50) so
 * a refactor can't silently move an approval line.
 *
 * The method is pure (no DB), so the service is built with stub deps and the
 * private method is invoked via a typed accessor.
 */

type Analysis = {
  score: number;
  summary: string;
  recommendation: string;
  analysis: {
    monthlyIncome: number;
    monthlyPayment: number;
    affordabilityRatio: number | null;
    riskFactors: string[];
    positiveFactors: string[];
    incomeConsistency: string;
  };
};

const APPROVE = 'แนะนำอนุมัติ - ลูกค้ามีความสามารถในการชำระเพียงพอ';
const REVIEW = 'พิจารณาเพิ่มเติม - ควรตรวจสอบข้อมูลเพิ่มเติม';
const REJECT = 'ไม่แนะนำอนุมัติ - ความเสี่ยงสูง';

describe('CreditCheckService.performRuleBasedAnalysis', () => {
  const service = new CreditCheckService(
    {} as unknown as PrismaService,
    {} as unknown as IntegrationConfigService,
    { record: jest.fn() } as unknown as AiUsageService,
  );
  const analyze = (params: {
    monthlyPayment: number;
    customerSalary: number;
    statementFileCount?: number;
    customerOccupation?: string | null;
  }): Analysis =>
    (service.ai as unknown as {
      performRuleBasedAnalysis: (p: typeof params) => Analysis;
    }).performRuleBasedAnalysis({ customerOccupation: null, ...params });

  it('scores a strong applicant: affordability <=20% + full statements + occupation', () => {
    const r = analyze({
      monthlyPayment: 5000,
      customerSalary: 30000, // ratio 0.1667 -> +30 (base 50 = 80)
      statementFileCount: 3, // +10 = 90
      customerOccupation: 'พนักงานบริษัท', // +5 = 95
    });
    expect(r.score).toBe(95);
    expect(r.recommendation).toBe(APPROVE);
    expect(r.analysis.affordabilityRatio).toBe(0.17); // round(0.1667 * 100)/100
    expect(r.analysis.incomeConsistency).toBe('มีรายได้');
    expect(r.analysis.riskFactors).toEqual([]);
    expect(r.analysis.positiveFactors).toContain('ค่างวดไม่เกิน 20% ของรายได้');
  });

  it('treats ratio exactly 0.20 as the <=20% band (+30)', () => {
    const r = analyze({ monthlyPayment: 6000, customerSalary: 30000 }); // ratio 0.20
    expect(r.score).toBe(80); // 50 + 30
    expect(r.analysis.positiveFactors).toContain('ค่างวดไม่เกิน 20% ของรายได้');
  });

  it('treats ratio exactly 0.30 as the <=30% band (+20)', () => {
    const r = analyze({ monthlyPayment: 9000, customerSalary: 30000 }); // ratio 0.30
    expect(r.score).toBe(70); // 50 + 20
    expect(r.recommendation).toBe(APPROVE); // score 70 -> >= 70
    expect(r.analysis.positiveFactors).toContain('ค่างวดไม่เกิน 30% ของรายได้');
  });

  it('treats ratio exactly 0.40 as the <=40% band (+10) and routes to manual review', () => {
    const r = analyze({ monthlyPayment: 12000, customerSalary: 30000 }); // ratio 0.40
    expect(r.score).toBe(60); // 50 + 10
    expect(r.recommendation).toBe(REVIEW); // 50..69
    expect(r.analysis.riskFactors).toContain('ค่างวดเกิน 30% ของรายได้');
  });

  it('penalises affordability above 40% (-10) and rejects', () => {
    const r = analyze({ monthlyPayment: 15000, customerSalary: 30000 }); // ratio 0.50
    expect(r.score).toBe(40); // 50 - 10
    expect(r.recommendation).toBe(REJECT); // < 50
    expect(r.analysis.riskFactors).toContain('ค่างวดเกิน 40% ของรายได้ - ความเสี่ยงสูง');
  });

  it('handles missing income (salary 0): -10, null ratio, rejects', () => {
    const r = analyze({ monthlyPayment: 5000, customerSalary: 0 });
    expect(r.score).toBe(40); // 50 - 10
    expect(r.analysis.affordabilityRatio).toBeNull();
    expect(r.analysis.incomeConsistency).toBe('ไม่มีข้อมูล');
    expect(r.analysis.riskFactors).toContain('ไม่มีข้อมูลรายได้');
    expect(r.recommendation).toBe(REJECT);
  });

  it('awards +5 (not +10) for an incomplete statement set (1-2 files)', () => {
    const r = analyze({ monthlyPayment: 9000, customerSalary: 30000, statementFileCount: 1 });
    expect(r.score).toBe(75); // 50 + 20 (ratio 0.30) + 5 (1 statement)
    expect(r.analysis.riskFactors).toContain('Statement ไม่ครบ 3 เดือน');
  });

  it('builds a Thai summary string with income, payment and ratio', () => {
    const r = analyze({ monthlyPayment: 6000, customerSalary: 30000 });
    expect(r.summary).toContain('รายได้ 30,000 บาท/เดือน');
    expect(r.summary).toContain('ค่างวด 6,000 บาท/เดือน');
    expect(r.summary).toContain('สัดส่วน 20% ของรายได้');
  });
});
