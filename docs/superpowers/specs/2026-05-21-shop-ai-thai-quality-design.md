# SHOP Sales AI — Thai Language Quality Design (Phase A1+A2)

**Goal:** ปรับ SHOP Sales AI ให้ตอบลูกค้าด้วยภาษาไทยธรรมชาติยิ่งขึ้น (ไม่ใช่ "Eng แปล Thai") + เปิดทาง provider swap เพื่อประหยัด cost

**Status:** APPROVED — owner agreed to "ลุยเลย" 2026-05-21

## Background

Owner feedback หลัง deploy PR #1055: bot ตอบ Nai เป็นภาษาไทยที่ feel เหมือนถูกแปลจาก English (sentence pattern แบบ "X ใช่ไหมครับ? Y ไหม?"). Persona prompt เขียนไทยเทพอยู่แล้ว → root cause = **model** + **ไม่มี few-shot grounding**

## Decisions locked

1. **Sequence**: Phase A2 (model swap test) ก่อน → Phase A1 (few-shot) ทีหลัง — แยก variable เพื่อ isolate cause of any improvement
2. **Source of few-shot**: Owner จะ curate gold set เอง (ลืม CHATCONE import) — Phase A1 รอ owner ให้ data
3. **Test approach**: Dev-only side-by-side bench (zero production risk) → HTML report → owner vote → flip switch
4. **Architecture**: LLMProvider abstraction (interface + 2 implementations) → SystemConfig-controlled switch — pays back as Phase B Hybrid Router substrate
5. **Comparison criteria**: Thai style 50% (owner vote) + tool call correctness 30% + cost 20%
6. **Default provider** หลัง deploy: `claude` (no behavior change until owner flips)

## Cost projection

| Volume | Claude Sonnet (cached) | Gemini 2.0 Flash | Saving |
|---|---|---|---|
| 500 msg/mo (now) | ~100฿ | ~9฿ | ~90฿ |
| 5,000 msg/mo (FB+LINE full) | ~1,050฿ | ~88฿ | ~960฿ |
| 20,000 msg/mo (scale 6mo) | ~4,200฿ | ~350฿ | ~3,850฿ |

Setup one-time: 1 day dev + ~70฿ bench API spend

## Architecture

### LLMProvider interface
```ts
// apps/api/src/modules/sales-bot/providers/llm-provider.interface.ts
export const LLM_PROVIDER_TOKEN = 'LLM_PROVIDER';

export interface LlmToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
}

export interface LlmChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface LlmToolResult {
  toolCallId: string;
  content: string;
}

export interface LlmChatRequest {
  systemPrompt: string;
  messages: LlmChatMessage[];
  tools?: LlmToolDefinition[];
  toolResults?: LlmToolResult[]; // when continuing after tool execution
  maxOutputTokens?: number;
}

export interface LlmChatResponse {
  text: string;              // final assistant text (empty if tool calls only)
  toolCalls: LlmToolCall[];  // model wants these executed
  inputTokens: number;
  outputTokens: number;
  modelName: string;          // for logging/audit
}

export interface ILlmProvider {
  readonly providerName: 'claude' | 'gemini';
  chat(req: LlmChatRequest): Promise<LlmChatResponse>;
}
```

### Tool format mapping

Anthropic uses `tools: [{name, description, input_schema}]` + response has `tool_use` blocks.

Vertex Gemini uses `tools: [{functionDeclarations: [{name, description, parameters}]}]` + response has `functionCall` parts.

**ClaudeProvider** wraps `@anthropic-ai/sdk` — passes tools through, extracts tool_use blocks.

**GeminiProvider** wraps Vertex AI REST API at `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/gemini-2.0-flash-001:generateContent`:
- Reuses GoogleAuth flow ที่ EmbeddingService ใช้แล้ว
- Tool definitions: convert `inputSchema` → `parameters` (Gemini ใช้ OpenAPI subset, ตัด keyword ที่ไม่รองรับ)
- Response: extract `parts[].functionCall.{name,args}` → map เป็น `LlmToolCall[]`
- Text response: concat `parts[].text`
- Multi-turn tool: ส่ง `functionResponse` parts กลับใน next request

### Provider selection
SystemConfig key `shop_bot_llm_provider` (string `"claude"` or `"gemini"`, default `"claude"`).
- Read ผ่าน existing `ConfigService` pattern (cached 5min internally — same as embedding endpoint config)
- Hot reload: flip key in DB → next inbound msg uses new provider (no Cloud Run redeploy)
- Fallback: ถ้า provider name invalid → log warn + use claude

### SalesBotService changes
```ts
// Before
this.client.messages.create({ model: 'claude-sonnet-4-6', ... })

// After
const provider = await this.providerRegistry.get();
const response = await provider.chat({ systemPrompt, messages, tools, ... });
// Tool loop: while response.toolCalls.length > 0 → execute → re-request
```

Tool loop logic stays in SalesBotService (provider-agnostic) — only `chat()` call swaps.

### ProviderRegistry
Lightweight wrapper that reads SystemConfig + returns the right provider instance.

```ts
@Injectable()
export class LlmProviderRegistry {
  constructor(
    private claudeProvider: ClaudeProvider,
    private geminiProvider: GeminiProvider,
    private prisma: PrismaService,
  ) {}

  async getActive(): Promise<ILlmProvider> {
    const cfg = await this.prisma.systemConfig.findFirst({
      where: { key: 'shop_bot_llm_provider', deletedAt: null },
    });
    const name = cfg?.value ?? 'claude';
    if (name === 'gemini') return this.geminiProvider;
    return this.claudeProvider; // default + fallback
  }
}
```

## Bench CLI

```bash
npm run shop-ai:bench  # apps/api package
```

- Load 30 test messages from `apps/api/src/modules/sales-bot/__bench__/test-messages.json`
- For each: call ClaudeProvider + GeminiProvider with same system prompt + history
- Capture: response text, tool calls, latency, token counts, cost calc
- Output: `apps/api/bench-output/shop-ai-bench-YYYYMMDD-HHmm.html` — side-by-side HTML table
- Owner opens HTML in browser → reads 30 paired replies → votes via column toggle → final score auto-computed

### Test messages (30)
Distribution per Sales Playbook:
- 6× ทักทาย / opening (greeting, "สวัสดี", emoji-only)
- 8× ถามราคา / สเปก (ตรง: "iPhone 15 ราคา", อ้อม: "อยากได้กล้องดี งบ 20k")
- 5× สนใจผ่อน (buying signal triggering capture_lead)
- 4× objection (8 patterns ใน playbook, ตัวอย่าง 4 อัน)
- 3× red flag (ขอผ่อน 3 เครื่อง, pro max ดาวน์น้อย, ขู่)
- 2× MDM/lock question
- 2× off-topic (เคลม, complain → handoff)

ผม draft เองตาม persona — owner ไม่ต้องเตรียม

## Persona refinement (Phase A1.B — แต่ทำควบ A2)

เพิ่ม section ใน `sales-persona.ts`:

```
# ภาษาไทยธรรมชาติ (กฎเหล็ก)
- **ห้าม pattern คำถาม 2 ชั้น** เช่น "สนใจ X ใช่ไหมครับ? อยากได้ Y ไหมครับ?" → ใช้คำถามเดียวต่อข้อความ
- ลงท้ายด้วย "ครับ" / "ค่ะ" (ไม่ใส่ ?) — ใช้ ? เฉพาะคำถามจริงๆ
- ห้าม pattern แปล: "ที่เรา/ของเรา", "ในกรณีนี้", "เพื่อให้เกิด" → ใช้ "ของร้าน/ที่ร้าน", "ถ้า", "ให้"
- ห้าม structure "If X, then Y" แปล → ใช้ "ถ้า X จะ Y" หรือ "X → Y" ไปเลย
- ใช้คำเชื่อมแบบไทย: "เลย" "นะ" "ละ" "ไง" (แต่ไม่เกินไป)
- ถ้าจะถามต่อ → ขึ้น message ใหม่ หรือใช้ "แล้ว..."
```

## Files affected

### New
- `apps/api/src/modules/sales-bot/providers/llm-provider.interface.ts`
- `apps/api/src/modules/sales-bot/providers/claude.provider.ts`
- `apps/api/src/modules/sales-bot/providers/gemini.provider.ts`
- `apps/api/src/modules/sales-bot/providers/llm-provider.registry.ts`
- `apps/api/src/modules/sales-bot/__bench__/test-messages.json` (30 entries)
- `apps/api/src/cli/shop-ai-bench.cli.ts`
- `apps/api/src/cli/bench-report-template.html`

### Modified
- `apps/api/src/modules/sales-bot/sales-bot.module.ts` — register providers
- `apps/api/src/modules/sales-bot/sales-bot.service.ts` — use ProviderRegistry instead of direct Anthropic
- `apps/api/src/modules/staff-chat/prompts/sales-persona.ts` — add "natural Thai" rule section
- `apps/api/package.json` — add `shop-ai:bench` script
- `.claude/rules/accounting.md` — N/A
- `docs/superpowers/specs/2026-05-21-shop-ai-thai-quality-design.md` — this file

### Existing dependencies reused
- `google-auth-library` (already wired in EmbeddingService for Vertex)
- `@anthropic-ai/sdk` (already wired)
- No new npm deps

## Out of scope (deferred)

- **Phase A1 few-shot examples** — wait for owner gold set
- **Phase B Hybrid Router** (Gemini Flash ง่าย + Claude Sonnet ยาก) — needs A2 winner first
- **Embedding-based few-shot retrieval** — if gold set ≤ 20, inject all → no vector search needed
- **CHATCONE auto-pull deprecation** — leave existing infra alone, owner decides later
- **GPT-4o test** — owner can request separate spec if Gemini loses
- **Typhoon / OpenThaiGPT** — would need to rewrite tool architecture (no tool calling support)

## Test plan

### Unit
- ClaudeProvider.chat() returns text + toolCalls correctly
- GeminiProvider.chat() returns text + toolCalls correctly (round-trip tool format)
- ProviderRegistry.getActive() respects SystemConfig + defaults to claude
- SalesBotService produces identical behavior with ClaudeProvider as before refactor

### Integration
- Bench CLI runs end-to-end against both providers + outputs valid HTML
- SystemConfig flip mid-flight: next request uses new provider

### Manual (owner)
- Open bench HTML → vote 30 messages → tally
- Test live with Nai room after flip

## Risk + mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Gemini tool calling unreliable | Medium | High | Bench tests measure this; default stays claude |
| Vertex AI quota/auth issue | Low | Medium | Reuse existing EmbeddingService auth pattern (proven) |
| Refactor breaks SalesBotService behavior | Medium | High | Unit tests verify Claude path produces same output |
| Persona rule change too aggressive | Low | Medium | All rules additive, can A/B test prompts via SystemConfig later |
| HTML report file checked into repo | Low | Low | `.gitignore` `bench-output/` |

## Rollback

If anything breaks in production:
1. Flip SystemConfig `shop_bot_llm_provider` back to `claude` (1 minute, no redeploy)
2. If refactor itself broken → revert PR

No DB schema changes — fully reversible.
