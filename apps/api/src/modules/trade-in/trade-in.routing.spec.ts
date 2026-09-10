import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TradeInController } from './trade-in.controller';
import { TradeInService } from './trade-in.service';
import { BuybackQuestionAdminService } from './services/buyback-question-admin.service';
import { OnlineAppraisalService } from './services/online-appraisal.service';
import { PiiAuditService } from '../pii/pii-audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { PrismaService } from '../../prisma/prisma.service';

// หมายเหตุ: PrismaService mock ด้านล่างจำเป็นเพราะ TradeInController มี
// @UseGuards(ExportEnabledGuard) บน voucher.pdf route — Nest ต้อง resolve
// dependency ของ guard นี้ตอน compile module แม้ test จะไม่ยิง route นั้นเลย

/**
 * บั๊กเดิมที่ scrutinize เจอ: @Get(':id') ประกาศก่อน static GET → GET
 * /trade-ins/valuations เคยตอบ findOne('valuations') = 404 ทุกครั้ง
 * Test นี้ pin ว่า static ทุกตัว reachable
 */
describe('TradeInController routing', () => {
  let app: INestApplication;
  const tradeInService = {
    findOne: jest.fn().mockResolvedValue({ id: 'x' }),
    listValuations: jest.fn().mockResolvedValue({ data: [], total: 0 }),
    lookupValuation: jest.fn().mockResolvedValue({ found: false }),
    getValuationBrands: jest.fn().mockResolvedValue([]),
    getValuationModels: jest.fn().mockResolvedValue([]),
    deleteValuation: jest.fn().mockResolvedValue({ id: 'some-id' }),
  };
  const adminService = {
    list: jest.fn().mockResolvedValue({ questions: [] }),
    getSellConfig: jest.fn().mockResolvedValue({ exchangeBonusPct: 10 }),
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [TradeInController],
      providers: [
        { provide: TradeInService, useValue: tradeInService },
        { provide: BuybackQuestionAdminService, useValue: adminService },
        { provide: OnlineAppraisalService, useValue: { appraiseOnline: jest.fn(), referenceCatalog: jest.fn().mockResolvedValue(null) } },
        { provide: PiiAuditService, useValue: { logDecryption: jest.fn() } },
        { provide: PrismaService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: (ctx) => { ctx.switchToHttp().getRequest().user = { role: 'OWNER', accessibleCompanies: ['SHOP'] }; return true; } })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .overrideGuard(BranchGuard).useValue({ canActivate: () => true })
      .compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => await app.close());

  it.each([
    ['/trade-ins/valuations', 'listValuations'],
    ['/trade-ins/valuation-brands', 'getValuationBrands'],
    ['/trade-ins/valuation-models?brand=Apple', 'getValuationModels'],
  ])('GET %s ไม่โดน :id กลืน', async (path, method) => {
    await request(app.getHttpServer()).get(path).expect(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((tradeInService as any)[method]).toHaveBeenCalled();
    expect(tradeInService.findOne).not.toHaveBeenCalled();
  });

  it('DELETE /trade-ins/valuations/:id → deleteValuation ไม่โดน findOne กลืน', async () => {
    await request(app.getHttpServer()).delete('/trade-ins/valuations/some-id').expect(200);
    expect(tradeInService.deleteValuation).toHaveBeenCalledWith('some-id');
    expect(tradeInService.findOne).not.toHaveBeenCalled();
  });

  it('GET /trade-ins/buyback-questions → admin list', async () => {
    await request(app.getHttpServer()).get('/trade-ins/buyback-questions').expect(200);
    expect(adminService.list).toHaveBeenCalled();
    expect(tradeInService.findOne).not.toHaveBeenCalled();
  });

  it('GET /trade-ins/sell-config ไม่โดน :id กลืน', async () => {
    await request(app.getHttpServer()).get('/trade-ins/sell-config').expect(200);
    expect(adminService.getSellConfig).toHaveBeenCalled();
    expect(tradeInService.findOne).not.toHaveBeenCalled();
  });

  it('GET /trade-ins/:id ยังทำงาน', async () => {
    await request(app.getHttpServer()).get('/trade-ins/some-id').expect(200);
    expect(tradeInService.findOne).toHaveBeenCalledWith('some-id');
  });
});

/**
 * หลักฐาน end-to-end ว่า lockout หายจริง — ไฟล์นี้เป็นที่เดียวในบ้านที่ยิง route ผ่าน Nest
 * pipeline โดย **ไม่** override EntityScopeGuard จึงเป็นตัวเดียวที่ทดสอบ guard ตัวจริง
 * 10 route ของ trade-in ที่ติด @Entity('SHOP') ตอบ 403 ให้ทุกคนมาตั้งแต่ migration
 * 20260951000000 เพราะ users.accessible_companies ไม่เคยถูกเขียน (String[] @default([]))
 * describe นี้ pin ว่า user ที่ยังไม่ backfill ต้องผ่าน
 */
describe('TradeInController × EntityScopeGuard — user ที่ยังไม่ backfill', () => {
  let app: INestApplication;
  const tradeInService = {
    availableCredits: jest.fn().mockResolvedValue([]),
  };
  const onlineAppraisal = {
    quickBuyCatalog: jest.fn().mockResolvedValue({ models: [] }),
    referenceCatalog: jest.fn().mockResolvedValue(null),
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [TradeInController],
      providers: [
        { provide: TradeInService, useValue: tradeInService },
        { provide: BuybackQuestionAdminService, useValue: {} },
        { provide: OnlineAppraisalService, useValue: onlineAppraisal },
        { provide: PiiAuditService, useValue: { logDecryption: jest.fn() } },
        { provide: PrismaService, useValue: {} },
      ],
    })
      // accessibleCompanies: [] = สภาพจริงของทุกแถวบน prod ก่อน backfill
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: (ctx) => { ctx.switchToHttp().getRequest().user = { role: 'SALES', accessibleCompanies: [], primaryCompany: null }; return true; } })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .overrideGuard(BranchGuard).useValue({ canActivate: () => true })
      .compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => await app.close());

  it.each([
    ['/trade-ins/quick-buy/catalog'],
    ['/trade-ins/credits?customerId=c-1&branchId=b-1'],
  ])('GET %s ไม่โดน EntityScopeGuard 403 ทั้งที่ accessibleCompanies ว่าง', async (path) => {
    await request(app.getHttpServer()).get(path).expect(200);
  });

  it('SALES ที่ถูกจำกัดเป็น FINANCE จริง ๆ ยังโดน 403 (array ไม่ว่าง = บังคับเป๊ะ)', async () => {
    const mod = await Test.createTestingModule({
      controllers: [TradeInController],
      providers: [
        { provide: TradeInService, useValue: tradeInService },
        { provide: BuybackQuestionAdminService, useValue: {} },
        { provide: OnlineAppraisalService, useValue: onlineAppraisal },
        { provide: PiiAuditService, useValue: { logDecryption: jest.fn() } },
        { provide: PrismaService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: (ctx) => { ctx.switchToHttp().getRequest().user = { role: 'SALES', accessibleCompanies: ['FINANCE'], primaryCompany: 'FINANCE' }; return true; } })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .overrideGuard(BranchGuard).useValue({ canActivate: () => true })
      .compile();
    const restricted = mod.createNestApplication();
    await restricted.init();
    await request(restricted.getHttpServer()).get('/trade-ins/quick-buy/catalog').expect(403);
    await restricted.close();
  });
});
