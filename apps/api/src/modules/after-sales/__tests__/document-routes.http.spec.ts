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

const CASE_ID = '11111111-1111-4111-8111-111111111111';

describe('GET /after-sales/:id/(receipt|handover).pdf (HTTP)', () => {
  let app: INestApplication;
  const render = jest.fn();
  const actor = { id: 'u-1', role: 'ACCOUNTANT', branchId: null };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AfterSalesController],
      providers: [
        { provide: PrismaService, useValue: {} },
        RolesGuard,
        BranchGuard,
        { provide: AfterSalesService, useValue: {} },
        { provide: AfterSalesDocumentService, useValue: { render } },
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
  beforeEach(() => render.mockReset());

  it('ใบรับฝาก → 200 application/pdf + ชื่อไฟล์ตามเลขเคส (ACCOUNTANT เปิดได้)', async () => {
    render.mockResolvedValue({ pdf: Buffer.from('%PDF-1.4 test'), caseNumber: 'AS-20260907-0004' });
    const res = await request(app.getHttpServer())
      .get(`/after-sales/${CASE_ID}/receipt.pdf`)
      .expect(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toBe(
      'inline; filename="after-sales-receipt-AS-20260907-0004.pdf"',
    );
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(render).toHaveBeenCalledWith(CASE_ID, 'RECEIPT', actor);
  });

  it('ใบส่งมอบ → kind HANDOVER', async () => {
    render.mockResolvedValue({ pdf: Buffer.from('%PDF-1.4 test'), caseNumber: 'AS-20260907-0004' });
    const res = await request(app.getHttpServer())
      .get(`/after-sales/${CASE_ID}/handover.pdf`)
      .expect(200);
    expect(res.headers['content-disposition']).toBe(
      'inline; filename="after-sales-handover-AS-20260907-0004.pdf"',
    );
    expect(render).toHaveBeenCalledWith(CASE_ID, 'HANDOVER', actor);
  });

  it('id ไม่ใช่ UUID → 400 ไม่ถึง service', async () => {
    await request(app.getHttpServer()).get('/after-sales/not-a-uuid/receipt.pdf').expect(400);
    expect(render).not.toHaveBeenCalled();
  });
});
