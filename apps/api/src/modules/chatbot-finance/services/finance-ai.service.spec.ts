import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FinanceAiService } from './finance-ai.service';
import { FinanceToolExecutor } from '../tools/tool-executor';
import { FinanceConfigService } from './finance-config.service';
import { IntegrationConfigService } from '../../integrations/integration-config.service';
import { AiUsageService } from '../../ai-usage/ai-usage.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { HandoffService } from './handoff.service';

// Phase 7.2 model-routing tests drive the Anthropic tool loop, so mock the SDK to give
// `new Anthropic()` a controllable `messages.create`. (Other tests never invoke create.)
const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ messages: { create: mockCreate } })),
}));

const textResponse = (text: string) => ({
  stop_reason: 'end_turn',
  content: [{ type: 'text', text }],
  usage: { input_tokens: 5, output_tokens: 5 },
});
const toolUseResponse = (name: string) => ({
  stop_reason: 'tool_use',
  content: [{ type: 'tool_use', id: 'tu_1', name, input: {} }],
  usage: { input_tokens: 5, output_tokens: 5 },
});

describe('FinanceAiService', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let toolExecutor: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const defaultParams = {
    userMessage: 'ยอดเท่าไหร่',
    history: [],
    customerId: 'cust-1',
    customerName: 'สมชาย',
    roomId: 'sess-1',
  };

  describe('when ANTHROPIC_API_KEY is not set', () => {
    let service: FinanceAiService;

    beforeEach(async () => {
      toolExecutor = { execute: jest.fn() };
      prisma = { chatMessage: { findMany: jest.fn().mockResolvedValue([]) } };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FinanceAiService,
          {
            provide: ConfigService,
            useValue: { get: jest.fn().mockReturnValue('') },
          },
          { provide: FinanceToolExecutor, useValue: toolExecutor },
          { provide: FinanceConfigService, useValue: { bankInfoBlock: '' } },
          {
            provide: IntegrationConfigService,
            useValue: {
              getValue: jest.fn().mockResolvedValue(''),
              getConfig: jest.fn().mockResolvedValue({ apiKey: '' }),
              getMaskedConfig: jest.fn().mockResolvedValue({ apiKey: '' }),
              saveConfig: jest.fn().mockResolvedValue(undefined),
              isConfigured: jest.fn().mockResolvedValue(false),
            },
          },
          {
            provide: AiUsageService,
            useValue: { record: jest.fn().mockResolvedValue(undefined) },
          },
          { provide: PrismaService, useValue: prisma },
          { provide: HandoffService, useValue: { handoff: jest.fn() } },
        ],
      }).compile();

      service = module.get(FinanceAiService);
    });

    it('reports isEnabled = false', () => {
      expect(service.isEnabled).toBe(false);
    });

    it('returns null from generateReply', async () => {
      const result = await service.generateReply(defaultParams);
      expect(result).toBeNull();
    });
  });

  describe('when ANTHROPIC_API_KEY is set', () => {
    let service: FinanceAiService;

    beforeEach(async () => {
      toolExecutor = { execute: jest.fn() };
      prisma = { chatMessage: { findMany: jest.fn().mockResolvedValue([]) } };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FinanceAiService,
          {
            provide: ConfigService,
            useValue: { get: jest.fn().mockReturnValue('sk-ant-test-key') },
          },
          { provide: FinanceToolExecutor, useValue: toolExecutor },
          { provide: FinanceConfigService, useValue: { bankInfoBlock: '🏦 Test Bank\n🔢 123-456' } },
          {
            provide: IntegrationConfigService,
            useValue: {
              getValue: jest.fn().mockResolvedValue('test-api-key'),
              getConfig: jest.fn().mockResolvedValue({ apiKey: 'test-api-key' }),
              getMaskedConfig: jest.fn().mockResolvedValue({ apiKey: '••••key' }),
              saveConfig: jest.fn().mockResolvedValue(undefined),
              isConfigured: jest.fn().mockResolvedValue(true),
            },
          },
          {
            provide: AiUsageService,
            useValue: { record: jest.fn().mockResolvedValue(undefined) },
          },
          { provide: PrismaService, useValue: prisma },
          { provide: HandoffService, useValue: { handoff: jest.fn() } },
        ],
      }).compile();

      service = module.get(FinanceAiService);
    });

    it('reports isEnabled = true', async () => {
      // Trigger lazy client initialization (service uses async getValue now)
      await (service as any).getAnthropicClient();
      expect(service.isEnabled).toBe(true);
    });

    it('builds messages with history limit (max 20)', () => {
      // Access private method through prototype for unit testing
      const buildMessages = (service as any).buildMessages.bind(service);
      const history = Array.from({ length: 30 }, (_, i) => ({
        role: i % 2 === 0 ? 'CUSTOMER' : 'BOT',
        text: `msg-${i}`,
      }));

      const result = buildMessages(history, 'new message');

      // Should limit to last 20 history entries
      expect(result.length).toBeLessThanOrEqual(21); // 20 history + current
    });

    it('ensures first message is always user role', () => {
      const buildMessages = (service as any).buildMessages.bind(service);
      const history = [
        { role: 'BOT', text: 'hello' },
        { role: 'CUSTOMER', text: 'hi' },
      ];

      const result = buildMessages(history, 'question');

      expect(result[0].role).toBe('user');
    });

    it('appends customer name to system prompt', async () => {
      const buildSystemPrompt = (service as any).buildSystemPrompt.bind(service);
      const prompt = await buildSystemPrompt('สมชาย');
      expect(prompt).toContain('คุณสมชาย');
    });

    it('does not append customer name when undefined', async () => {
      const buildSystemPrompt = (service as any).buildSystemPrompt.bind(service);
      const prompt = await buildSystemPrompt(undefined);
      expect(prompt).not.toContain('คุณundefined');
    });

    it('declares the Haiku→Sonnet routing model pair (Phase 7.2)', () => {
      // Simple replies use Haiku for cost; tool-using replies escalate to Sonnet for quality.
      expect((service as any).modelSonnet).toBe('claude-sonnet-4-6');
      expect((service as any).modelHaiku).toBe('claude-haiku-4-5-20251001');
    });

    it('loadHistory fetches last 10 messages oldest-first and maps roles', async () => {
      // DB returns newest-first; service reverses to oldest-first for Anthropic
      prisma.chatMessage.findMany.mockResolvedValue([
        { role: 'BOT', text: 'ยินดีต้อนรับค่ะ' },
        { role: 'CUSTOMER', text: 'สวัสดี' },
      ]);

      const loadHistory = (service as any).loadHistory.bind(service);
      const result = await loadHistory('room-1');

      expect(prisma.chatMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ roomId: 'room-1' }),
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
      );
      // After reverse: oldest (CUSTOMER) first, then BOT
      expect(result).toEqual([
        { role: 'user', content: 'สวัสดี' },
        { role: 'assistant', content: 'ยินดีต้อนรับค่ะ' },
      ]);
    });

    it('loadHistory maps STAFF and BOT to assistant, others to user', async () => {
      prisma.chatMessage.findMany.mockResolvedValue([
        // DB returns newest-first
        { role: 'AUTO_TRIGGER', text: 'auto' },
        { role: 'STAFF', text: 'staff reply' },
        { role: 'BOT', text: 'bot reply' },
        { role: 'CUSTOMER', text: 'customer msg' },
      ]);

      const loadHistory = (service as any).loadHistory.bind(service);
      const result = await loadHistory('room-1');

      expect(result.map((r: any) => r.role)).toEqual([
        'user', // CUSTOMER
        'assistant', // BOT
        'assistant', // STAFF
        'user', // AUTO_TRIGGER
      ]);
    });

    it('loadHistory truncates oldest entries when total text > 20k chars', async () => {
      const bigText = 'ก'.repeat(9_000);
      prisma.chatMessage.findMany.mockResolvedValue([
        { role: 'CUSTOMER', text: bigText }, // newest
        { role: 'BOT', text: bigText },
        { role: 'CUSTOMER', text: bigText }, // oldest — should be dropped
      ]);

      const loadHistory = (service as any).loadHistory.bind(service);
      const result = await loadHistory('room-1');

      // 3 * 9_000 = 27_000 > 20_000 budget → oldest CUSTOMER dropped
      expect(result.length).toBe(2);
      // After reverse+drop: leading BOT (assistant), then CUSTOMER (user)
      expect(result[0].role).toBe('assistant');
      expect(result[1].role).toBe('user');
    });

    it('buildMessagesFromHistory prepends history and ensures user-first ordering', () => {
      const buildMessagesFromHistory = (service as any).buildMessagesFromHistory.bind(service);
      const history = [
        { role: 'assistant' as const, content: 'leading bot msg' },
        { role: 'user' as const, content: 'hi' },
        { role: 'assistant' as const, content: 'hello' },
      ];

      const result = buildMessagesFromHistory(history, 'new question');

      // Leading assistant should be stripped so first message is user
      expect(result[0].role).toBe('user');
      // Current user message should be the tail (appended or merged)
      const lastMsg = result[result.length - 1];
      expect(lastMsg.role).toBe('user');
      expect(String(lastMsg.content)).toContain('new question');
    });
  });

  describe('model routing (Phase 7.2)', () => {
    let service: FinanceAiService;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let handoff: any;

    beforeEach(async () => {
      mockCreate.mockReset();
      // B3 Task 11: `data: { totalAmount: 5000 }` — NOT `{ ok: 1 }`. The old placeholder had
      // no money key at all, so the grounding guard below would have blocked EVERY reply that
      // quotes a number (including the pre-existing 'ยอดคงเหลือของคุณคือ 5,000 บาทค่ะ' fixture
      // response in the escalation test right below), making that test pass for the wrong
      // reason once the guard exists. This is the real shape of the pipeline: any number the
      // bot speaks must trace back to a tool result.
      toolExecutor = {
        execute: jest.fn().mockResolvedValue({ ok: true, data: { totalAmount: 5000 }, triggeredHandoff: false }),
      };
      handoff = { handoff: jest.fn().mockResolvedValue({ handoffId: 'sess-1', estimatedTime: '2 ชั่วโมง' }) };
      prisma = { chatMessage: { findMany: jest.fn().mockResolvedValue([]) } };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FinanceAiService,
          { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('sk-ant-test-key') } },
          { provide: FinanceToolExecutor, useValue: toolExecutor },
          { provide: FinanceConfigService, useValue: { bankInfoBlock: '' } },
          {
            provide: IntegrationConfigService,
            useValue: { getValue: jest.fn().mockResolvedValue('test-api-key') },
          },
          { provide: AiUsageService, useValue: { record: jest.fn().mockResolvedValue(undefined) } },
          { provide: PrismaService, useValue: prisma },
          { provide: HandoffService, useValue: handoff },
        ],
      }).compile();
      service = module.get(FinanceAiService);
    });

    it('answers a simple no-tool query on Haiku (cost path)', async () => {
      mockCreate.mockResolvedValueOnce(textResponse('สวัสดีค่ะ 😊'));
      const result = await service.generateReply(defaultParams);
      expect(result?.text).toBe('สวัสดีค่ะ 😊');
      expect(result?.model).toBe('claude-haiku-4-5-20251001');
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockCreate.mock.calls[0][0].model).toBe('claude-haiku-4-5-20251001');
      expect(toolExecutor.execute).not.toHaveBeenCalled();
    });

    it('escalates to Sonnet once the model needs a tool (quality path)', async () => {
      mockCreate
        .mockResolvedValueOnce(toolUseResponse('get_contract_status'))
        .mockResolvedValueOnce(textResponse('ยอดคงเหลือของคุณคือ 5,000 บาทค่ะ'));
      const result = await service.generateReply(defaultParams);
      // turn 0 (decides to use a tool) on Haiku; turn 1 (synthesis after tool result) on Sonnet
      expect(mockCreate.mock.calls[0][0].model).toBe('claude-haiku-4-5-20251001');
      expect(mockCreate.mock.calls[1][0].model).toBe('claude-sonnet-4-6');
      expect(result?.model).toBe('claude-sonnet-4-6');
      expect(result?.toolsUsed).toContain('get_contract_status');
      expect(toolExecutor.execute).toHaveBeenCalledTimes(1);
      // B3 Task 11: pin down that this is the NORMAL (non-guard-blocked) path — the
      // number spoken (5,000) really does trace back to the tool's totalAmount above.
      expect(result!.handoffTriggered).toBe(false);
    });

    describe('grounding guard (B3 Task 11)', () => {
      it('บล็อกคำตอบที่มีตัวเลขบาทซึ่งไม่ได้มาจาก tool → ส่งต่อพนักงาน (ห้ามบอกลูกค้าว่าระบบขัดข้อง)', async () => {
        toolExecutor.execute.mockResolvedValue({ ok: true, data: { found: true, totalAmount: 1515.83 } });
        mockCreate
          .mockResolvedValueOnce(toolUseResponse('get_current_balance'))
          .mockResolvedValueOnce(textResponse('ยอดของคุณคือ 99,999.50 บาทค่ะ'));

        const r = await service.generateReply(defaultParams);
        expect(r).not.toBeNull();
        expect(r!.handoffTriggered).toBe(true);
        expect(r!.text).toContain('พนักงาน');
        expect(r!.text).not.toContain('99,999');
        expect(handoff.handoff).toHaveBeenCalledWith(
          expect.objectContaining({ roomId: 'sess-1', reason: 'grounding_blocked' }),
        );
      });

      it('ยอมให้ตอบตัวเลขที่ tool คืนมาจริง (รวมสตางค์)', async () => {
        toolExecutor.execute.mockResolvedValue({ ok: true, data: { found: true, totalAmount: 1515.83 } });
        mockCreate
          .mockResolvedValueOnce(toolUseResponse('get_current_balance'))
          .mockResolvedValueOnce(textResponse('ยอดของคุณคือ 1,515.83 บาทค่ะ'));

        const r = await service.generateReply(defaultParams);
        expect(r?.text).toContain('1,515.83');
        expect(handoff.handoff).not.toHaveBeenCalled();
      });

      it('คำตอบที่ไม่มีตัวเลขบาท ผ่านตลอด (ทักทาย/ขอบคุณ)', async () => {
        mockCreate.mockResolvedValueOnce(textResponse('สวัสดีค่ะ ให้น้องเบสช่วยอะไรดีคะ'));
        const r = await service.generateReply(defaultParams);
        expect(r?.text).toContain('สวัสดี');
      });

      // ── เคสที่สำคัญที่สุดของ Task นี้: เทิร์นที่ 2 ของบทสนทนาปกติ ──
      // "ยอดเท่าไหร่" (เทิร์น 1, มี tool) → "โอนยังไงคะ" (เทิร์น 2, get_bank_info คืน string ล้วน)
      // ถ้าไม่ seed ledger จาก history เทิร์นนี้จะ grounded.size === 0 แล้วโดน block ทั้งที่ยอดถูกต้อง
      it('ทวนยอดเดิมในเทิร์นถัดไปได้ แม้ tool เทิร์นนั้นไม่คืนตัวเลข (seed จาก history)', async () => {
        prisma.chatMessage.findMany.mockResolvedValue([
          { role: 'CUSTOMER', text: 'ยอดเท่าไหร่' },
          { role: 'BOT', text: 'งวดนี้ 1,515.83 บาทค่ะ' },
        ]);
        toolExecutor.execute.mockResolvedValue({
          ok: true,
          data: { bankName: 'KBank', accountNumber: '203-1-16520-5', formatted: '…' },
        });
        mockCreate
          .mockResolvedValueOnce(toolUseResponse('get_bank_info'))
          .mockResolvedValueOnce(textResponse('โอน 1,515.83 บาท มาที่บัญชีนี้ได้เลยค่ะ'));

        const r = await service.generateReply(defaultParams);
        expect(r?.text).toContain('1,515.83');
        expect(r?.handoffTriggered).toBe(false);
        expect(handoff.handoff).not.toHaveBeenCalled();
      });
    });
  });
});
