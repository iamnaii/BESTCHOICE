/**
 * Provider-agnostic LLM chat interface for SHOP Sales AI.
 *
 * Pattern matches OpenAI/industry-standard tool calling:
 * - assistant turns may carry text, tool_calls, or both
 * - tool results come as separate `role: 'tool'` messages tied by toolCallId
 *
 * Implementations wrap a specific vendor SDK (Claude/Anthropic, Gemini/Vertex)
 * and expose a single chat() entrypoint. SalesBotService runs the tool loop
 * against this interface — swapping providers requires zero changes to
 * tool-handling logic.
 *
 * See: docs/superpowers/specs/2026-05-21-shop-ai-thai-quality-design.md
 */

export const LLM_PROVIDER_REGISTRY_TOKEN = 'LLM_PROVIDER_REGISTRY';

export type LlmProviderName = 'claude' | 'gemini';

export interface LlmToolDefinition {
  name: string;
  description: string;
  /**
   * JSON Schema for tool input. Anthropic uses this under `input_schema`;
   * Gemini transforms to OpenAPI subset under `parameters`. Use plain JSON
   * Schema (type/properties/required) — providers handle vendor projection.
   */
  inputSchema: Record<string, unknown>;
}

export interface LlmToolCall {
  /** Vendor-assigned identifier — must round-trip back as LlmToolMessage.toolCallId */
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type LlmChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: LlmToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

export interface LlmChatRequest {
  systemPrompt: string;
  messages: LlmChatMessage[];
  tools?: LlmToolDefinition[];
  maxOutputTokens?: number;
}

export interface LlmChatResponse {
  /** Final assistant text. Empty string if response is tool calls only. */
  text: string;
  /** Tool calls the model wants executed before continuing. */
  toolCalls: LlmToolCall[];
  inputTokens: number;
  outputTokens: number;
  /** Concrete model identifier used (for audit/logging). */
  modelName: string;
}

export interface ILlmProvider {
  readonly providerName: LlmProviderName;
  chat(req: LlmChatRequest): Promise<LlmChatResponse>;
}
