import { Test } from '@nestjs/testing';
import { KnowledgeExtractorService } from './knowledge-extractor.service';
import { PrismaService } from '../../prisma/prisma.service';
import Anthropic from '@anthropic-ai/sdk';

jest.mock('@anthropic-ai/sdk');

describe('KnowledgeExtractorService', () => {
  it('parses Claude response and upserts to ChatKnowledgeBase', async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            faqs: [
              {
                intent: 'installment_rate',
                triggerKeywords: ['ดอก', 'กี่เปอร์เซ็นต์'],
                exampleQuestions: ['ดอกเบี้ยกี่เปอร์เซ็นต์'],
                responseTemplate: 'ผ่อน 0% สูงสุด 12 งวดค่ะ',
              },
            ],
            objections: [],
          }),
        },
      ],
    });
    (Anthropic as unknown as jest.Mock).mockImplementation(() => ({
      messages: { create: mockCreate },
    }));

    const prisma = {
      aiTrainingPair: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ customerMessage: 'ดอกกี่เปอร์เซ็นต์', humanEdit: 'ผ่อน 0% ค่ะ' }]),
      },
      chatKnowledgeBase: {
        upsert: jest.fn().mockResolvedValue({ id: 'kb1' }),
      },
    };

    const mod = await Test.createTestingModule({
      providers: [KnowledgeExtractorService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    const svc = mod.get(KnowledgeExtractorService);

    const result = await svc.extractAndSeed();
    expect(result.faqsSeeded).toBe(1);
    expect(prisma.chatKnowledgeBase.upsert).toHaveBeenCalledTimes(1);
  });
});
