import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AfterSalesController } from '../after-sales.controller';
import { AfterSalesService } from '../after-sales.service';
import { AfterSalesDocumentService } from '../services/after-sales-document.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { BranchGuard } from '../../auth/guards/branch.guard';

/**
 * Multer ตัดไฟล์ที่ 7 ก่อน service เช็ค ⇒ เดิมตอบ 400 ภาษาอังกฤษ ("Unexpected field - photos").
 * IntakePhotosInterceptor ต้องแปลเป็นข้อความไทยเดียวกับ service และไม่แตะ error ของ service
 */
describe('POST /after-sales — จำนวน/ขนาดรูปตอนรับฝาก (HTTP)', () => {
  let app: INestApplication;
  const createCase = jest.fn();
  const actor = { id: 'u-1', role: 'SALES', branchId: 'branch-001' };
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AfterSalesController],
      providers: [
        { provide: PrismaService, useValue: {} },
        RolesGuard,
        BranchGuard,
        { provide: AfterSalesService, useValue: { createCase } },
        { provide: AfterSalesDocumentService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          context.switchToHttp().getRequest().user = actor;
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => createCase.mockReset());

  const post = (photoCount: number) => {
    let req = request(app.getHttpServer())
      .post('/after-sales')
      .field('imei', '359123456789012')
      .field('symptom', 'จอแตกและเปิดไม่ติด')
      .field('accessories', '{}')
      .field('unlockConfirmed', 'true')
      .field('outcome', 'REPAIR')
      .field('branchId', 'branch-001');
    for (let i = 0; i < photoCount; i++) {
      req = req.attach('photos', jpeg, { filename: `p${i}.jpg`, contentType: 'image/jpeg' });
    }
    return req;
  };

  it('แนบ 7 รูป → 400 "รูปตอนรับฝากได้ไม่เกิน 6 รูป" ไม่ถึง service', async () => {
    const res = await post(7).expect(400);
    expect(res.body.message).toBe('รูปตอนรับฝากได้ไม่เกิน 6 รูป');
    expect(createCase).not.toHaveBeenCalled();
  });

  it('แนบ 6 รูป + branchId แบบ literal → ถึง service ตามปกติ (error ของ service ไม่ถูกแปลง)', async () => {
    createCase.mockResolvedValue({ id: 'c-1' });
    await post(6).expect(201);
    expect(createCase).toHaveBeenCalledTimes(1);
    expect(createCase.mock.calls[0][1]).toHaveLength(6);
    expect(createCase.mock.calls[0][0].branchId).toBe('branch-001');
  });
});
