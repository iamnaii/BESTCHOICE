import { SendRateCardTool } from './send-rate-card.tool';
import type { BotRuntimeConfigService, RateCardsConfig } from '../bot-runtime-config.service';
import type { StorageService } from '../../storage/storage.service';
import { collectAttachmentsFromToolResult, type BotAttachment } from '../../../utils/bot-attachments.util';
import { redactMediaUrls } from '../sales-bot.service';

const makeTool = (cards: RateCardsConfig, sign?: jest.Mock) => {
  const runtime = { getRateCards: jest.fn().mockResolvedValue(cards) } as unknown as BotRuntimeConfigService;
  const storage = {
    getSignedDownloadUrl:
      sign ?? jest.fn().mockImplementation(async (key: string) => `https://storage.example.com/${key}?sig=1`),
  } as unknown as StorageService;
  return { tool: new SendRateCardTool(runtime, storage), storage };
};

const CARDS: RateCardsConfig = {
  imported_free_down: { storageKey: 'bot-media/rate-cards/imported.jpg', label: 'ตารางผ่อนฟรีดาวน์ไอโฟนมือ 2' },
  used_rate1: { storageKey: 'bot-media/rate-cards/used-r1.jpg', label: 'ตารางผ่อนไอโฟนมือ 2 เรทที่ 1' },
  shop_map: { url: 'https://cdn.example.com/map.jpg', label: 'วิธีเดินทางมาร้าน' },
};

describe('SendRateCardTool.run', () => {
  it('ส่งรูปที่ตั้งไว้ด้วยลิงก์ลงนาม 7 วัน + ป้ายชื่อ', async () => {
    const { tool, storage } = makeTool(CARDS);
    const r = await tool.run({ cards: ['imported_free_down'] });
    expect(r.sent).toEqual([{ card: 'imported_free_down', label: 'ตารางผ่อนฟรีดาวน์ไอโฟนมือ 2' }]);
    expect(r.missing).toEqual([]);
    expect(r.images).toEqual([
      {
        id: 'card:imported_free_down',
        photoUrl: 'https://storage.example.com/bot-media/rate-cards/imported.jpg?sig=1',
        productName: 'ตารางผ่อนฟรีดาวน์ไอโฟนมือ 2',
      },
    ]);
    expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith('bot-media/rate-cards/imported.jpg', 604800);
  });

  it('url สาธารณะ https ใช้ตรง ๆ ไม่ลงนาม', async () => {
    const { tool, storage } = makeTool(CARDS);
    const r = await tool.run({ cards: ['shop_map'] });
    expect(r.images[0].photoUrl).toBe('https://cdn.example.com/map.jpg');
    expect(storage.getSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('รูปที่ยังไม่ตั้ง / ชื่อที่ไม่รู้จัก → missing (ไม่มีรูปหลุด) · ชื่อไม่รู้จักถูกทิ้ง', async () => {
    const { tool } = makeTool(CARDS);
    const r = await tool.run({ cards: ['new_rate1', 'hack://x', 'used_rate1'] });
    expect(r.missing).toEqual(['new_rate1']);
    expect(r.sent.map((s) => s.card)).toEqual(['used_rate1']);
  });

  it('ส่งได้ไม่เกิน 2 ใบต่อครั้ง และตัดใบซ้ำ', async () => {
    const { tool } = makeTool(CARDS);
    const r = await tool.run({ cards: ['used_rate1', 'used_rate1', 'imported_free_down', 'shop_map'] });
    expect(r.sent.map((s) => s.card)).toEqual(['used_rate1', 'imported_free_down']);
  });

  it('ลงนามพัง → missing ไม่ throw (รูปเป็นของเสริม ห้ามล้มทั้งเทิร์น)', async () => {
    const { tool } = makeTool(CARDS, jest.fn().mockRejectedValue(new Error('no signBlob')));
    const r = await tool.run({ cards: ['used_rate1'] });
    expect(r.sent).toEqual([]);
    expect(r.missing).toEqual(['used_rate1']);
  });

  it('รับ cards เป็น string เดี่ยวได้ (โมเดลบางทีไม่ห่อ array)', async () => {
    const { tool } = makeTool(CARDS);
    const r = await tool.run({ cards: 'shop_map' });
    expect(r.sent.map((s) => s.card)).toEqual(['shop_map']);
  });

  it('ผลลัพธ์แนบเป็นรูปได้ แต่ลิงก์ถูกตัดก่อนถึงโมเดล', async () => {
    const { tool } = makeTool(CARDS);
    const r = await tool.run({ cards: ['used_rate1', 'shop_map'] });
    const into = new Map<string, BotAttachment>();
    collectAttachmentsFromToolResult('send_rate_card', r, into);
    expect([...into.values()]).toEqual([
      {
        productId: 'card:used_rate1',
        imageUrl: 'https://storage.example.com/bot-media/rate-cards/used-r1.jpg?sig=1',
        label: 'ตารางผ่อนไอโฟนมือ 2 เรทที่ 1',
      },
      { productId: 'card:shop_map', imageUrl: 'https://cdn.example.com/map.jpg', label: 'วิธีเดินทางมาร้าน' },
    ]);
    expect(JSON.stringify(redactMediaUrls(r))).not.toContain('https://');
  });
});
