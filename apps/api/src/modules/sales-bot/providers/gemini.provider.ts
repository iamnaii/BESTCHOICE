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

const DEFAULT_MODEL = 'gemini-2.0-flash-001';
const DEFAULT_LOCATION = 'us-central1';
const VERTEX_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const DEFAULT_MAX_TOKENS = 1024;

interface VertexGeminiResponse {
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

/**
 * Wraps Vertex AI's Gemini generateContent endpoint behind ILlmProvider.
 *
 * Auth: reuses Application Default Credentials (same as EmbeddingService).
 * Tool calling: converts JSON Schema → OpenAPI subset (Gemini's `parameters`).
 * Function-call id: Gemini doesn't return one — we synthesize `fn_<i>_<name>`
 * so SalesBotService can correlate tool result back to the call. The synthetic
 * id round-trips correctly because both halves of the loop live in
 * SalesBotService memory — Gemini itself never sees the id field.
 */
@Injectable()
export class GeminiProvider implements ILlmProvider {
  readonly providerName: LlmProviderName = 'gemini';
  private readonly logger = new Logger(GeminiProvider.name);
  private readonly auth: GoogleAuth;
  private readonly project: string | undefined;
  private readonly location: string;
  private readonly model: string;

  constructor(private config: ConfigService) {
    this.project =
      this.config.get<string>('GOOGLE_CLOUD_PROJECT') ??
      this.config.get<string>('GCP_PROJECT_ID');
    this.location = this.config.get<string>('VERTEX_LOCATION') ?? DEFAULT_LOCATION;
    this.model = this.config.get<string>('VERTEX_GEMINI_MODEL') ?? DEFAULT_MODEL;
    this.auth = new GoogleAuth({ scopes: [VERTEX_SCOPE] });

    if (!this.project) {
      this.logger.warn(
        'GOOGLE_CLOUD_PROJECT not set — GeminiProvider will fail at call time. Set env var or run `gcloud auth application-default login`.',
      );
    }
  }

  isReady(): boolean {
    return Boolean(this.project);
  }

  async chat(req: LlmChatRequest): Promise<LlmChatResponse> {
    if (!this.project) {
      throw new ServiceUnavailableException(
        'GOOGLE_CLOUD_PROJECT ไม่ได้ตั้งค่า — GeminiProvider ใช้ไม่ได้',
      );
    }

    const endpoint = `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.project}/locations/${this.location}/publishers/google/models/${this.model}:generateContent`;

    const client = await this.auth.getClient();
    const accessToken = (await client.getAccessToken()).token;
    if (!accessToken) {
      throw new ServiceUnavailableException(
        'ไม่สามารถขอ access token ของ Google Cloud ได้ — ตรวจสอบ ADC',
      );
    }

    const contents = this.projectMessages(req.messages);
    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: req.systemPrompt }] },
      contents,
      generationConfig: {
        maxOutputTokens: req.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
        temperature: 0.7,
      },
    };

    if (req.tools && req.tools.length > 0) {
      body.tools = [{ functionDeclarations: req.tools.map((t) => this.toVertexTool(t)) }];
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      this.logger.error(`Vertex Gemini failed (${res.status}): ${errBody}`);
      throw new ServiceUnavailableException(`Vertex Gemini failed: ${res.status}`);
    }

    const json = (await res.json()) as VertexGeminiResponse;
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
      modelName: this.model,
    };
  }

  /**
   * Project provider-agnostic LlmChatMessage[] to Vertex `contents` array.
   *
   * Vertex maps:
   * - user → { role: 'user', parts: [{ text }] }
   * - assistant text → { role: 'model', parts: [{ text }] }
   * - assistant tool_calls → { role: 'model', parts: [{ functionCall }, ...] }
   * - tool result → { role: 'user', parts: [{ functionResponse: { name, response } }] }
   *
   * Gemini does NOT use tool_call ids. The `functionResponse.name` must match
   * the original functionCall name; the response object is opaque payload.
   * If multiple tool calls/results exist for the same name, Gemini matches by
   * position — order is preserved in projection.
   */
  private projectMessages(messages: LlmChatMessage[]): unknown[] {
    const out: unknown[] = [];
    /**
     * Map from synthesized toolCallId → original tool name. SalesBotService
     * accumulates tool messages by id, but Gemini wants name. We track here.
     */
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
      const name = idToName.get(msg.toolCallId) ?? msg.toolCallId.replace(/^fn_\d+_/, '');
      out.push({
        role: 'user',
        parts: [
          {
            functionResponse: {
              name,
              response: this.parseToolContent(msg.content),
            },
          },
        ],
      });
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

  /**
   * Convert tool definition from neutral JSON Schema → Vertex FunctionDeclaration.
   *
   * Vertex's `parameters` accepts OpenAPI schema subset. Most JSON Schema
   * features map 1:1. Strip unsupported keys (e.g. $schema, definitions) to
   * avoid 400 INVALID_ARGUMENT.
   */
  private toVertexTool(t: LlmToolDefinition): {
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
