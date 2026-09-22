import { BotRuntimeConfigService, parseRateCards } from './bot-runtime-config.service';
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
