import { Logger } from '@nestjs/common';
import { AiAssistantService } from './ai-assistant.service';

function makeService(isAvailable = true) {
  const prisma = {
    chatMessage: {
      findMany: jest.fn().mockResolvedValue([
        { role: 'STAFF', text: 'ยินดีให้บริการ', staff: { name: 'เอ' } },
        { role: 'CUSTOMER', text: 'สนใจโทรศัพท์' },
      ]),
    },
  };
  const aiText = { isAvailable, generate: jest.fn().mockResolvedValue('ข้อความจาก AI') };
  return { service: new AiAssistantService(prisma as any, aiText as any), prisma, aiText };
}

describe('AiAssistantService', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'error').mockImplementation());
  afterEach(() => jest.restoreAllMocks());

  it('summarizes chronological messages using the existing prompt and caches for five minutes', async () => {
    let now = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const { service, prisma, aiText } = makeService();
    await expect(service.summarizeConversation('room-1')).resolves.toBe('ข้อความจาก AI');
    expect(prisma.chatMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { roomId: 'room-1', deletedAt: null },
        take: 50,
      }),
    );
    expect(aiText.generate).toHaveBeenCalledWith(
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [
          {
            role: 'user',
            content:
              'สรุปบทสนทนานี้ใน 2-3 ประโยค ภาษาไทย:\n\nลูกค้า: สนใจโทรศัพท์\nพนักงาน (เอ): ยินดีให้บริการ',
          },
        ],
      },
      { service: 'ai-assistant', method: 'summarizeConversation' },
    );
    now += 5 * 60 * 1000 - 1;
    await service.summarizeConversation('room-1');
    expect(aiText.generate).toHaveBeenCalledTimes(1);
    now += 1;
    await service.summarizeConversation('room-1');
    expect(aiText.generate).toHaveBeenCalledTimes(2);
  });

  it('returns the existing unavailable summary and original draft without a configured key', async () => {
    const { service, prisma, aiText } = makeService(false);
    await expect(service.summarizeConversation('room-1')).resolves.toBe(
      'ไม่สามารถสรุปได้ — ยังไม่ได้ตั้งค่า API key',
    );
    await expect(service.adjustTone('ร่างเดิม', 'formal')).resolves.toBe('ร่างเดิม');
    expect(prisma.chatMessage.findMany).not.toHaveBeenCalled();
    expect(aiText.generate).not.toHaveBeenCalled();
  });

  it('does not invoke AI for an empty conversation', async () => {
    const { service, prisma, aiText } = makeService();
    prisma.chatMessage.findMany.mockResolvedValue([]);
    await expect(service.summarizeConversation('room-1')).resolves.toBe(
      'ยังไม่มีข้อความในบทสนทนานี้',
    );
    expect(aiText.generate).not.toHaveBeenCalled();
  });

  it.each([
    ['formal', 'เขียนข้อความนี้ใหม่ให้สุภาพเป็นทางการ ตอบเฉพาะข้อความที่เขียนใหม่เท่านั้น:'],
    ['casual', 'เขียนข้อความนี้ใหม่ให้เป็นกันเอง ตอบเฉพาะข้อความที่เขียนใหม่เท่านั้น:'],
    ['friendly', 'เขียนข้อความนี้ใหม่ให้เป็นมิตรอบอุ่น ตอบเฉพาะข้อความที่เขียนใหม่เท่านั้น:'],
  ] as const)('preserves the %s tone prompt and token limit', async (tone, prompt) => {
    const { service, aiText } = makeService();
    await expect(service.adjustTone('ร่างเดิม', tone)).resolves.toBe('ข้อความจาก AI');
    expect(aiText.generate).toHaveBeenCalledWith(
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{ role: 'user', content: `${prompt}\n\nร่างเดิม` }],
      },
      { service: 'ai-assistant', method: 'adjustTone' },
    );
  });

  it.each(['missing text', 'provider failure'])('preserves fallbacks for %s', async (scenario) => {
    const { service, aiText } = makeService();
    if (scenario === 'missing text') aiText.generate.mockResolvedValue(null);
    else aiText.generate.mockRejectedValue(new Error('unavailable'));
    await expect(service.summarizeConversation('room-1')).resolves.toBe('ไม่สามารถสรุปได้');
    await expect(service.adjustTone('ร่างเดิม', 'formal')).resolves.toBe('ร่างเดิม');
  });
});
