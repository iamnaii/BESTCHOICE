import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ShopBuybackController } from './shop-buyback.controller';
import { ShopBuybackService } from './shop-buyback.service';
import { ShopBotDefenseGuard } from '../shop-bot-defense/shop-bot-defense.guard';

/**
 * กัน route-shadowing: static GET (catalog/questions) ต้องไม่โดน @Get(':id') กลืน
 * — unit spec เรียก method ตรงจับบั๊กนี้ไม่ได้ ต้องยิงผ่าน HTTP layer จริง
 */
describe('ShopBuybackController routing', () => {
  let app: INestApplication;
  const service = {
    getCatalog: jest.fn().mockResolvedValue({ models: [] }),
    getQuestions: jest.fn().mockResolvedValue({ questions: [] }),
    getStatus: jest.fn().mockResolvedValue({ id: 'ti-1' }),
    quoteForAnswers: jest.fn(),
    submit: jest.fn(),
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [ShopBuybackController],
      providers: [{ provide: ShopBuybackService, useValue: service }],
    })
      .overrideGuard(ShopBotDefenseGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () =>
    await app.close());

  it('GET /shop/buyback/catalog → catalog ไม่ใช่ getStatus', async () => {
    await request(app.getHttpServer()).get('/shop/buyback/catalog').expect(200);
    expect(service.getCatalog).toHaveBeenCalled();
    expect(service.getStatus).not.toHaveBeenCalledWith('catalog');
  });

  it('GET /shop/buyback/questions → questions ไม่ใช่ getStatus', async () => {
    await request(app.getHttpServer()).get('/shop/buyback/questions').expect(200);
    expect(service.getQuestions).toHaveBeenCalled();
    expect(service.getStatus).not.toHaveBeenCalledWith('questions');
  });

  it('GET /shop/buyback/:id ยังทำงาน', async () => {
    await request(app.getHttpServer()).get('/shop/buyback/some-uuid').expect(200);
    expect(service.getStatus).toHaveBeenCalledWith('some-uuid');
  });
});
