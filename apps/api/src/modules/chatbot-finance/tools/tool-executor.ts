import { Injectable, Logger } from '@nestjs/common';
import { FinanceToolsService } from '../services/finance-tools.service';
import { KnowledgeService } from '../services/knowledge.service';
import { HandoffService, HandoffPriority } from '../services/handoff.service';
import { ToolName } from './tool-definitions';

export interface ToolCallRequest {
  name: string;
  input: Record<string, unknown>;
}

export interface ToolCallContext {
  customerId: string;
  sessionId: string;
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
          const days = Number(req.input.daysOverdue);
          if (!Number.isFinite(days) || days < 0) {
            return { ok: false, error: 'daysOverdue ต้องเป็นตัวเลขไม่ติดลบ' };
          }
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
          const query = String(req.input.query || '');
          if (!query) return { ok: false, error: 'query is required' };
          const matches = await this.knowledge.search(query);
          return { ok: true, data: { matches } };
        }

        case 'handoff_to_human': {
          const reason = String(req.input.reason || 'unspecified');
          const priority = String(req.input.priority || 'normal') as HandoffPriority;
          const summary = String(req.input.summary || '');
          const result = await this.handoff.handoff({
            sessionId: ctx.sessionId,
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
