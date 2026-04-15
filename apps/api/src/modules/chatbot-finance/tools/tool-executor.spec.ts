import { Test, TestingModule } from '@nestjs/testing';
import { FinanceToolExecutor } from './tool-executor';
import { FinanceToolsService } from '../services/finance-tools.service';
import { KnowledgeService } from '../services/knowledge.service';
import { HandoffService } from '../services/handoff.service';

describe('FinanceToolExecutor', () => {
  let executor: FinanceToolExecutor;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tools: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let knowledge: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let handoff: any;

  const ctx = { customerId: 'cust-1', roomId: 'sess-1' };

  beforeEach(async () => {
    tools = {
      getCurrentBalance: jest.fn().mockResolvedValue({ found: true, totalAmount: 3500 }),
      getPaymentSchedule: jest.fn().mockResolvedValue({ found: true, remainingInstallments: 5 }),
      calculateFine: jest.fn().mockReturnValue({ totalFine: 150 }),
      listRecentReceipts: jest.fn().mockResolvedValue({ found: true, receipts: [] }),
      getBankInfo: jest.fn().mockReturnValue({ bankName: 'KBank' }),
    };
    knowledge = {
      search: jest.fn().mockResolvedValue([{ intent: 'faq', score: 2 }]),
    };
    handoff = {
      handoff: jest.fn().mockResolvedValue({ handoffId: 'sess-1', estimatedTime: '2 ชั่วโมง' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceToolExecutor,
        { provide: FinanceToolsService, useValue: tools },
        { provide: KnowledgeService, useValue: knowledge },
        { provide: HandoffService, useValue: handoff },
      ],
    }).compile();

    executor = module.get(FinanceToolExecutor);
  });

  it('routes get_current_balance to tools service', async () => {
    const result = await executor.execute({ name: 'get_current_balance', input: {} }, ctx);
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ found: true, totalAmount: 3500 });
    expect(tools.getCurrentBalance).toHaveBeenCalledWith('cust-1');
  });

  it('routes get_payment_schedule correctly', async () => {
    const result = await executor.execute({ name: 'get_payment_schedule', input: {} }, ctx);
    expect(result.ok).toBe(true);
    expect(tools.getPaymentSchedule).toHaveBeenCalledWith('cust-1');
  });

  it('routes calculate_fine with validated input', async () => {
    const result = await executor.execute(
      { name: 'calculate_fine', input: { daysOverdue: 3 } },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(tools.calculateFine).toHaveBeenCalledWith(3);
  });

  it('rejects calculate_fine with negative days', async () => {
    const result = await executor.execute(
      { name: 'calculate_fine', input: { daysOverdue: -1 } },
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('ไม่ติดลบ');
  });

  it('routes search_knowledge_base to knowledge service', async () => {
    const result = await executor.execute(
      { name: 'search_knowledge_base', input: { query: 'ค่าปรับ' } },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(knowledge.search).toHaveBeenCalledWith('ค่าปรับ');
  });

  it('rejects search_knowledge_base without query', async () => {
    const result = await executor.execute(
      { name: 'search_knowledge_base', input: { query: '' } },
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('required');
  });

  it('routes handoff_to_human and sets triggeredHandoff', async () => {
    const result = await executor.execute(
      {
        name: 'handoff_to_human',
        input: { reason: 'complaint', priority: 'critical', summary: 'ลูกค้าไม่พอใจ' },
      },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.triggeredHandoff).toBe(true);
    expect(handoff.handoff).toHaveBeenCalledWith({
      roomId: 'sess-1',
      reason: 'complaint',
      priority: 'critical',
      summary: 'ลูกค้าไม่พอใจ',
    });
  });

  it('returns error for unknown tool', async () => {
    const result = await executor.execute({ name: 'nonexistent_tool', input: {} }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('unknown tool');
  });

  it('catches service exceptions and returns error', async () => {
    tools.getCurrentBalance.mockRejectedValue(new Error('DB down'));
    const result = await executor.execute({ name: 'get_current_balance', input: {} }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('DB down');
  });
});
