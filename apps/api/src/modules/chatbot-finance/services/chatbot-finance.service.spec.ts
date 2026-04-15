import { Test, TestingModule } from '@nestjs/testing';
import { ChatbotFinanceService } from './chatbot-finance.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { LineFinanceClientService } from './line-finance-client.service';
import { ChatRoomService } from './chat-room.service';
import { VerificationService } from './verification.service';
import { FinanceAiService } from './finance-ai.service';
import { HandoffService } from './handoff.service';
import { SlipProcessingService } from './slip-processing.service';
import { FeedbackService } from './feedback.service';

describe('ChatbotFinanceService', () => {
  let service: ChatbotFinanceService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lineClient: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sessions: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let verification: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ai: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let handoff: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let slipProcessing: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const session = { id: 'sess-1', customerId: null };
  const linkedStatus = { linked: true, customerId: 'c1', customerName: 'สมชาย' };

  beforeEach(async () => {
    prisma = {
      systemConfig: { findUnique: jest.fn().mockResolvedValue({ value: 'liff-123' }) },
    };
    lineClient = {
      replyText: jest.fn().mockResolvedValue(undefined),
      getMessageContent: jest.fn().mockResolvedValue(Buffer.from('img')),
    };
    sessions = {
      getOrCreate: jest.fn().mockResolvedValue(session),
      saveMessage: jest.fn().mockResolvedValue({ id: 'msg-1' }),
      getRecentMessages: jest.fn().mockResolvedValue([]),
      linkSessionToCustomer: jest.fn().mockResolvedValue(undefined),
    };
    verification = {
      isLinked: jest.fn().mockResolvedValue(linkedStatus),
    };
    ai = {
      generateReply: jest.fn().mockResolvedValue({
        text: 'สวัสดีค่ะ',
        model: 'claude-sonnet-4-5',
        inputTokens: 100,
        outputTokens: 50,
        toolsUsed: [],
        handoffTriggered: false,
      }),
    };
    handoff = {
      isInHandoffMode: jest.fn().mockResolvedValue(false),
    };
    slipProcessing = {
      processSlip: jest.fn().mockResolvedValue({ ok: true, reply: 'รับสลิปแล้วค่ะ', matched: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatbotFinanceService,
        { provide: PrismaService, useValue: prisma },
        { provide: LineFinanceClientService, useValue: lineClient },
        { provide: ChatRoomService, useValue: sessions },
        { provide: VerificationService, useValue: verification },
        { provide: FinanceAiService, useValue: ai },
        { provide: HandoffService, useValue: handoff },
        { provide: SlipProcessingService, useValue: slipProcessing },
        { provide: FeedbackService, useValue: { saveFeedback: jest.fn().mockResolvedValue({ ok: true }) } },
      ],
    }).compile();

    service = module.get(ChatbotFinanceService);
  });

  const makeTextEvent = (text: string) => ({
    type: 'message' as const,
    mode: 'active',
    timestamp: Date.now(),
    source: { type: 'user' as const, userId: 'U123' },
    webhookEventId: 'evt-1',
    deliveryContext: { isRedelivery: false },
    replyToken: 'rt-1',
    message: { id: 'msg-1', type: 'text' as const, text },
  });

  it('sends AI reply for verified text message', async () => {
    await service.handleEvent(makeTextEvent('ยอดเท่าไหร่'));

    expect(verification.isLinked).toHaveBeenCalledWith('U123');
    expect(ai.generateReply).toHaveBeenCalledWith(
      expect.objectContaining({ userMessage: 'ยอดเท่าไหร่', customerId: 'c1' }),
    );
    expect(lineClient.replyText).toHaveBeenCalledWith('rt-1', 'สวัสดีค่ะ');
  });

  it('sends verify prompt when not linked', async () => {
    verification.isLinked.mockResolvedValue({ linked: false });

    await service.handleEvent(makeTextEvent('สวัสดี'));

    expect(ai.generateReply).not.toHaveBeenCalled();
    expect(lineClient.replyText).toHaveBeenCalledWith(
      'rt-1',
      expect.stringContaining('ยืนยันตัวตน'),
    );
  });

  it('skips response in handoff mode but saves message', async () => {
    handoff.isInHandoffMode.mockResolvedValue(true);

    await service.handleEvent(makeTextEvent('ช่วยด้วย'));

    expect(sessions.saveMessage).toHaveBeenCalled();
    expect(ai.generateReply).not.toHaveBeenCalled();
    expect(lineClient.replyText).not.toHaveBeenCalled();
  });

  it('sends fallback when AI returns null', async () => {
    ai.generateReply.mockResolvedValue(null);

    await service.handleEvent(makeTextEvent('test'));

    expect(lineClient.replyText).toHaveBeenCalledWith(
      'rt-1',
      expect.stringContaining('ระบบขัดข้อง'),
    );
  });

  it('processes image through slip processing', async () => {
    const imageEvent = {
      type: 'message' as const,
      mode: 'active',
      timestamp: Date.now(),
      source: { type: 'user' as const, userId: 'U123' },
      webhookEventId: 'evt-2',
      deliveryContext: { isRedelivery: false },
      replyToken: 'rt-2',
      message: { id: 'img-1', type: 'image' as const, contentProvider: { type: 'line' } },
    };

    await service.handleEvent(imageEvent);

    expect(slipProcessing.processSlip).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'c1', lineUserId: 'U123' }),
    );
  });

  it('handles follow event with greeting', async () => {
    const followEvent = {
      type: 'follow' as const,
      mode: 'active',
      timestamp: Date.now(),
      source: { type: 'user' as const, userId: 'U123' },
      webhookEventId: 'evt-3',
      deliveryContext: { isRedelivery: false },
      replyToken: 'rt-3',
    };

    await service.handleEvent(followEvent);

    expect(lineClient.replyText).toHaveBeenCalledWith(
      'rt-3',
      expect.stringContaining('ยินดีให้บริการ'),
    );
  });

  it('truncates long messages before sending to AI', async () => {
    const longText = 'ก'.repeat(3000);

    await service.handleEvent(makeTextEvent(longText));

    // Full text saved to DB
    expect(sessions.saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: longText }),
    );
    // Truncated text sent to AI (2000 chars + ellipsis)
    const aiCall = ai.generateReply.mock.calls[0][0];
    expect(aiCall.userMessage.length).toBeLessThanOrEqual(2001);
    expect(aiCall.userMessage).toContain('…');
  });

  it('links session to customer on first verified message', async () => {
    sessions.getOrCreate.mockResolvedValue({ id: 'sess-1', customerId: null });

    await service.handleEvent(makeTextEvent('ยอดเท่าไหร่'));

    expect(sessions.linkSessionToCustomer).toHaveBeenCalledWith('sess-1', 'c1');
  });
});
