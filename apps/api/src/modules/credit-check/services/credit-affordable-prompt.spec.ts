import { CreditCheckAiAnalysisService } from './credit-check-ai-analysis.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { IntegrationConfigService } from '../../integrations/integration-config.service';
import { AiUsageService } from '../../ai-usage/ai-usage.service';
import { BadRequestException } from '@nestjs/common';

it('requests an affordable payment independent of the contract payment, capped at 40% income', async () => {
  const create = jest
    .fn()
    .mockResolvedValue({ content: [{ type: 'text', text: '{"analysis":{}}' }] });
  const service = new CreditCheckAiAnalysisService(
    {} as PrismaService,
    {} as IntegrationConfigService,
    { record: jest.fn() } as unknown as AiUsageService,
  );
  const subject = service as unknown as {
    getAnthropicClient(): Promise<unknown>;
    performClaudeAnalysis(params: unknown): Promise<unknown>;
  };
  jest.spyOn(subject, 'getAnthropicClient').mockResolvedValue({ messages: { create } });
  await subject.performClaudeAnalysis({
    statementFiles: [],
    statementMonths: 3,
    monthlyPayment: 0,
    customerSalary: 0,
  });
  const prompt = create.mock.calls[0][0].messages[0].content.at(-1).text;
  expect(prompt).toContain('"affordablePayment"');
  expect(prompt).toContain('40%');
  expect(prompt).toContain('ไม่ใช่ค่างวดของสัญญา');
});

it('refuses legacy re-analysis of a stored chat statement instead of overwriting its OCR result', async () => {
  const db = {
    creditCheck: {
      findUnique: jest
        .fn()
        .mockResolvedValue({
          id: 'check',
          statementFiles: ['/staff-chat/rooms/r/credit-check/files/f'],
          aiAnalysis: { source: 'chat-statement' },
          customer: {},
          contract: null,
        }),
      update: jest.fn(),
    },
  };
  const service = new CreditCheckAiAnalysisService(
    db as unknown as PrismaService,
    { getValue: jest.fn().mockResolvedValue(null) } as unknown as IntegrationConfigService,
    {} as AiUsageService,
  );
  await expect(service.analyzeForCustomer('check')).rejects.toThrow(BadRequestException);
  expect(db.creditCheck.update).not.toHaveBeenCalled();
});
