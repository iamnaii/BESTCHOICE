import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { IntegrationConfigService } from '../../integrations/integration-config.service';
import { AiUsageService } from '../../ai-usage/ai-usage.service';
import { parseJsonResponse } from './ocr-parsing.util';

@Injectable()
export class AnthropicOcrClient {
  private readonly logger = new Logger(AnthropicOcrClient.name);
  private anthropic: Anthropic | null = null;

  static readonly OCR_SYSTEM_PROMPT =
    'คุณเป็นผู้เชี่ยวชาญด้าน OCR สำหรับเอกสารไทย มีความแม่นยำสูงสุดในการอ่านตัวอักษรไทยและตัวเลขจากรูปถ่ายเอกสาร ' +
    'ให้พยายามอ่านข้อมูลทุกตัวอักษรอย่างระมัดระวัง แม้รูปจะเบลอหรือมีแสงสะท้อน ' +
    'ถ้าตัวอักษรไม่ชัด ให้ใช้บริบทรอบข้างช่วยในการตีความ เช่น รูปแบบเลขบัตรประชาชน 13 หลัก หรือชื่อธนาคารที่คุ้นเคย ' +
    'ตอบเป็น JSON เท่านั้น ห้ามมี markdown code block หรือข้อความอื่นใดนอกเหนือจาก JSON';

  static readonly OCR_MODEL = 'claude-sonnet-4-6';
  static readonly LOW_CONFIDENCE_THRESHOLD = 0.7;
  static readonly MAX_RETRIES = 2;

  constructor(
    private integrationConfig: IntegrationConfigService,
    private aiUsage: AiUsageService,
  ) {}

  private async getAnthropicClient(): Promise<Anthropic | null> {
    const apiKey = ((await this.integrationConfig.getValue('claude-ai', 'apiKey')) || '').trim();
    if (!apiKey) return null;
    if (!this.anthropic) {
      this.anthropic = new Anthropic({ apiKey, timeout: 120_000 });
    }
    return this.anthropic;
  }

  async ensureAnthropicReady(): Promise<Anthropic> {
    const client = await this.getAnthropicClient();
    if (!client) {
      throw new BadRequestException('OCR ไม่พร้อมใช้งาน — ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY');
    }
    return client;
  }

  /** Check if Anthropic AI is configured and reachable */
  async checkAiStatus(): Promise<{ configured: boolean; connected: boolean; model: string; error?: string }> {
    const model = AnthropicOcrClient.OCR_MODEL;
    const client = await this.getAnthropicClient();
    if (!client) {
      return { configured: false, connected: false, model, error: 'ANTHROPIC_API_KEY ไม่ได้ตั้งค่า' };
    }
    try {
      // Use count_tokens as a lightweight ping — no tokens consumed
      await client.messages.countTokens({
        model,
        messages: [{ role: 'user', content: 'ping' }],
      });
      return { configured: true, connected: true, model };
    } catch (err) {
      // If count_tokens not available, try a simple messages call
      try {
        const response = await client.messages.create({
          model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        });
        void this.aiUsage.record({
          service: 'ocr',
          method: 'checkAiStatus',
          model,
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
          status: 'success',
        });
        return { configured: true, connected: true, model };
      } catch (err2) {
        const msg = (err2 as Error).message || 'Unknown error';
        return { configured: true, connected: false, model, error: msg };
      }
    }
  }

  async callClaudeOcr(
    mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
    base64Data: string,
    prompt: string,
  ): Promise<Record<string, unknown>> {
    const client = await this.ensureAnthropicReady();
    const response = await client.messages.create({
      model: AnthropicOcrClient.OCR_MODEL,
      max_tokens: 2048,
      temperature: 0,
      system: AnthropicOcrClient.OCR_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64Data },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });

    void this.aiUsage.record({
      service: 'ocr',
      method: 'callClaudeOcr',
      model: AnthropicOcrClient.OCR_MODEL,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      status: 'success',
    });

    const textContent = response.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new InternalServerErrorException('No text response from Claude');
    }

    return parseJsonResponse(textContent.text) as Record<string, unknown>;
  }

  async callClaudeOcrWithRetry(
    mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
    base64Data: string,
    prompt: string,
    retryPrompt: string,
  ): Promise<Record<string, unknown>> {
    let bestResult = await this.callClaudeOcr(mediaType, base64Data, prompt);
    const confidence = Number(bestResult.confidence) || 0;

    if (confidence < AnthropicOcrClient.LOW_CONFIDENCE_THRESHOLD) {
      this.logger.warn(`Low confidence (${confidence.toFixed(2)}), retrying with enhanced prompt`);
      for (let attempt = 0; attempt < AnthropicOcrClient.MAX_RETRIES; attempt++) {
        try {
          const retryResult = await this.callClaudeOcr(mediaType, base64Data, retryPrompt);
          const retryConfidence = Number(retryResult.confidence) || 0;
          if (retryConfidence > confidence) {
            bestResult = retryResult;
            break;
          }
        } catch {
          this.logger.warn(`Retry attempt ${attempt + 1} failed`);
        }
      }
    }

    return bestResult;
  }

  async callClaudeOcrMultiFile(
    files: Array<{ mediaType: string; base64Data: string; isDocument: boolean }>,
    prompt: string,
  ): Promise<Record<string, unknown>> {
    const client = await this.ensureAnthropicReady();

    const fileBlocks = files.map((f) =>
      f.isDocument
        ? {
            type: 'document' as const,
            source: {
              type: 'base64' as const,
              media_type: 'application/pdf' as const,
              data: f.base64Data,
            },
          }
        : {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: f.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: f.base64Data,
            },
          },
    );

    const response = await client.messages.create({
      model: AnthropicOcrClient.OCR_MODEL,
      max_tokens: 2048,
      temperature: 0,
      system: AnthropicOcrClient.OCR_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [...fileBlocks, { type: 'text', text: prompt }],
        },
      ],
    });

    void this.aiUsage.record({
      service: 'ocr',
      method: 'callClaudeOcrMultiFile',
      model: AnthropicOcrClient.OCR_MODEL,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      status: 'success',
    });

    const textContent = response.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new InternalServerErrorException('No text response from Claude');
    }

    return parseJsonResponse(textContent.text) as Record<string, unknown>;
  }

  async callClaudeOcrMultiFileWithRetry(
    files: Array<{ mediaType: string; base64Data: string; isDocument: boolean }>,
    prompt: string,
    retryPrompt: string,
  ): Promise<Record<string, unknown>> {
    let bestResult = await this.callClaudeOcrMultiFile(files, prompt);
    const confidence = Number(bestResult.confidence) || 0;

    if (confidence < AnthropicOcrClient.LOW_CONFIDENCE_THRESHOLD) {
      this.logger.warn(`Low confidence (${confidence.toFixed(2)}), retrying with enhanced prompt`);
      for (let attempt = 0; attempt < AnthropicOcrClient.MAX_RETRIES; attempt++) {
        try {
          const retryResult = await this.callClaudeOcrMultiFile(files, retryPrompt);
          const retryConfidence = Number(retryResult.confidence) || 0;
          if (retryConfidence > confidence) {
            bestResult = retryResult;
            break;
          }
        } catch {
          this.logger.warn(`Retry attempt ${attempt + 1} failed`);
        }
      }
    }

    return bestResult;
  }
}
