/**
 * SHOP Sales AI bench — side-by-side Claude vs Gemini on canonical test set.
 *
 * Loads 30 test messages from src/modules/sales-bot/__bench__/test-messages.json,
 * runs each through both providers, captures replies + latency + tokens + cost,
 * and writes an HTML report to bench-output/shop-ai-bench-YYYYMMDD-HHmm.html.
 *
 * Owner opens the HTML, reads side-by-side replies, votes via dropdown per row.
 * Final tally is computed in-browser; no server round-trip.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... GOOGLE_CLOUD_PROJECT=... npm run shop-ai:bench
 *
 * The CLI uses NestFactory.createApplicationContext so all DI wiring (Prisma,
 * tool services, providers) resolves the same as in production. Real database
 * access is performed for tools (search_products, calculate_installment etc.)
 * so the tool-call branches actually execute end-to-end — same shape the
 * customer-facing bot would see.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { AppModule } from '../app.module';
import { SalesBotService } from '../modules/sales-bot/sales-bot.service';
import { ClaudeProvider } from '../modules/sales-bot/providers/claude.provider';
import { GeminiProvider } from '../modules/sales-bot/providers/gemini.provider';
import { CaptureLeadTool } from '../modules/sales-bot/tools/capture-lead.tool';
import { HandoffToHumanTool } from '../modules/sales-bot/tools/handoff-to-human.tool';

interface TestMessage {
  id: string;
  category: string;
  text: string;
}

interface BenchResult {
  id: string;
  category: string;
  prompt: string;
  reply: string;
  toolsUsed: string[];
  modelUsed: string;
  inputTokens: number;
  outputTokens: number;
  costThb: number;
  latencyMs: number;
  error?: string;
}

interface PairedResult {
  test: TestMessage;
  claude: BenchResult;
  gemini: BenchResult;
}

// Pricing per 1M tokens (USD). Approx as of 2026-05-21.
const PRICING = {
  claude: { input: 3.0, output: 15.0 },
  gemini: { input: 0.075, output: 0.3 },
} as const;
const USD_TO_THB = 35.0;

function calcCost(
  provider: 'claude' | 'gemini',
  inputTokens: number,
  outputTokens: number,
): number {
  const p = PRICING[provider];
  const usd = (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
  return usd * USD_TO_THB;
}

async function main(): Promise<void> {
  const logger = new Logger('ShopAiBench');
  const testFile = join(
    __dirname,
    '../modules/sales-bot/__bench__/test-messages.json',
  );
  const tests: TestMessage[] = JSON.parse(readFileSync(testFile, 'utf-8'));
  logger.log(`Loaded ${tests.length} test messages from ${testFile}`);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const salesBot = app.get(SalesBotService);
  const claude = app.get(ClaudeProvider);
  const gemini = app.get(GeminiProvider);

  if (!process.env.ANTHROPIC_API_KEY) {
    logger.error('ANTHROPIC_API_KEY not set — Claude provider will fail');
  }
  if (!gemini.isReady()) {
    logger.error('GOOGLE_CLOUD_PROJECT not set — Gemini provider will fail');
  }

  // Stub side-effecting tools so we can run against synthetic roomId without
  // hitting Prisma. capture_lead in particular would throw RecordNotFound on
  // a placeholder roomId — that error would pollute 5/30 bench rows for
  // buying-signal messages. Read-only tools (search_products, calculate_installment,
  // list_promotions) stay live so we see real catalog data in the comparison.
  const captureLead = app.get(CaptureLeadTool);
  const handoff = app.get(HandoffToHumanTool);
  (captureLead as unknown as { run: (input: unknown) => Promise<unknown> }).run =
    async (input: unknown) => ({
      ok: true,
      customerId: 'bench-stub-customer',
      handoffMessage: 'ขอบคุณค่ะ พี่ staff จะติดต่อกลับสักครู่นะคะ',
      __stub: true,
      input,
    });
  (handoff as unknown as { run: (input: unknown) => Promise<unknown> }).run =
    async (input: unknown) => ({
      ok: true,
      handoffAccepted: true,
      __stub: true,
      input,
    });

  const results: PairedResult[] = [];
  const roomId = 'bench-room-placeholder'; // tools use this for AuditLog only (stubs ignore)

  for (const t of tests) {
    logger.log(`[${t.id}] ${t.category}: ${t.text.slice(0, 50)}`);

    const claudeResult = await runOne(salesBot, claude, t, roomId);
    const geminiResult = await runOne(salesBot, gemini, t, roomId);

    results.push({ test: t, claude: claudeResult, gemini: geminiResult });
  }

  await app.close();

  const html = renderHtml(results);
  const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const outDir = join(process.cwd(), 'bench-output');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `shop-ai-bench-${ts}.html`);
  writeFileSync(outFile, html);

  const summary = computeSummary(results);
  logger.log('');
  logger.log('=== Summary ===');
  logger.log(`Claude: ${summary.claude.totalCostThb.toFixed(2)} ฿ | avg latency ${summary.claude.avgLatencyMs}ms`);
  logger.log(`Gemini: ${summary.gemini.totalCostThb.toFixed(2)} ฿ | avg latency ${summary.gemini.avgLatencyMs}ms`);
  logger.log(`Saving (Gemini vs Claude): ${(((summary.claude.totalCostThb - summary.gemini.totalCostThb) / summary.claude.totalCostThb) * 100).toFixed(1)}%`);
  logger.log('');
  logger.log(`Report written: ${outFile}`);
  logger.log(`Open with: open "${outFile}"`);
}

async function runOne(
  salesBot: SalesBotService,
  provider: ClaudeProvider | GeminiProvider,
  t: TestMessage,
  roomId: string,
): Promise<BenchResult> {
  const t0 = Date.now();
  try {
    const r = await salesBot.generateReply(
      { text: t.text, roomId, customerId: null, priorMessages: [] },
      provider,
    );
    const latencyMs = Date.now() - t0;
    const costThb = calcCost(provider.providerName, r.inputTokens, r.outputTokens);
    return {
      id: t.id,
      category: t.category,
      prompt: t.text,
      reply: r.reply,
      toolsUsed: r.toolsUsed,
      modelUsed: r.modelUsed,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      costThb,
      latencyMs,
    };
  } catch (err) {
    const latencyMs = Date.now() - t0;
    return {
      id: t.id,
      category: t.category,
      prompt: t.text,
      reply: '',
      toolsUsed: [],
      modelUsed: provider.providerName,
      inputTokens: 0,
      outputTokens: 0,
      costThb: 0,
      latencyMs,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function computeSummary(results: PairedResult[]) {
  const sum = (arr: BenchResult[]) => {
    const totalCostThb = arr.reduce((a, r) => a + r.costThb, 0);
    const avgLatencyMs = Math.round(
      arr.reduce((a, r) => a + r.latencyMs, 0) / Math.max(arr.length, 1),
    );
    const errors = arr.filter((r) => r.error).length;
    return { totalCostThb, avgLatencyMs, errors };
  };
  return {
    claude: sum(results.map((r) => r.claude)),
    gemini: sum(results.map((r) => r.gemini)),
  };
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderHtml(results: PairedResult[]): string {
  const summary = computeSummary(results);
  const rows = results
    .map((p, idx) => {
      const cell = (r: BenchResult) => `
        <div class="reply">${esc(r.reply) || `<span class="err">ERROR: ${esc(r.error ?? '(empty)')}</span>`}</div>
        <div class="meta">
          ${r.toolsUsed.length ? `🛠️ ${esc(r.toolsUsed.join(', '))}` : ''}
          <span class="tokens">${r.inputTokens}→${r.outputTokens} tok</span>
          <span class="cost">${r.costThb.toFixed(4)} ฿</span>
          <span class="lat">${r.latencyMs}ms</span>
        </div>`;
      return `
      <tr data-idx="${idx}">
        <td class="cat"><div class="id">${p.test.id}</div><div class="catname">${p.test.category}</div></td>
        <td class="prompt">${esc(p.test.text)}</td>
        <td class="reply-cell">${cell(p.claude)}</td>
        <td class="reply-cell">${cell(p.gemini)}</td>
        <td class="vote">
          <select onchange="updateVote(${idx}, this.value)">
            <option value="">— vote —</option>
            <option value="claude">Claude ดีกว่า</option>
            <option value="gemini">Gemini ดีกว่า</option>
            <option value="tie">เสมอ</option>
            <option value="both_bad">แย่ทั้งคู่</option>
          </select>
        </td>
      </tr>`;
    })
    .join('\n');

  const saving =
    ((summary.claude.totalCostThb - summary.gemini.totalCostThb) /
      summary.claude.totalCostThb) *
    100;

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>SHOP Sales AI Bench — Claude vs Gemini</title>
<style>
  body { font-family: -apple-system, system-ui, "IBM Plex Sans Thai", sans-serif; margin: 20px; background: #fafafa; color: #18181b; }
  h1 { font-size: 1.5em; margin-bottom: 4px; }
  .subtitle { color: #71717a; margin-bottom: 20px; font-size: 0.9em; }
  .summary { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 20px; }
  .card { background: white; border: 1px solid #e4e4e7; border-radius: 8px; padding: 12px 16px; }
  .card h3 { margin: 0 0 8px 0; font-size: 0.85em; color: #71717a; text-transform: uppercase; letter-spacing: 0.05em; }
  .card .big { font-size: 1.4em; font-weight: 600; }
  .card .sub { color: #71717a; font-size: 0.85em; }
  .results { background: white; border-radius: 8px; overflow: hidden; border: 1px solid #e4e4e7; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9em; }
  th { text-align: left; background: #f4f4f5; padding: 10px 12px; font-weight: 600; border-bottom: 1px solid #e4e4e7; }
  td { padding: 10px 12px; vertical-align: top; border-bottom: 1px solid #f4f4f5; }
  td.cat { white-space: nowrap; font-size: 0.85em; }
  td.cat .id { color: #71717a; }
  td.cat .catname { font-weight: 500; color: #18181b; }
  td.prompt { width: 200px; color: #3f3f46; }
  .reply-cell { width: 30%; }
  .reply { white-space: pre-wrap; line-height: 1.5; color: #18181b; }
  .meta { margin-top: 6px; font-size: 0.8em; color: #71717a; display: flex; gap: 10px; flex-wrap: wrap; }
  .err { color: #dc2626; }
  .tokens, .cost, .lat { color: #71717a; }
  td.vote { white-space: nowrap; }
  td.vote select { padding: 4px 8px; border: 1px solid #d4d4d8; border-radius: 4px; background: white; }
  .live-tally { background: #ecfdf5; border: 1px solid #10b981; border-radius: 8px; padding: 16px; margin-top: 24px; }
  .live-tally h3 { margin: 0 0 12px 0; color: #047857; }
  .tally-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .tally-cell { text-align: center; }
  .tally-cell .label { font-size: 0.85em; color: #047857; }
  .tally-cell .count { font-size: 1.6em; font-weight: 600; }
</style>
</head>
<body>
  <h1>SHOP Sales AI — Bench Report</h1>
  <div class="subtitle">Generated ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })} · ${results.length} test messages · Claude vs Gemini side-by-side</div>

  <div class="summary">
    <div class="card">
      <h3>Cost (รวม 30 ข้อความ)</h3>
      <div class="big">${summary.claude.totalCostThb.toFixed(2)} ฿ → ${summary.gemini.totalCostThb.toFixed(2)} ฿</div>
      <div class="sub">ประหยัด ${saving.toFixed(1)}% ถ้าเลือก Gemini</div>
    </div>
    <div class="card">
      <h3>Latency เฉลี่ย</h3>
      <div class="big">${summary.claude.avgLatencyMs}ms vs ${summary.gemini.avgLatencyMs}ms</div>
      <div class="sub">${summary.gemini.avgLatencyMs < summary.claude.avgLatencyMs ? 'Gemini เร็วกว่า' : 'Claude เร็วกว่า'}</div>
    </div>
    <div class="card">
      <h3>Errors</h3>
      <div class="big">Claude ${summary.claude.errors} · Gemini ${summary.gemini.errors}</div>
      <div class="sub">number of failed calls</div>
    </div>
  </div>

  <div class="results">
    <table>
      <thead>
        <tr>
          <th style="width:90px;">ID / หมวด</th>
          <th>ลูกค้าพิมพ์</th>
          <th>Claude Sonnet 4.6</th>
          <th>Gemini 2.0 Flash</th>
          <th>Vote</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </div>

  <div class="live-tally" id="liveTally" style="display:none;">
    <h3>📊 คะแนนรวม (live)</h3>
    <div class="tally-grid">
      <div class="tally-cell"><div class="label">Claude ชนะ</div><div class="count" id="cntClaude">0</div></div>
      <div class="tally-cell"><div class="label">Gemini ชนะ</div><div class="count" id="cntGemini">0</div></div>
      <div class="tally-cell"><div class="label">เสมอ</div><div class="count" id="cntTie">0</div></div>
      <div class="tally-cell"><div class="label">แย่ทั้งคู่</div><div class="count" id="cntBoth">0</div></div>
    </div>
    <div id="recommendation" style="margin-top:12px;padding:10px;background:white;border-radius:4px;"></div>
  </div>

<script>
  const votes = {};
  const total = ${results.length};
  function updateVote(idx, value) {
    if (!value) { delete votes[idx]; } else { votes[idx] = value; }
    const counts = { claude: 0, gemini: 0, tie: 0, both_bad: 0 };
    Object.values(votes).forEach(v => counts[v]++);
    document.getElementById('cntClaude').textContent = counts.claude;
    document.getElementById('cntGemini').textContent = counts.gemini;
    document.getElementById('cntTie').textContent = counts.tie;
    document.getElementById('cntBoth').textContent = counts.both_bad;
    document.getElementById('liveTally').style.display = Object.keys(votes).length > 0 ? 'block' : 'none';
    if (Object.keys(votes).length === total) {
      const styleScore = (counts.gemini * 1 + counts.tie * 0.5) / (counts.claude + counts.gemini + counts.tie + counts.both_bad);
      const costSavingPct = ${saving.toFixed(1)};
      const overall = styleScore * 0.5 + (costSavingPct > 0 ? 0.2 : 0);
      const rec = styleScore >= 0.5 ? 'GEMINI ชนะ' : 'CLAUDE ชนะ';
      document.getElementById('recommendation').innerHTML = '<b>Recommendation:</b> ' + rec + ' (style score Gemini=' + (styleScore*100).toFixed(0) + '%, cost saving=' + costSavingPct + '%)';
    }
  }
</script>
</body>
</html>`;
}

main().catch((err) => {
  console.error('Bench failed:', err);
  process.exit(1);
});
