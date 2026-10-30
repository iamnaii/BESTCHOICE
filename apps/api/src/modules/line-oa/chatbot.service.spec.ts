import { ChatbotService } from './chatbot.service';
import { CHATBOT_SYSTEM_PROMPT } from './chatbot-system-prompt.constants';

/**
 * Task 20 C1 — AI ตอบแชท OA ร้าน (freeform) ใส่ "บริบทลูกค้า" + tool ดึงยอด/ประวัติชำระ เฉพาะ LINE ที่ยืนยัน
 * OTP แล้ว (แถว customer_line_links ช่อง FINANCE ที่ยังผูก) — เดิมดึงด้วย customers.line_id_shop ซึ่งเคยผูกได้
 * ด้วยเบอร์อย่างเดียว ⇒ ผู้ที่ผูกเบอร์คนอื่นถาม AI "ยอดค้างเท่าไหร่" แล้วได้ยอดของเหยื่อ
 */
const ATTACKER = 'U_attacker_shop';
const OWNER = 'U_owner_verified';

function setup() {
  const victim = {
    id: 'c-victim',
    name: 'สมชาย ใจดี',
    lineIdShop: ATTACKER, // สภาพที่รูเก่าทิ้งไว้
    contracts: [{ contractNumber: 'BC-2026-0001', status: 'ACTIVE', payments: [] }],
  };
  const prisma = {
    customer: {
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        if ('lineIdShop' in where) return where.lineIdShop === victim.lineIdShop ? victim : null;
        if ('id' in where) return where.id === victim.id ? victim : null;
        return null;
      }),
    },
    customerLineLink: {
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        where.lineUserId === OWNER && where.channel === 'FINANCE'
          ? { customerId: victim.id }
          : null,
      ),
    },
  };
  const create = jest.fn().mockResolvedValue({
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'สวัสดีค่ะ' }],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const svc = new ChatbotService(
    {} as never,
    prisma as never,
    { getValue: jest.fn().mockResolvedValue('test-key') } as never,
    { record: jest.fn().mockResolvedValue(undefined) } as never,
  );
  (svc as unknown as { anthropic: unknown }).anthropic = { messages: { create } };
  return { svc, create };
}

describe('ChatbotService customer context (Task 20 C1)', () => {
  it('a LINE that is not OTP-verified gets no customer context and no data tools', async () => {
    const { svc, create } = setup();

    await svc.generateResponse('ยอดค้างเท่าไหร่คะ', ATTACKER);

    const params = create.mock.calls[0][0];
    expect(params.tools).toBeUndefined();
    expect(params.system).toBe(CHATBOT_SYSTEM_PROMPT);
  });

  it('an OTP-verified LINE gets its own contract context + tools', async () => {
    const { svc, create } = setup();

    await svc.generateResponse('ยอดค้างเท่าไหร่คะ', OWNER);

    const params = create.mock.calls[0][0];
    expect(params.tools).toBeDefined();
    expect(params.system).not.toBe(CHATBOT_SYSTEM_PROMPT);
  });
});
