/** Explicit live-provider smoke check. Only synthetic data and a disposable local DB. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../apps/api/src/prisma/prisma.service';
import { IntegrationConfigService } from '../apps/api/src/modules/integrations/integration-config.service';
import { AiUsageService } from '../apps/api/src/modules/ai-usage/ai-usage.service';
import { AiProviderService } from '../apps/api/src/modules/ai-usage/ai-provider.service';
import { OcrService } from '../apps/api/src/modules/ocr/ocr.service';
import { StorageService } from '../apps/api/src/modules/storage/storage.service';

async function main() {
  assert.equal(process.env.CREDIT_LIVE_PROVIDER_CHECK, '1');
  assert.match(process.env.DATABASE_URL ?? '', /^postgresql:\/\/credit_test@localhost:55476\/bc_chat_credit_test\?host=\/tmp\/bc-chat-credit\.[\w]+\/socket&schema=public$/);
  assert.ok(process.env.ANTHROPIC_API_KEY && process.env.GCS_BUCKET);
  const db = new PrismaService();
  const config = new ConfigService({ ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, GCS_BUCKET: process.env.GCS_BUCKET });
  const storage = new StorageService(config);
  const ocr = new OcrService(new IntegrationConfigService(db, config), new AiProviderService(new AiUsageService(db, config)));
  const key = `credit-provider-smoke/${randomUUID()}/synthetic-statement.pdf`;
  let uploaded = false;
  try {
    await db.$connect();
    const pdf = await PDFDocument.create();
    const page = pdf.addPage();
    [
      'SYNTHETIC BANK STATEMENT - SOFTWARE TEST ONLY',
      'Account: TEST ACCOUNT / Bank: TEST BANK',
      'Period: January 1 - March 31, 2026',
      'January: salary income 20000, expenses 12000',
      'February: salary income 20000, expenses 12000',
      'March: salary income 20000, expenses 12000',
      'Total deposits 60000; total withdrawals 36000',
      'Opening balance 0; closing balance 24000',
    ].forEach((line, index) => page.drawText(line, { x: 35, y: 780 - index * 30, size: 13 }));
    const bytes = Buffer.from(await pdf.save());
    await storage.upload(key, bytes, 'application/pdf');
    uploaded = true;
    const chunks: Buffer[] = [];
    for await (const chunk of await storage.getStream(key)) chunks.push(Buffer.from(chunk));
    const stored = Buffer.concat(chunks);
    assert.deepEqual(stored, bytes);
    console.log('PASS: actual GCS upload and authenticated download match byte for byte');
    const result = await ocr.analyzeBankStatement([`data:application/pdf;base64,${stored.toString('base64')}`]);
    assert.equal(result.monthlyIncome, 20000);
    assert.equal(result.monthlyExpense, 12000);
    assert.equal(result.totalIncome, 60000);
    assert.equal(result.totalExpense, 36000);
    console.log(JSON.stringify({ check: 'actual Anthropic OCR of synthetic PDF from GCS', result: {
      monthlyIncome: result.monthlyIncome, monthlyExpense: result.monthlyExpense,
      totalIncome: result.totalIncome, totalExpense: result.totalExpense,
    }, passed: true }));
  } finally {
    if (uploaded) {
      await storage.delete(key);
      console.log('PASS: removed only the synthetic object created by this check');
    }
    await db.$disconnect();
  }
}
main().catch(error => {
  // No provider response dumps: may contain authentication/request metadata.
  console.error('Provider check failed:', error instanceof Error ? error.name : 'unknown error');
  process.exitCode = 1;
});
