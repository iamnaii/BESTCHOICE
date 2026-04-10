import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FinanceAiService } from './finance-ai.service';
import { FinanceToolExecutor } from '../tools/tool-executor';

describe('FinanceAiService', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let toolExecutor: any;

  const defaultParams = {
    userMessage: 'ยอดเท่าไหร่',
    history: [],
    customerId: 'cust-1',
    customerName: 'สมชาย',
    sessionId: 'sess-1',
  };

  describe('when ANTHROPIC_API_KEY is not set', () => {
    let service: FinanceAiService;

    beforeEach(async () => {
      toolExecutor = { execute: jest.fn() };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FinanceAiService,
          {
            provide: ConfigService,
            useValue: { get: jest.fn().mockReturnValue('') },
          },
          { provide: FinanceToolExecutor, useValue: toolExecutor },
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
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FinanceAiService,
          {
            provide: ConfigService,
            useValue: { get: jest.fn().mockReturnValue('sk-ant-test-key') },
          },
          { provide: FinanceToolExecutor, useValue: toolExecutor },
        ],
      }).compile();

      service = module.get(FinanceAiService);
    });

    it('reports isEnabled = true', () => {
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

    it('appends customer name to system prompt', () => {
      const buildSystemPrompt = (service as any).buildSystemPrompt.bind(service);
      const prompt = buildSystemPrompt('สมชาย');
      expect(prompt).toContain('คุณสมชาย');
    });

    it('does not append customer name when undefined', () => {
      const buildSystemPrompt = (service as any).buildSystemPrompt.bind(service);
      const prompt = buildSystemPrompt(undefined);
      expect(prompt).not.toContain('คุณundefined');
    });
  });
});
