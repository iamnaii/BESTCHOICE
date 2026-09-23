import { BotRuntimeConfigService, NO_STOCK_PROMPT, parseRateCards } from './bot-runtime-config.service';
import type { PrismaService } from '../../prisma/prisma.service';

const makePrisma = (rows: { key: string; value: string }[] | Error) =>
  ({
    systemConfig: {
      findMany: rows instanceof Error ? jest.fn().mockRejectedValue(rows) : jest.fn().mockResolvedValue(rows),
    },
  }) as unknown as PrismaService;

describe('BotRuntimeConfigService', () => {
  it('ไม่มีแถว = โหมดปกติ (LIVE) + ไม่มีรูปตาราง', async () => {
    const svc = new BotRuntimeConfigService(makePrisma([]));
    expect(await svc.getStockMode()).toBe('LIVE');
    expect(await svc.getRateCards()).toEqual({});
  });

  it('shop_bot_stock_mode = no_stock (ตัวพิมพ์ใดก็ได้) → NO_STOCK · ค่าอื่น → LIVE', async () => {
    expect(
      await new BotRuntimeConfigService(makePrisma([{ key: 'shop_bot_stock_mode', value: ' no_stock ' }])).getStockMode(),
    ).toBe('NO_STOCK');
    expect(
      await new BotRuntimeConfigService(makePrisma([{ key: 'shop_bot_stock_mode', value: 'LIVE' }])).getStockMode(),
    ).toBe('LIVE');
  });

  it('อ่าน DB ไม่ได้ → โหมดปกติ ไม่ throw และไม่ cache ค่านั้น', async () => {
    const prisma = makePrisma(new Error('db down'));
    const svc = new BotRuntimeConfigService(prisma);
    expect(await svc.getStockMode()).toBe('LIVE');
    await svc.getStockMode();
    expect((prisma.systemConfig.findMany as jest.Mock).mock.calls.length).toBe(2);
  });

  it('cache 60 วิ — อ่าน DB ครั้งเดียวสำหรับหลายเทิร์นติดกัน', async () => {
    const prisma = makePrisma([{ key: 'shop_bot_stock_mode', value: 'NO_STOCK' }]);
    const svc = new BotRuntimeConfigService(prisma);
    await svc.getStockMode();
    await svc.getRateCards();
    expect((prisma.systemConfig.findMany as jest.Mock).mock.calls.length).toBe(1);
  });
});

describe('parseRateCards', () => {
  it('เก็บเฉพาะแถวที่มี label + (storageKey หรือ url)', () => {
    expect(
      parseRateCards(
        JSON.stringify({
          used_rate1: { storageKey: 'k1.jpg', label: 'เรท 1' },
          shop_map: { url: 'https://x/map.jpg', label: 'แผนที่' },
          no_label: { storageKey: 'k2.jpg' },
          no_source: { label: 'ว่าง' },
          junk: 'x',
        }),
      ),
    ).toEqual({
      used_rate1: { storageKey: 'k1.jpg', label: 'เรท 1' },
      shop_map: { url: 'https://x/map.jpg', label: 'แผนที่' },
    });
  });

  it('JSON พัง / array / ว่าง → {}', () => {
    expect(parseRateCards('{bad')).toEqual({});
    expect(parseRateCards('[]')).toEqual({});
    expect(parseRateCards('')).toEqual({});
    expect(parseRateCards(null)).toEqual({});
  });
});

describe('NO_STOCK_PROMPT (2026-09-22 รอบปรับจากแชทจริง)', () => {
  it('notify_staff ไม่ปิดบอท — ไม่มีคำสั่งเดิมที่ให้บอทหยุด/ห้ามคุยต่อ (คำตัดสินข้อ 1 · รีวิว PROMPT-1)', () => {
    expect(NO_STOCK_PROMPT).toContain('บอทยังตอบห้องนี้ต่อได้ตามปกติ');
    expect(NO_STOCK_PROMPT).toContain('บอทคุยต่อได้: ก้อนถัดไปเดินขั้นขายต่อ 1 เรื่องตามปกติ');
    expect(NO_STOCK_PROMPT).not.toContain('แอดมินคุยต่อเอง');
    expect(NO_STOCK_PROMPT).not.toContain('เทิร์นนั้นมีแค่ 2 บรรทัดนี้');
  });

  it('เครื่องไทย/มือ 1 ที่ไม่มีสัญญาณซื้อสด → บอกเรทเลย ไม่ถามเงินสด/ผ่อน (คำตัดสินข้อ 3 · synth C04)', () => {
    expect(NO_STOCK_PROMPT).toContain('ห้ามถาม "เงินสดหรือผ่อน"');
    expect(NO_STOCK_PROMPT).toContain('condition: "มือสอง" หรือ "มือ 1"');
    expect(NO_STOCK_PROMPT).toContain('เสนอเรทแบบ 4B ในเทิร์นนั้นเลย');
    expect(NO_STOCK_PROMPT).toContain('ขั้น 3 ตัดสินมือ 1/มือสองจากรายการมือ 1 + condition ในตารางเรท');
    expect(NO_STOCK_PROMPT).toContain('"มีของพร้อมรับที่ร้านค่ะ"');
  });

  it('การ์ด recommend_devices ห้ามมีแบต/สี/"มีของ" (รีวิว TOOLLOOP-4)', () => {
    expect(NO_STOCK_PROMPT).toMatch(/recommend_devices .*ห้ามมีแบต%\/สี/);
  });

  it('ซื้อสด: แจ้งพนักงานโดยไม่ขอชื่อ-เบอร์ซ้อน (synth P20)', () => {
    expect(NO_STOCK_PROMPT).toContain('เทิร์นนั้นไม่ต้องขอชื่อ-เบอร์');
  });

  it('เวลาร้านเปิดมาจาก utils/shop-hours (แหล่งเดียว)', () => {
    expect(NO_STOCK_PROMPT).toContain('แอดมินส่งรูปให้ช่วงร้านเปิด 10 โมงนะคะ');
  });
});
