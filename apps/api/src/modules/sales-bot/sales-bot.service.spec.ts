import { Test } from '@nestjs/testing';
import Anthropic from '@anthropic-ai/sdk';
import { SalesBotService } from './sales-bot.service';
import { SearchProductsTool } from './tools/search-products.tool';
import { CalculateInstallmentTool } from './tools/calculate-installment.tool';
import { ListPromotionsTool } from './tools/list-promotions.tool';
import { HandoffToHumanTool } from './tools/handoff-to-human.tool';
import { CaptureLeadTool } from './tools/capture-lead.tool';

jest.mock('@anthropic-ai/sdk');

describe('SalesBotService', () => {
  async function build(anthropicMock: jest.Mock) {
    (Anthropic as unknown as jest.Mock).mockImplementation(() => ({
      messages: { create: anthropicMock },
    }));
    const searchProducts = { run: jest.fn() };
    const calcInstallment = { run: jest.fn() };
    const listPromotions = { run: jest.fn() };
    const handoff = { run: jest.fn() };
    const captureLead = { run: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        SalesBotService,
        { provide: SearchProductsTool, useValue: searchProducts },
        { provide: CalculateInstallmentTool, useValue: calcInstallment },
        { provide: ListPromotionsTool, useValue: listPromotions },
        { provide: HandoffToHumanTool, useValue: handoff },
        { provide: CaptureLeadTool, useValue: captureLead },
      ],
    }).compile();
    const svc = mod.get(SalesBotService);
    return { svc, searchProducts, calcInstallment, listPromotions, handoff, captureLead };
  }

  it('returns reply without tool calls when Claude answers directly', async () => {
    const create = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'สวัสดีค่ะ สนใจรุ่นไหนคะ' }],
      usage: { input_tokens: 100, output_tokens: 20 },
    });
    const { svc } = await build(create);
    const result = await svc.generateReply({
      text: 'สวัสดีครับ',
      roomId: 'r1',
      customerId: null,
    });
    expect(result.reply).toContain('สวัสดี');
    expect(result.toolsUsed).toHaveLength(0);
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(20);
  });

  it('runs a tool and feeds the result back for a second turn', async () => {
    const create = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'search_products',
            input: { query: 'iPhone 15' },
          },
        ],
        usage: { input_tokens: 120, output_tokens: 30 },
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'มี iPhone 15 ในสต็อกค่ะ ราคา 32,900 บาท' }],
        usage: { input_tokens: 140, output_tokens: 40 },
      });
    const { svc, searchProducts } = await build(create);
    searchProducts.run.mockResolvedValue({
      products: [{ id: 'p1', name: 'iPhone 15', priceThb: 32900 }],
    });
    const result = await svc.generateReply({
      text: 'iPhone 15 กี่บาท',
      roomId: 'r1',
      customerId: null,
    });
    expect(searchProducts.run).toHaveBeenCalledWith({ query: 'iPhone 15' });
    expect(result.toolsUsed).toEqual(['search_products']);
    expect(result.reply).toContain('32,900');
    expect(result.inputTokens).toBe(260);
    expect(result.outputTokens).toBe(70);
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('lowers confidence when handoff_to_human is called', async () => {
    const create = jest
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool_use',
            id: 'tu_h',
            name: 'handoff_to_human',
            input: { reason: 'customer_wants_staff', roomId: 'r1' },
          },
        ],
        usage: { input_tokens: 80, output_tokens: 10 },
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'ส่งเรื่องให้พี่ staff แล้วค่ะ รอสักครู่นะคะ' }],
        usage: { input_tokens: 90, output_tokens: 15 },
      });
    const { svc, handoff } = await build(create);
    handoff.run.mockResolvedValue({ handoffAccepted: true });
    const result = await svc.generateReply({
      text: 'ขอคุยกับคนได้ไหม',
      roomId: 'r1',
      customerId: null,
    });
    // handoff.run is called with roomId injected by the service, regardless
    // of what the model passed in its input.
    expect(handoff.run).toHaveBeenCalledWith({
      reason: 'customer_wants_staff',
      roomId: 'r1',
    });
    expect(result.toolsUsed).toEqual(['handoff_to_human']);
    expect(result.confidence).toBeLessThanOrEqual(0.3);
  });

  it('falls back to staff message after 3 unresolved hops', async () => {
    const create = jest.fn().mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          id: 'tu_loop',
          name: 'search_products',
          input: { query: 'x' },
        },
      ],
      usage: { input_tokens: 50, output_tokens: 5 },
    });
    const { svc, searchProducts } = await build(create);
    searchProducts.run.mockResolvedValue({ products: [] });
    const result = await svc.generateReply({
      text: '???',
      roomId: 'r1',
      customerId: null,
    });
    expect(result.reply).toContain('staff');
    expect(result.confidence).toBeLessThanOrEqual(0.3);
    // 3 hops × 1 tool call each.
    expect(searchProducts.run).toHaveBeenCalledTimes(3);
  });
});
