import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleAuth } from 'google-auth-library';
import {
  ILlmProvider,
  LlmChatMessage,
  LlmChatRequest,
  LlmChatResponse,
  LlmProviderName,
  LlmToolCall,
  LlmToolDefinition,
} from './llm-provider.interface';

const DEFAULT_MODEL = 'gemini-2.5-flash';
const DEFAULT_LOCATION = 'us-central1';
const VERTEX_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const DEFAULT_MAX_TOKENS = 1024;

interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: Array<
        | { text: string }
        | { functionCall: { name: string; args: Record<string, unknown> } }
      >;
    };
    finishReason?: string;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

type Mode = 'aistudio' | 'vertex';

/**
 * Wraps Google's Gemini chat API behind ILlmProvider.
 *
 * Two transport paths supported, selected at startup:
 *
 * 1. **AI Studio** (`mode='aistudio'`) — used when `GEMINI_API_KEY` env is set.
 *    Hits `generativelanguage.googleapis.com` with API key auth.
 *    Faster to set up: paid tier API key (https://aistudio.google.com/app/apikey),
 *    no GCP project approval needed. **Paid tier opts out of data training**
 *    (free tier does train, so we explicitly require paid).
 *
 * 2. **Vertex AI** (`mode='vertex'`) — used when GEMINI_API_KEY absent but
 *    `GOOGLE_CLOUD_PROJECT` is set. Hits
 *    `${LOCATION}-aiplatform.googleapis.com` with ADC (GoogleAuth).
 *    Requires owner to accept Gemini terms in GCP console first.
 *    Better long-term: GCP-native IAM, single billing, enterprise compliance.
 *
 * If neither env present → isReady() returns false → registry falls back to Claude.
 *
 * Tool calling: converts JSON Schema → OpenAPI subset (same wire format for both).
 * Function-call id: Gemini doesn't return one — we synthesize `fn_<i>_<name>`
 * so SalesBotService can correlate tool result back to the call.
 */
@Injectable()
export class GeminiProvider implements ILlmProvider {
  readonly providerName: LlmProviderName = 'gemini';
  private readonly logger = new Logger(GeminiProvider.name);
  private readonly mode: Mode | null;
  private readonly model: string;
  // Vertex-only fields
  private readonly auth: GoogleAuth;
  private readonly project: string | undefined;
  private readonly location: string;
  // AI Studio-only fields
  private readonly apiKey: string | undefined;

  constructor(private config: ConfigService) {
    this.apiKey = this.config.get<string>('GEMINI_API_KEY');
    this.project =
      this.config.get<string>('GOOGLE_CLOUD_PROJECT') ??
      this.config.get<string>('GCP_PROJECT_ID');
    this.location = this.config.get<string>('VERTEX_LOCATION') ?? DEFAULT_LOCATION;
    this.model = this.config.get<string>('GEMINI_MODEL') ?? DEFAULT_MODEL;
    this.auth = new GoogleAuth({ scopes: [VERTEX_SCOPE] });

    if (this.apiKey) {
      this.mode = 'aistudio';
      this.logger.log(`GeminiProvider: AI Studio mode (model=${this.model})`);
    } else if (this.project) {
      this.mode = 'vertex';
      this.logger.log(
        `GeminiProvider: Vertex mode (project=${this.project}, location=${this.location}, model=${this.model})`,
      );
    } else {
      this.mode = null;
      this.logger.warn(
        'GeminiProvider: neither GEMINI_API_KEY nor GOOGLE_CLOUD_PROJECT set — provider not ready, registry will fall back to Claude',
      );
    }
  }

  isReady(): boolean {
    return this.mode !== null;
  }

  async chat(req: LlmChatRequest): Promise<LlmChatResponse> {
    if (this.mode === null) {
      throw new ServiceUnavailableException(
        'GeminiProvider not configured — set GEMINI_API_KEY (AI Studio) or GOOGLE_CLOUD_PROJECT (Vertex)',
      );
    }

    const body = this.buildRequestBody(req);

    const endpoint =
      this.mode === 'aistudio'
        ? `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`
        : `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.project}/locations/${this.location}/publishers/google/models/${this.model}:generateContent`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.mode === 'vertex') {
      const client = await this.auth.getClient();
      const accessToken = (await client.getAccessToken()).token;
      if (!accessToken) {
        throw new ServiceUnavailableException(
          'ไม่สามารถขอ access token ของ Google Cloud ได้ — ตรวจสอบ ADC',
        );
      }
      headers.Authorization = `Bearer ${accessToken}`;
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      this.logger.error(
        `Gemini ${this.mode} failed (${res.status}): ${errBody.slice(0, 300)}`,
      );
      throw new ServiceUnavailableException(
        `Gemini ${this.mode} failed: ${res.status}`,
      );
    }

    const json = (await res.json()) as GeminiResponse;
    const candidate = json.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];

    let text = '';
    const toolCalls: LlmToolCall[] = [];
    parts.forEach((part, idx) => {
      if ('text' in part && part.text) {
        text += part.text;
      } else if ('functionCall' in part && part.functionCall) {
        toolCalls.push({
          id: `fn_${idx}_${part.functionCall.name}`,
          name: part.functionCall.name,
          input: part.functionCall.args ?? {},
        });
      }
    });

    return {
      text,
      toolCalls,
      inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
      modelName: `${this.model} (${this.mode})`,
    };
  }

  private buildRequestBody(req: LlmChatRequest): Record<string, unknown> {
    const contents = this.projectMessages(req.messages);
    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: req.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
      temperature: 0.7,
    };

    // Gemini 2.5+ defaults to "thinking mode" — model consumes hundreds of
    // hidden reasoning tokens before producing user-visible output. For a
    // sales chat (latency-sensitive, short replies) that's pure overhead:
    // it makes greetings hit MAX_TOKENS truncation and inflates cost ~8x.
    // Verified empirically on 2026-05-21: same Thai greeting prompt used
    // 190 thoughtsTokens at default vs 0 with thinkingBudget=0, output
    // identical-quality and complete instead of truncated.
    if (this.model.startsWith('gemini-2.5')) {
      generationConfig.thinkingConfig = { thinkingBudget: 0 };
    }

    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: req.systemPrompt }] },
      contents,
      generationConfig,
    };

    if (req.tools && req.tools.length > 0) {
      body.tools = [
        { functionDeclarations: req.tools.map((t) => this.toGeminiTool(t)) },
      ];
    }

    return body;
  }

  /**
   * Project provider-agnostic LlmChatMessage[] to Gemini `contents` array.
   *
   * Wire format is identical between Vertex and AI Studio for chat content:
   * - user → { role: 'user', parts: [{ text }] }
   * - assistant text → { role: 'model', parts: [{ text }] }
   * - assistant tool_calls → { role: 'model', parts: [{ functionCall }, ...] }
   * - tool result(s) → { role: 'user', parts: [{ functionResponse }, ...] }
   *
   * **Multi-tool turn handling** (Gemini-specific contract):
   * When the assistant turn contains N functionCall parts, Gemini requires
   * the next user turn to contain ALL N functionResponse parts in a SINGLE
   * turn — NOT N separate user turns. Pushing N separate turns triggers a
   * 400 INVALID_ARGUMENT: "Please ensure that the number of function
   * response parts is equal to the number of function call parts of the
   * function call turn."
   *
   * The persona's "3-Combo Anchor Pricing" playbook routinely calls 4 tools
   * at once (search_products + calculate_installment × 3), so this isn't a
   * corner case — it's the dominant tool-using path.
   *
   * Implementation: when projecting a `role: 'tool'` message, check whether
   * the previous projected turn is already a user turn containing only
   * functionResponse parts. If yes, APPEND the new functionResponse to that
   * turn. Otherwise, start a fresh user turn. Single-tool flows still work
   * — they just produce a user turn with one functionResponse part, same
   * wire format.
   *
   * Repro that drove this fix (2026-05-21 prod): Nai sent "15 ธรรมดา" →
   * Gemini called search + calc×3 in one turn → our service pushed 4
   * separate user turns → Gemini 400 → no reply.
   *
   * Gemini does NOT use tool_call ids. The `functionResponse.name` must
   * match the original functionCall name; the response object is opaque
   * payload. Multiple tool calls/results with the same name match by
   * position — preserved by iterating `messages` in order.
   */
  private projectMessages(messages: LlmChatMessage[]): unknown[] {
    const out: { role: string; parts: unknown[] }[] = [];
    const idToName = new Map<string, string>();

    for (const msg of messages) {
      if (msg.role === 'user') {
        out.push({ role: 'user', parts: [{ text: msg.content }] });
        continue;
      }

      if (msg.role === 'assistant') {
        const parts: unknown[] = [];
        if (msg.content) {
          parts.push({ text: msg.content });
        }
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            idToName.set(tc.id, tc.name);
            parts.push({
              functionCall: { name: tc.name, args: tc.input },
            });
          }
        }
        if (parts.length > 0) {
          out.push({ role: 'model', parts });
        }
        continue;
      }

      // role === 'tool'
      const name =
        idToName.get(msg.toolCallId) ?? msg.toolCallId.replace(/^fn_\d+_/, '');
      const responsePart = {
        functionResponse: {
          name,
          response: this.parseToolContent(msg.content),
        },
      };

      // Group with previous tool-result turn if it's still "open" (i.e. the
      // last projected turn is a user turn made entirely of functionResponse
      // parts). Defensive `every()` check makes sure we never sneak a
      // functionResponse into a turn that also carries `text` parts.
      const last = out[out.length - 1];
      const isOpenToolResultTurn =
        last !== undefined &&
        last.role === 'user' &&
        last.parts.length > 0 &&
        last.parts.every(
          (p) => p !== null && typeof p === 'object' && 'functionResponse' in p,
        );

      if (isOpenToolResultTurn) {
        last.parts.push(responsePart);
      } else {
        out.push({ role: 'user', parts: [responsePart] });
      }
    }

    return out;
  }

  private parseToolContent(content: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return { result: parsed };
    } catch {
      return { result: content };
    }
  }

  private toGeminiTool(t: LlmToolDefinition): {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  } {
    return {
      name: t.name,
      description: t.description,
      parameters: this.sanitizeSchema(t.inputSchema),
    };
  }

  /**
   * Sanitize JSON Schema → Gemini-accepted OpenAPI subset.
   * Both Vertex and AI Studio accept the same schema shape.
   */
  private sanitizeSchema(schema: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const allowed = new Set([
      'type',
      'description',
      'enum',
      'items',
      'properties',
      'required',
      'format',
      'nullable',
    ]);
    for (const [k, v] of Object.entries(schema)) {
      if (!allowed.has(k)) continue;
      if (k === 'properties' && v && typeof v === 'object') {
        const props = v as Record<string, Record<string, unknown>>;
        const cleanProps: Record<string, unknown> = {};
        for (const [pk, pv] of Object.entries(props)) {
          cleanProps[pk] = this.sanitizeSchema(pv);
        }
        out[k] = cleanProps;
      } else if (k === 'items' && v && typeof v === 'object') {
        out[k] = this.sanitizeSchema(v as Record<string, unknown>);
      } else {
        out[k] = v;
      }
    }
    return out;
  }
}
