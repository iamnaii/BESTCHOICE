import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { FinanceToolsService } from '../services/finance-tools.service';
import { KnowledgeService } from '../services/knowledge.service';
import { HandoffService, HandoffPriority } from '../services/handoff.service';
import { ToolName } from './tool-definitions';
import { redactPii, validateToolInput } from './tool-input-schemas';

export interface ToolCallRequest {
  name: string;
  input: Record<string, unknown>;
}

export interface ToolCallContext {
  customerId: string;
  roomId: string;
}

export interface ToolCallResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  /** Side-effect: ถ้า tool นี้ trigger handoff ตั้งค่านี้ */
  triggeredHandoff?: boolean;
}

/**
 * Routes Claude tool_use → service methods
 * Security: customerId/sessionId มาจาก orchestrator — Claude เปลี่ยนไม่ได้
 */
@Injectable()
export class FinanceToolExecutor {
  private readonly logger = new Logger(FinanceToolExecutor.name);

  constructor(
    private tools: FinanceToolsService,
    private knowledge: KnowledgeService,
    private handoff: HandoffService,
  ) {}

  async execute(req: ToolCallRequest, ctx: ToolCallContext): Promise<ToolCallResult> {
    this.logger.log(`[Tool] ${req.name} for customer ${ctx.customerId.slice(0, 8)}...`);

    // T6-C16: validate tool input against per-tool schema before executing.
    // Prompt injection can coerce Claude into emitting odd shapes / PII-laden
    // args; reject early and log redacted args for audit.
    const validated = validateToolInput(req.name, req.input);
    if (!validated.ok) {
      this.logger.warn(
        `[Tool] Rejected invalid input for ${req.name}: ${validated.error}`,
      );
      Sentry.captureMessage('FinanceAI tool input rejected', {
        level: 'warning',
        tags: { module: 'chatbot-finance', action: 'tool_input_invalid' },
        extra: {
          toolName: req.name,
          error: validated.error,
          inputRedacted: redactPii(req.input),
        },
      });
      return { ok: false, error: validated.error };
    }
    const input = validated.value;

    try {
      switch (req.name as ToolName) {
        case 'get_current_balance': {
          const data = await this.tools.getCurrentBalance(ctx.customerId);
          return { ok: true, data };
        }

        case 'get_payment_schedule': {
          const data = await this.tools.getPaymentSchedule(ctx.customerId);
          return { ok: true, data };
        }

        case 'calculate_fine': {
          const days = input.daysOverdue as number;
          return { ok: true, data: this.tools.calculateFine(days) };
        }

        case 'list_recent_receipts': {
          const data = await this.tools.listRecentReceipts(ctx.customerId);
          return { ok: true, data };
        }

        case 'get_bank_info': {
          return { ok: true, data: this.tools.getBankInfo() };
        }

        case 'search_knowledge_base': {
          const query = input.query as string;
          const matches = await this.knowledge.search(query);
          return { ok: true, data: { matches } };
        }

        case 'handoff_to_human': {
          const reason = input.reason as string;
          const priority = input.priority as HandoffPriority;
          const summary = input.summary as string;
          const result = await this.handoff.handoff({
            roomId: ctx.roomId,
            reason,
            priority,
            summary,
          });
          return { ok: true, data: result, triggeredHandoff: true };
        }

        default:
          return { ok: false, error: `unknown tool: ${req.name}` };
      }
    } catch (err) {
      this.logger.error(
        `[Tool] ${req.name} failed: ${err instanceof Error ? err.message : err}`,
      );
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Tool execution error',
      };
    }
  }
}
