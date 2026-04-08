import { Injectable, Logger } from '@nestjs/common';
import { FinanceToolsService } from '../services/finance-tools.service';
import { ToolName } from './tool-definitions';

export interface ToolCallRequest {
  name: string;
  input: Record<string, unknown>;
}

export interface ToolCallResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Routes Claude tool_use requests → FinanceToolsService methods
 *
 * Security: customerId มาจาก orchestrator (verified) — Claude เปลี่ยนไม่ได้
 */
@Injectable()
export class FinanceToolExecutor {
  private readonly logger = new Logger(FinanceToolExecutor.name);

  constructor(private tools: FinanceToolsService) {}

  async execute(req: ToolCallRequest, customerId: string): Promise<ToolCallResult> {
    this.logger.log(`[Tool] ${req.name} for customer ${customerId.slice(0, 8)}...`);

    try {
      switch (req.name as ToolName) {
        case 'get_current_balance': {
          const data = await this.tools.getCurrentBalance(customerId);
          return { ok: true, data };
        }

        case 'get_payment_schedule': {
          const data = await this.tools.getPaymentSchedule(customerId);
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
          const data = await this.tools.listRecentReceipts(customerId);
          return { ok: true, data };
        }

        case 'get_bank_info': {
          return { ok: true, data: this.tools.getBankInfo() };
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
