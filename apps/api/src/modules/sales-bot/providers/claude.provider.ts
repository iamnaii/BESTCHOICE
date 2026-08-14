import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  ILlmProvider,
  LlmChatMessage,
  LlmChatRequest,
  LlmChatResponse,
  LlmProviderName,
} from './llm-provider.interface';

/**
 * Default = Haiku 4.5 (คำสั่งเจ้าของ 2026-08-14 — คุมงบ AI ≤10,000 บาท/เดือน).
 * Override ได้ผ่าน SystemConfig `shop_bot_claude_model` (เช่น 'claude-sonnet-4-6')
 * — มีผลใน ≤60s ไม่ต้อง deploy, ใช้ TTL cache แบบเดียวกับ LlmProviderRegistry.
 */
const DEFAULT_CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const MODEL_CONFIG_KEY = 'shop_bot_claude_model';
const MODEL_CACHE_TTL_MS = 60_000;
// 4096 (เดิม 1024): ตระกูล Claude 5 (เช่น claude-sonnet-5) ใช้ adaptive thinking —
// การคิดกินโควต้า max_tokens ร่วมกับคำตอบ ถ้าตั้ง 1024 การคิดอาจกินจนหมด
// เหลือข้อความจริง 0 ตัวอักษร (เจอจริง 2026-08-14: FinalReply reply="")
const DEFAULT_MAX_TOKENS = 4096;

@Injectable()
export class ClaudeProvider implements ILlmProvider {
  readonly providerName: LlmProviderName = 'claude';
  private readonly logger = new Logger(ClaudeProvider.name);
  private _client: Anthropic | null = null;
  private modelCache: { value: string; readAt: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private get client(): Anthropic {
    if (!this._client) {
      this._client = new Anthropic();
    }
    return this._client;
  }

  async chat(req: LlmChatRequest): Promise<LlmChatResponse> {
    const model = await this.resolveModel();

    // Prompt caching: tools + system prompt เป็น prefix คงที่ (~9k tokens) ที่ทุกห้อง
    // ทุกข้อความ และทุกยกของ tool loop ใช้ร่วมกัน — ปัก cache_control ที่ tool ตัวสุดท้าย
    // กับ system block เพื่อให้ Anthropic cache ทั้ง prefix (cache read = 0.1x ราคา input)
    const tools: Anthropic.Tool[] | undefined = req.tools?.map((t, i, arr) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
      ...(i === arr.length - 1
        ? { cache_control: { type: 'ephemeral' as const } }
        : {}),
    }));

    const messages = this.projectMessages(req.messages);

    const resp = await this.client.messages.create({
      model,
      max_tokens: req.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
      system: [
        {
          type: 'text' as const,
          text: req.systemPrompt,
          cache_control: { type: 'ephemeral' as const },
        },
      ],
      ...(tools ? { tools } : {}),
      messages,
    });

    const toolCalls = resp.content
      .filter((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use')
      .map((c) => ({
        id: c.id,
        name: c.name,
        input: c.input as Record<string, unknown>,
      }));

    const textBlock = resp.content.find(
      (c): c is Anthropic.TextBlock => c.type === 'text',
    );

    // วินิจฉัยเคสตอบว่าง: ถ้าไม่มีทั้ง text และ tool_use ให้บันทึกโครงสร้าง
    // ที่ได้จริง (เช่น มีแต่ thinking block / โดน max_tokens ตัด) จะได้ไล่ต่อได้
    if (!textBlock && toolCalls.length === 0) {
      this.logger.warn(
        `[EmptyReply] model=${model} stop_reason=${resp.stop_reason} blocks=${JSON.stringify(resp.content.map((c) => c.type))}`,
      );
    }

    // inputTokens = ปริมาณที่ประมวลผลจริงทั้งหมด (รวม cache read/write) เพื่อให้ log
    // สะท้อน volume จริง — cache read คิดเงินแค่ 0.1x ของราคา input ปกติ
    const usage = resp.usage;
    const cachedIn =
      (usage.cache_read_input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0);

    return {
      text: textBlock?.text ?? '',
      toolCalls,
      inputTokens: usage.input_tokens + cachedIn,
      outputTokens: usage.output_tokens,
      modelName: model,
    };
  }

  /** อ่าน model จาก SystemConfig (TTL 60s) — แถวหาย/ค่าว่าง = ใช้ default (Haiku) */
  private async resolveModel(): Promise<string> {
    if (
      this.modelCache &&
      Date.now() - this.modelCache.readAt < MODEL_CACHE_TTL_MS
    ) {
      return this.modelCache.value;
    }
    let model = DEFAULT_CLAUDE_MODEL;
    try {
      const cfg = await this.prisma.systemConfig.findFirst({
        where: { key: MODEL_CONFIG_KEY, deletedAt: null },
        select: { value: true },
      });
      const raw = (cfg?.value ?? '').trim();
      if (raw) model = raw;
    } catch (err) {
      this.logger.error(
        `Failed to read ${MODEL_CONFIG_KEY}: ${err instanceof Error ? err.message : err} — using ${DEFAULT_CLAUDE_MODEL}`,
      );
    }
    this.modelCache = { value: model, readAt: Date.now() };
    return model;
  }

  /**
   * Project provider-agnostic LlmChatMessage[] to Anthropic MessageParam[].
   * Consecutive `role: 'tool'` messages collapse into a single user message
   * carrying multiple tool_result blocks (Anthropic requires this shape).
   * Assistant turns with toolCalls render as content blocks (text + tool_use).
   */
  private projectMessages(messages: LlmChatMessage[]): Anthropic.MessageParam[] {
    const out: Anthropic.MessageParam[] = [];
    let pendingToolResults: Anthropic.ToolResultBlockParam[] = [];

    const flushToolResults = () => {
      if (pendingToolResults.length === 0) return;
      out.push({ role: 'user', content: pendingToolResults });
      pendingToolResults = [];
    };

    for (const msg of messages) {
      if (msg.role === 'tool') {
        pendingToolResults.push({
          type: 'tool_result',
          tool_use_id: msg.toolCallId,
          content: msg.content,
        });
        continue;
      }

      flushToolResults();

      if (msg.role === 'user') {
        out.push({ role: 'user', content: msg.content });
        continue;
      }

      // assistant
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (msg.content) {
        blocks.push({ type: 'text', text: msg.content });
      }
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          blocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.input,
          });
        }
      }
      // Edge case: assistant turn with neither text nor toolCalls — skip
      if (blocks.length > 0) {
        out.push({ role: 'assistant', content: blocks });
      }
    }

    flushToolResults();

    return out;
  }
}
