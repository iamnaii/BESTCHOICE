import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TradeInController } from './trade-in.controller';
import { TradeInService } from './trade-in.service';
import { BuybackQuestionAdminService } from './services/buyback-question-admin.service';
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
  };
  const adminService = { list: jest.fn().mockResolvedValue({ questions: [] }) };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [TradeInController],
      providers: [
        { provide: TradeInService, useValue: tradeInService },
        { provide: BuybackQuestionAdminService, useValue: adminService },
        { provide: PiiAuditService, useValue: { logDecryption: jest.fn() } },
        { provide: PrismaService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
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

  it('GET /trade-ins/buyback-questions → admin list', async () => {
    await request(app.getHttpServer()).get('/trade-ins/buyback-questions').expect(200);
    expect(adminService.list).toHaveBeenCalled();
    expect(tradeInService.findOne).not.toHaveBeenCalled();
  });

  it('GET /trade-ins/:id ยังทำงาน', async () => {
    await request(app.getHttpServer()).get('/trade-ins/some-id').expect(200);
    expect(tradeInService.findOne).toHaveBeenCalledWith('some-id');
  });
});
