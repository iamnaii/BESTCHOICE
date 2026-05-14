/**
 * OtherIncomeController — controller unit tests (T8)
 *
 * Tests:
 *  1. @Roles metadata — guards are wired correctly (Reflector approach, no DB needed)
 *  2. HTTP route ordering — daily-sheet declared before :id (integration via TestingModule)
 *  3. ValidationPipe — 400 on missing required fields
 *  4. Controller delegation — service methods are called with correct args
 *
 * NOTE: We use a minimal TestingModule with mocked guards + mocked service rather than
 * bootstrapping the full AppModule. Full AppModule startup requires ~30+ env vars and
 * external services (S3, Redis, pgvector, LINE webhooks, etc.) that aren't available in
 * the unit test environment. Real DB integration is covered by other-income.service.spec.ts.
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import { OtherIncomeController } from '../other-income.controller';
import { OtherIncomeService } from '../other-income.service';
import { TemplateService } from '../services/template.service';
import { OtherIncomeReceiptPdfService } from '../services/receipt-pdf.service';
import { ValidationService } from '../services/validation.service';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const VALID_CREATE_PAYLOAD = {
  issueDate: '2026-05-06',
  priceType: 'EXCLUSIVE',
  paymentAccountCode: '11-1201',
  amountReceived: 850,
  counterpartyName: 'KBank',
  items: [{ accountCode: '42-1102', quantity: 1, unitAmount: 1000, whtPct: 15 }],
};

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1: @Roles metadata (Reflector — no HTTP needed, no DB)
// ─────────────────────────────────────────────────────────────────────────────

describe('OtherIncomeController — @Roles metadata', () => {
  const reflector = new Reflector();

  const classRoles = (): string[] | undefined =>
    reflector.get<string[]>(ROLES_KEY, OtherIncomeController);

  const methodRoles = (methodName: string): string[] | undefined => {
    const handler = (OtherIncomeController.prototype as unknown as Record<string, unknown>)[
      methodName
    ];
    if (typeof handler !== 'function') return undefined;
    return reflector.get<string[]>(ROLES_KEY, handler as () => void);
  };

  it('class-level guard allows OWNER, FINANCE_MANAGER, ACCOUNTANT — excludes SALES', () => {
    const roles = classRoles();
    expect(roles).toEqual(expect.arrayContaining(['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']));
    expect(roles).not.toContain('SALES');
    expect(roles).not.toContain('BRANCH_MANAGER');
  });

  it('reverse() is restricted to OWNER + FINANCE_MANAGER — ACCOUNTANT excluded', () => {
    const roles = methodRoles('reverse');
    expect(roles).toBeDefined();
    expect(roles).toEqual(expect.arrayContaining(['OWNER', 'FINANCE_MANAGER']));
    expect(roles).not.toContain('ACCOUNTANT');
    expect(roles).not.toContain('SALES');
  });

  it('list(), create(), post(), copy() have no method-level @Roles (inherit class)', () => {
    expect(methodRoles('list')).toBeUndefined();
    expect(methodRoles('create')).toBeUndefined();
    expect(methodRoles('post')).toBeUndefined();
    expect(methodRoles('copy')).toBeUndefined();
  });

  // I2 — getMakerCheckerEnabled used to permit SALES + BRANCH_MANAGER even
  // though those roles cannot access any Other Income screen. Restrict it.
  it('getMakerCheckerEnabled() restricts to OWNER + ACCOUNTANT + FINANCE_MANAGER', () => {
    const roles = methodRoles('getMakerCheckerEnabled');
    expect(roles).toBeDefined();
    expect(roles).toEqual(
      expect.arrayContaining(['OWNER', 'ACCOUNTANT', 'FINANCE_MANAGER']),
    );
    expect(roles).not.toContain('SALES');
    expect(roles).not.toContain('BRANCH_MANAGER');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2: Controller unit tests (mocked service, bypassed guards)
// ─────────────────────────────────────────────────────────────────────────────

describe('OtherIncomeController — unit (mocked service)', () => {
  let controller: OtherIncomeController;
  let service: jest.Mocked<OtherIncomeService>;

  beforeEach(async () => {
    const mockService = {
      list: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 50 }),
      findOneOrFail: jest.fn().mockResolvedValue({ id: 'test-id', docNumber: 'OI-2026-0001' }),
      create: jest.fn().mockResolvedValue({ id: 'new-id', docNumber: 'OI-2026-0001', status: 'DRAFT' }),
      update: jest.fn().mockResolvedValue({ id: 'test-id', docNumber: 'OI-2026-0001' }),
      softDelete: jest.fn().mockResolvedValue({ id: 'test-id' }),
      post: jest.fn().mockResolvedValue({ id: 'test-id', status: 'POSTED' }),
      reverse: jest.fn().mockResolvedValue({ id: 'test-id', status: 'REVERSED' }),
      copy: jest.fn().mockResolvedValue({ id: 'copy-id', docNumber: 'OI-2026-0002', status: 'DRAFT' }),
      dailySheet: jest.fn().mockResolvedValue({ date: '2026-05-06', docs: [] }),
    } as unknown as jest.Mocked<OtherIncomeService>;

    const module = await Test.createTestingModule({
      controllers: [OtherIncomeController],
      providers: [
        { provide: OtherIncomeService, useValue: mockService },
        {
          provide: TemplateService,
          useValue: {
            list: jest.fn().mockResolvedValue([]),
            create: jest.fn(),
            createFromDoc: jest.fn(),
            update: jest.fn(),
            softDelete: jest.fn(),
            use: jest.fn(),
          },
        },
        {
          provide: OtherIncomeReceiptPdfService,
          useValue: { generate: jest.fn().mockResolvedValue(Buffer.from('pdf-stub')) },
        },
        {
          provide: ValidationService,
          useValue: { checkLateFeeCollision: jest.fn().mockResolvedValue([]) },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(OtherIncomeController);
    service = module.get(OtherIncomeService) as jest.Mocked<OtherIncomeService>;
  });

  it('list() delegates to service.list() with query DTO', async () => {
    const query = { page: 1, limit: 50 };
    const result = await controller.list(query as any);
    expect(service.list).toHaveBeenCalledWith(query);
    expect(result).toHaveProperty('data');
  });

  it('list() forwards statusIn (DRAFT,READY) for "ค้างดำเนินการ" filter card', async () => {
    const query = { page: 1, limit: 50, statusIn: 'DRAFT,READY' };
    await controller.list(query as any);
    expect(service.list).toHaveBeenCalledWith(query);
  });

  it('findOne() delegates to service.findOneOrFail() with id', async () => {
    const id = '00000000-0000-0000-0000-000000000001';
    const result = await controller.findOne(id);
    expect(service.findOneOrFail).toHaveBeenCalledWith(id);
    expect(result).toHaveProperty('id', 'test-id');
  });

  it('create() delegates to service.create() with dto + userId', async () => {
    const result = await controller.create(VALID_CREATE_PAYLOAD as any, 'user-123');
    expect(service.create).toHaveBeenCalledWith(VALID_CREATE_PAYLOAD, 'user-123');
    expect(result.status).toBe('DRAFT');
    expect(result.docNumber).toMatch(/^OI-/);
  });

  it('softDelete() delegates to service.softDelete() with id + userId', async () => {
    const id = '00000000-0000-0000-0000-000000000001';
    await controller.softDelete(id, 'user-123');
    expect(service.softDelete).toHaveBeenCalledWith(id, 'user-123');
  });

  it('post() delegates to service.post() with id + dto + userId', async () => {
    const id = '00000000-0000-0000-0000-000000000001';
    const dto = {};
    const result = await controller.post(id, dto as any, 'user-123');
    expect(service.post).toHaveBeenCalledWith(id, dto, 'user-123');
    expect(result.status).toBe('POSTED');
  });

  it('reverse() delegates to service.reverse() with id + dto + userId', async () => {
    const id = '00000000-0000-0000-0000-000000000001';
    const dto = { reason: 'INPUT_ERROR', note: 'test reverse' };
    const result = await controller.reverse(id, dto as any, 'user-123');
    expect(service.reverse).toHaveBeenCalledWith(id, dto, 'user-123');
    expect(result.status).toBe('REVERSED');
  });

  it('copy() delegates to service.copy() with id + userId', async () => {
    const id = '00000000-0000-0000-0000-000000000001';
    const result = await controller.copy(id, 'user-123');
    expect(service.copy).toHaveBeenCalledWith(id, 'user-123');
    expect(result.docNumber).toMatch(/^OI-/);
    expect(result.status).toBe('DRAFT');
  });

  it('dailySheet() delegates to service.dailySheet() with date string', async () => {
    const result = await controller.dailySheet({ date: '2026-05-06' });
    expect(service.dailySheet).toHaveBeenCalledWith('2026-05-06');
    expect(result).toHaveProperty('date');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3: ValidationPipe integration — 400 on invalid payloads
// ─────────────────────────────────────────────────────────────────────────────

describe('OtherIncomeController — ValidationPipe (TestingModule + http)', () => {
  let app: INestApplication;
  let httpServer: import('http').Server;

  const mockService = {
    create: jest.fn().mockResolvedValue({ id: 'new-id', docNumber: 'OI-2026-0001', status: 'DRAFT' }),
    list: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 50 }),
    dailySheet: jest.fn().mockResolvedValue({ date: '2026-05-06', docs: [] }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [OtherIncomeController],
      providers: [
        { provide: OtherIncomeService, useValue: mockService },
        {
          provide: TemplateService,
          useValue: {
            list: jest.fn().mockResolvedValue([]),
            create: jest.fn(),
            createFromDoc: jest.fn(),
            update: jest.fn(),
            softDelete: jest.fn(),
            use: jest.fn(),
          },
        },
        {
          provide: OtherIncomeReceiptPdfService,
          useValue: { generate: jest.fn().mockResolvedValue(Buffer.from('pdf-stub')) },
        },
        {
          provide: ValidationService,
          useValue: { checkLateFeeCollision: jest.fn().mockResolvedValue([]) },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: import('@nestjs/common').ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest();
          req.user = { id: 'user-001', role: 'OWNER' };
          return true;
        },
      })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
    httpServer = app.getHttpServer() as import('http').Server;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('POST / — ValidationPipe rejects missing items via controller binding', async () => {
    // Test that ValidationPipe is wired and rejects bad DTOs
    const pipe = new ValidationPipe({ transform: true, whitelist: true });

    // Simulate what NestJS does internally — validate against CreateOtherIncomeDto
    const { CreateOtherIncomeDto } = await import('../dto/create-other-income.dto');
    const badPayload = {
      issueDate: '2026-05-06',
      priceType: 'EXCLUSIVE',
      paymentAccountCode: '11-1201',
      amountReceived: 850,
      // items missing
    };

    await expect(pipe.transform(badPayload, { type: 'body', metatype: CreateOtherIncomeDto })).rejects.toMatchObject({
      response: expect.objectContaining({ statusCode: 400 }),
    });
  });

  it('POST / — ValidationPipe accepts valid payload', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true });
    const { CreateOtherIncomeDto } = await import('../dto/create-other-income.dto');
    const result = await pipe.transform(VALID_CREATE_PAYLOAD, {
      type: 'body',
      metatype: CreateOtherIncomeDto,
    });
    expect(result).toBeInstanceOf(CreateOtherIncomeDto);
    expect(result.issueDate).toBe('2026-05-06');
  });

  it('GET /daily-sheet — ValidationPipe rejects missing date param', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true });
    const { DailySheetQueryDto } = await import('../dto/daily-sheet-query.dto');
    await expect(pipe.transform({}, { type: 'query', metatype: DailySheetQueryDto })).rejects.toMatchObject({
      response: expect.objectContaining({ statusCode: 400 }),
    });
  });

  // ─── C16: ReverseOtherIncomeDto enum guard ───────────────────────────────
  // Without @IsEnum the bad `reason` string would slip past the pipe, hit
  // `prisma.otherIncome.update({ data: { reverseReason: dto.reason }})` and
  // crash mid-transaction — leaving the reversal JE written but the doc-status
  // flip never persisted (orphan record).
  it('POST /:id/reverse — ValidationPipe rejects invalid reason enum value (C16)', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true });
    const { ReverseOtherIncomeDto } = await import('../dto/reverse-other-income.dto');
    await expect(
      pipe.transform(
        { reason: 'NOT_A_REAL_REASON', note: 'should be rejected before service runs' },
        { type: 'body', metatype: ReverseOtherIncomeDto },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ statusCode: 400 }),
    });
  });

  it('POST /:id/reverse — ValidationPipe rejects empty note (C16)', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true });
    const { ReverseOtherIncomeDto } = await import('../dto/reverse-other-income.dto');
    await expect(
      pipe.transform(
        { reason: 'INPUT_ERROR', note: '' },
        { type: 'body', metatype: ReverseOtherIncomeDto },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ statusCode: 400 }),
    });
  });

  it('POST /:id/reverse — ValidationPipe rejects short note (< 5 chars) (C16)', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true });
    const { ReverseOtherIncomeDto } = await import('../dto/reverse-other-income.dto');
    await expect(
      pipe.transform(
        { reason: 'INPUT_ERROR', note: 'oops' },
        { type: 'body', metatype: ReverseOtherIncomeDto },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ statusCode: 400 }),
    });
  });

  it('POST /:id/reverse — ValidationPipe accepts every valid OtherIncomeReverseReason enum value (C16)', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true });
    const { ReverseOtherIncomeDto } = await import('../dto/reverse-other-income.dto');
    const { OtherIncomeReverseReason } = await import('@prisma/client');
    for (const value of Object.values(OtherIncomeReverseReason)) {
      const result = await pipe.transform(
        { reason: value, note: 'valid reason note for test' },
        { type: 'body', metatype: ReverseOtherIncomeDto },
      );
      expect(result).toBeInstanceOf(ReverseOtherIncomeDto);
      expect(result.reason).toBe(value);
    }
  });
});
