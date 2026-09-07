import { BadRequestException } from '@nestjs/common';
import { validateFileBase64 } from './ocr-parsing.util';
import { OcrExtractorsService } from './ocr-extractors.service';
import { AnthropicOcrClient } from './anthropic-ocr.client';
import { AiUsageService } from '../../ai-usage/ai-usage.service';

const pdf = (text: string) => `data:application/pdf;base64,${Buffer.from(text).toString('base64')}`;

describe('statement credit safety', () => {
  it('rejects encrypted PDF with an actionable 400 before sending it to AI', () => {
    expect(() => validateFileBase64(pdf('%PDF-1.7\ntrailer << /Encrypt 4 0 R >>'))).toThrow(
      'ไฟล์นี้ล็อกรหัส',
    );
  });

  it('does not accept HTML disguised as PDF', () => {
    expect(() => validateFileBase64(pdf('<html>expired</html>'))).toThrow(BadRequestException);
  });

  it('accepts an unencrypted PDF', () => {
    expect(validateFileBase64(pdf('%PDF-1.7\n%%EOF')).isDocument).toBe(true);
  });

  const client = { ensureAnthropicReady: jest.fn(), callClaudeOcrMultiFileWithRetry: jest.fn() };
  const service = new OcrExtractorsService(
    client as unknown as AnthropicOcrClient,
    {} as AiUsageService,
  );
  beforeEach(() => jest.clearAllMocks());

  it('turns upstream file rejection into a user-visible 400, without leaking provider text', async () => {
    client.callClaudeOcrMultiFileWithRetry.mockRejectedValue(
      Object.assign(new Error('provider secret'), { status: 400 }),
    );
    await expect(service.analyzeBankStatement([pdf('%PDF-1.7\n%%EOF')])).rejects.toThrow(
      BadRequestException,
    );
  });

  it('caps affordablePayment at 40% of observed monthly income and preserves zero', async () => {
    client.callClaudeOcrMultiFileWithRetry.mockResolvedValue({
      monthlyIncome: 10000,
      monthlyExpense: 5000,
      affordablePayment: 9000,
    });
    expect(await service.analyzeBankStatement([pdf('%PDF-1.7\n%%EOF')])).toMatchObject({
      monthlyIncome: 10000,
      monthlyExpense: 5000,
      affordablePayment: 4000,
    });
    client.callClaudeOcrMultiFileWithRetry.mockResolvedValue({
      monthlyIncome: 10000,
      affordablePayment: 0,
    });
    expect(await service.analyzeBankStatement([pdf('%PDF-1.7\n%%EOF')])).toMatchObject({
      affordablePayment: 0,
    });
  });

  it('does not manufacture monthly affordability from period totals or missing monthly income', async () => {
    client.callClaudeOcrMultiFileWithRetry.mockResolvedValue({
      totalIncome: 60000,
      totalExpense: 30000,
      balance: 500,
      affordablePayment: 9000,
    });
    expect(await service.analyzeBankStatement([pdf('%PDF-1.7\n%%EOF')])).toMatchObject({
      monthlyIncome: null,
      monthlyExpense: null,
      affordablePayment: null,
      averageBalance: null,
    });
  });

  it.each([false, '', [], {}, '   '])(
    'does not coerce unreadable amounts (%j) into financial zero',
    async (value) => {
      client.callClaudeOcrMultiFileWithRetry.mockResolvedValue({
        totalIncome: value,
        totalExpense: value,
        monthlyIncome: value,
        balance: value,
      });
      expect(await service.analyzeBankStatement([pdf('%PDF-1.7\n%%EOF')])).toMatchObject({
        totalIncome: null,
        totalExpense: null,
        monthlyIncome: null,
        balance: null,
      });
    },
  );
  it('preserves negative balances without accepting a negative income', async () => {
    client.callClaudeOcrMultiFileWithRetry.mockResolvedValue({
      monthlyIncome: -5,
      averageBalance: -120,
      balance: -50,
    });
    expect(await service.analyzeBankStatement([pdf('%PDF-1.7\n%%EOF')])).toMatchObject({
      monthlyIncome: null,
      averageBalance: -120,
      balance: -50,
    });
  });
});
