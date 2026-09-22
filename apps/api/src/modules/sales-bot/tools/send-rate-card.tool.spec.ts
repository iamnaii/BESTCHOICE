import {
  NO_CARD_REQUESTED,
  RATE_CARD_KEYS,
  SEND_RATE_CARD_TOOL,
  SendRateCardTool,
  buildSendRateCardTool,
  configuredRateCardKeys,
} from './send-rate-card.tool';
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

  it('รูปที่ยังไม่ตั้ง / ชื่อที่ไม่รู้จัก → missing ทั้งคู่ (ไม่ทิ้งเงียบ — รีวิว TOOLLOOP-2)', async () => {
    const { tool } = makeTool(CARDS);
    const r = await tool.run({ cards: ['new_rate1', 'hack://x', 'used_rate1'] });
    expect(r.missing).toEqual(['new_rate1', 'hack://x']);
    expect(r.sent.map((s) => s.card)).toEqual(['used_rate1']);
    expect(r.images.map((i) => i.id)).toEqual(['card:used_rate1']);
  });

  it('ส่งได้ไม่เกิน 2 ใบต่อครั้ง ตัดใบซ้ำ และใบที่เกินเพดานถูกรายงานใน missing', async () => {
    const { tool } = makeTool(CARDS);
    const r = await tool.run({ cards: ['used_rate1', 'used_rate1', 'imported_free_down', 'shop_map'] });
    expect(r.sent.map((s) => s.card)).toEqual(['used_rate1', 'imported_free_down']);
    expect(r.missing).toEqual(['shop_map']);
  });

  it('เพดานนับเฉพาะใบที่ส่งได้จริง: ใบที่ยังไม่ตั้งไม่กินโควตา (prod: used_rate1/2 ไม่มี + แผนที่มี — รีวิว SB-V4)', async () => {
    const prod: RateCardsConfig = {
      imported_free_down: { storageKey: 'bot-media/rate-cards/imported.jpg', label: 'ตารางผ่อนฟรีดาวน์' },
      shop_map: { url: 'https://cdn.example.com/map.jpg', label: 'วิธีเดินทางมาร้าน' },
    };
    const { tool } = makeTool(prod);
    const r = await tool.run({ cards: ['used_rate1', 'used_rate2', 'shop_map'] });
    expect(r.sent.map((s) => s.card)).toEqual(['shop_map']);
    expect(r.missing).toEqual(['used_rate1', 'used_rate2']);
    expect(r.images.map((i) => i.id)).toEqual(['card:shop_map']);
  });

  it('ใบที่ลงนามพังไม่กินโควตา · ใบที่เกินเพดานหลังส่งครบ 2 ใบยังรายงานใน missing', async () => {
    const sign = jest.fn().mockImplementation(async (key: string) => {
      if (key.includes('used-r1')) throw new Error('no signBlob');
      return `https://storage.example.com/${key}?sig=1`;
    });
    const { tool } = makeTool(
      { ...CARDS, used_rate2: { storageKey: 'bot-media/rate-cards/used-r2.jpg', label: 'เรท 2' } },
      sign,
    );
    const r = await tool.run({ cards: ['used_rate1', 'used_rate2', 'imported_free_down', 'shop_map'] });
    expect(r.sent.map((s) => s.card)).toEqual(['used_rate2', 'imported_free_down']);
    expect(r.missing).toEqual(['used_rate1', 'shop_map']);
  });

  it('ไม่ระบุรูปเลย (cards ว่าง/ไม่ส่ง) → missing = NO_CARD_REQUESTED ไม่ใช่ผลว่างเปล่า (รีวิว SB-V3)', async () => {
    const { tool } = makeTool(CARDS);
    for (const input of [{ cards: [] }, {}, { cards: ['', null] }, { cards: '  ' }]) {
      const r = await tool.run(input);
      expect(r).toEqual({ sent: [], missing: [NO_CARD_REQUESTED], images: [] });
    }
  });

  it('ชื่อที่โมเดลแต่งยาว ๆ ถูกตัดความยาวก่อนใส่ missing · ค่าว่างถูกข้าม', async () => {
    const { tool } = makeTool(CARDS);
    const r = await tool.run({ cards: ['x'.repeat(200), '', null] });
    expect(r.missing).toEqual(['x'.repeat(40)]);
    expect(r.sent).toEqual([]);
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

describe('buildSendRateCardTool — ประกาศเฉพาะรูปที่ตั้งไว้จริง (รีวิว TOOLLOOP-1 / PROMPT-2)', () => {
  // ค่าตั้งที่ขึ้น prod รอบแรก: มีแค่ตารางเครื่องนอก + แผนที่ (ตารางเครื่องไทย/มือ 1 ยังไม่มีรูป)
  const PROD_FIRST: RateCardsConfig = {
    imported_free_down: { storageKey: 'bot-media/rate-cards/imported.jpg', label: 'ตารางผ่อนฟรีดาวน์ไอโฟนมือ 2' },
    shop_map: { storageKey: 'bot-media/rate-cards/map.jpg', label: 'วิธีเดินทางมาร้าน' },
  };

  it('enum = รูปที่ตั้งไว้ ∩ รูปที่ระบบรู้จัก (เรียงตาม RATE_CARD_KEYS) · คำอธิบายไม่เอ่ยรูปที่ไม่มี', () => {
    const def = buildSendRateCardTool({ ...PROD_FIRST, weird_card: { url: 'https://x/y.jpg', label: 'แปลก' } })!;
    expect(def.name).toBe('send_rate_card');
    expect(def.input_schema.properties.cards.items.enum).toEqual(['imported_free_down', 'shop_map']);
    expect(def.description).toContain('imported_free_down = ตารางโปรฟรีดาวน์ไอโฟนมือ 2 เครื่องนอก');
    expect(def.description).toContain('"[รูป ตารางผ่อนฟรีดาวน์ไอโฟนมือ 2]"');
    expect(def.description).toContain('shop_map = วิธีเดินทางมาร้าน');
    // label ตรงกับความหมายอยู่แล้ว → ไม่ต้องพูดซ้ำ
    expect(def.description).not.toContain('"[รูป วิธีเดินทางมาร้าน]"');
    for (const k of ['used_rate1', 'used_rate2', 'new_rate1', 'new_rate2', 'weird_card']) {
      expect(def.description).not.toContain(k);
    }
  });

  it('schema บังคับอย่างน้อย 1 ใบ (minItems — Gemini ตัดทิ้งเอง ด่านจริงอยู่ใน run)', () => {
    const def = buildSendRateCardTool(PROD_FIRST)!;
    expect(def.input_schema.properties.cards.minItems).toBe(1);
  });

  it('ไม่มีรูปที่ตั้งไว้เลย / ค่าตั้งว่าง → null (ไม่ต้องประกาศเครื่องมือ)', () => {
    expect(buildSendRateCardTool({})).toBeNull();
    expect(buildSendRateCardTool(null)).toBeNull();
    expect(buildSendRateCardTool(undefined)).toBeNull();
    expect(buildSendRateCardTool({ weird_card: { url: 'https://x/y.jpg', label: 'แปลก' } })).toBeNull();
  });

  it('configuredRateCardKeys เรียงตาม RATE_CARD_KEYS ไม่ใช่ลำดับใน JSON', () => {
    expect(
      configuredRateCardKeys({
        shop_map: { url: 'https://x/m.jpg', label: 'แผนที่' },
        used_rate2: { url: 'https://x/2.jpg', label: 'เรท 2' },
      }),
    ).toEqual(['used_rate2', 'shop_map']);
  });

  it('SEND_RATE_CARD_TOOL (เลิกใช้แล้ว) ยังประกาศครบทุกรูปให้ผู้เรียกเดิม', () => {
    expect(SEND_RATE_CARD_TOOL.input_schema.properties.cards.items.enum).toEqual([...RATE_CARD_KEYS]);
  });
});
