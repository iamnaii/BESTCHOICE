import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { ShopShareController } from './shop-share.controller';
import { ShopCatalogService } from './shop-catalog.service';
import { ShopBotDefenseGuard } from '../shop-bot-defense/shop-bot-defense.guard';

function resMock() {
  const res = {
    setHeader: jest.fn(),
    removeHeader: jest.fn(),
    status: jest.fn(),
    send: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res as unknown as Response & {
    setHeader: jest.Mock;
    removeHeader: jest.Mock;
    status: jest.Mock;
    send: jest.Mock;
  };
}

const detail = {
  id: 'p-1',
  brand: 'Apple',
  model: 'iPhone 15 Pro',
  storage: '256GB',
  color: 'Blue',
  category: 'PHONE_USED',
  condition: 'USED' as const,
  description: undefined,
  gallery: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'],
  gallery360: [],
  cashPrice: 31900,
  installmentPrice: 34900,
  tiers: {
    A: {
      minPrice: 29900,
      maxPrice: 31900,
      units: [
        {
          id: 'u-1',
          conditionGrade: 'A',
          batteryHealth: 92,
          shopWarrantyDays: 45,
          cashPrice: 29900,
          installmentPrice: 32900,
          gallery: [],
          gallery360: [],
          accessories: [],
          qcChecklist: [],
        },
      ],
    },
  },
};

describe('ShopShareController', () => {
  let controller: ShopShareController;
  let catalog: { getProductDetail: jest.Mock };

  beforeEach(async () => {
    process.env.SHOP_BASE_URL = 'https://www.bestchoicephone.com';
    catalog = { getProductDetail: jest.fn().mockResolvedValue(detail) };
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [ShopShareController],
      providers: [{ provide: ShopCatalogService, useValue: catalog }],
    })
      .overrideGuard(ShopBotDefenseGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = mod.get(ShopShareController);
  });

  afterEach(() => { delete process.env.SHOP_BASE_URL; });

  it('404s when the product is not visible on the shop', async () => {
    catalog.getProductDetail.mockResolvedValue(null);
    const res = resMock();
    await expect(controller.share('nope', res)).rejects.toBeInstanceOf(NotFoundException);
    expect(res.send).not.toHaveBeenCalled();
  });

  it('serves HTML with the right content type and a short public cache', async () => {
    const res = resMock();
    await controller.share('p-1', res);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html; charset=utf-8');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, max-age=300');
    // main.ts ยัด Pragma/Expires ให้ทุก /api/* — ต้องถอดออก ไม่งั้น CDN/crawler
    // บางตัวอ่าน Expires:0 แล้วไม่ยอม cache แม้ Cache-Control จะบอกให้ cache
    expect(res.removeHeader).toHaveBeenCalledWith('Pragma');
    expect(res.removeHeader).toHaveBeenCalledWith('Expires');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('sets a per-response CSP nonce that matches the script tags', async () => {
    const res = resMock();
    await controller.share('p-1', res);
    const csp = res.setHeader.mock.calls.find((c) => c[0] === 'Content-Security-Policy')?.[1] as string;
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(res.send.mock.calls[0][0]).toContain(`nonce="${nonce}"`);
  });

  it('uses gallery[0] as og:image and the cheapest unit price', async () => {
    const res = resMock();
    await controller.share('p-1', res);
    const html = res.send.mock.calls[0][0] as string;
    expect(html).toContain('<meta property="og:image" content="https://cdn.example.com/a.jpg">');
    expect(html).toContain('<meta property="product:price:amount" content="29900">');
    // ชื่อประกอบจาก brand+model+storage+color เหมือน displayName ของ web-shop
    // (ProductDetailPage.tsx:176) จึงมี 'Apple' นำหน้าเสมอ
    expect(html).toContain('<meta property="og:title" content="Apple iPhone 15 Pro 256GB Blue">');
  });

  it('redirects to the SPA product page, not to itself', async () => {
    const res = resMock();
    await controller.share('p-1', res);
    const html = res.send.mock.calls[0][0] as string;
    expect(html).toContain('https://www.bestchoicephone.com/products/p-1');
    expect(html).not.toContain('/api/shop/share/p-1');
  });

  it('escapes a malicious product model instead of emitting raw markup', async () => {
    catalog.getProductDetail.mockResolvedValue({ ...detail, model: '<script>alert(1)</script>' });
    const res = resMock();
    await controller.share('p-1', res);
    const html = res.send.mock.calls[0][0] as string;
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
