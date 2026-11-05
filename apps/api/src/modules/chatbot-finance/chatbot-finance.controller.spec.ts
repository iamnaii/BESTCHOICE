import { ChatbotFinanceController } from './chatbot-finance.controller';
import { LineFinanceWebhookBody, LineFinanceWebhookEvent } from './dto/line-webhook.dto';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

/**
 * Task 44 — webhook การเงินกันซ้ำด้วย `webhookEventId` (WebhookDedupService.claim ผ่าน isDuplicate) อย่างเดียว.
 * LINE ส่งซ้ำ (redelivery) ด้วย webhookEventId เดิมเมื่อรอบแรกไม่ได้ 2xx — เดิม controller ทิ้ง event ที่ติด
 * `isRedelivery` ทันทีโดยไม่ดูว่ารอบแรกถูกเก็บหรือยัง ⇒ สลิปที่รอบแรกไม่ถึงเซิร์ฟเวอร์ (secret ผิดคืนต่อระบบ/deploy/timeout)
 * หายถาวร ทั้งที่การ claim ด้วย event id กันซ้ำได้อยู่แล้ว
 */
describe('ChatbotFinanceController.webhook — กันซ้ำด้วย webhookEventId', () => {
  const claimed = new Set<string>();
  const dedup = {
    isDuplicate: jest.fn(async (id: string) => {
      if (claimed.has(id)) return true;
      claimed.add(id);
      return false;
    }),
  };
  const chatbot = { handleEvent: jest.fn().mockResolvedValue(undefined) };
  const controller = new ChatbotFinanceController(
    chatbot as never,
    {} as never,
    {} as never,
    dedup as never,
  );

  const event = (id: string, isRedelivery: boolean): LineFinanceWebhookEvent => ({
    type: 'message',
    mode: 'active',
    timestamp: Date.now(),
    source: { type: 'user', userId: 'U1' },
    webhookEventId: id,
    deliveryContext: { isRedelivery },
    replyToken: 'rt',
    message: { id: `m-${id}`, type: 'text', text: 'โอนแล้ว' },
  });
  const body = (...events: LineFinanceWebhookEvent[]): LineFinanceWebhookBody => ({
    destination: 'Ubot',
    events,
  });

  beforeEach(() => {
    claimed.clear();
    jest.clearAllMocks();
  });

  it('event ที่ส่งซ้ำ (isRedelivery) แต่รอบแรกไม่เคยถึง → เก็บหนึ่งครั้ง', async () => {
    await controller.webhook(body(event('evt-lost', true)));

    expect(dedup.isDuplicate).toHaveBeenCalledWith('evt-lost');
    expect(chatbot.handleEvent).toHaveBeenCalledTimes(1);
  });

  it('event เดิมมาซ้ำ (รอบแรกเก็บแล้ว ทั้งแบบ redelivery และไม่ใช่) → ไม่ทำซ้ำ', async () => {
    await controller.webhook(body(event('evt-1', false)));
    await controller.webhook(body(event('evt-1', true)));
    await controller.webhook(body(event('evt-1', false)));

    expect(chatbot.handleEvent).toHaveBeenCalledTimes(1);
  });

  it('event หนึ่งพัง → event ถัดไปในชุดเดียวกันยังทำ และตอบ 200 ({ ok: true })', async () => {
    chatbot.handleEvent.mockRejectedValueOnce(new Error('db down'));

    await expect(
      controller.webhook(body(event('evt-a', false), event('evt-b', false))),
    ).resolves.toEqual({
      ok: true,
    });
    expect(chatbot.handleEvent).toHaveBeenCalledTimes(2);
  });
});
