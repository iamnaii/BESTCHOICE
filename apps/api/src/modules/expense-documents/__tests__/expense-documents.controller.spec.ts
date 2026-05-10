import { Test } from '@nestjs/testing';
import { ExpenseDocumentsController } from '../expense-documents.controller';
import { ExpenseDocumentsService } from '../expense-documents.service';

describe('ExpenseDocumentsController', () => {
  let controller: ExpenseDocumentsController;
  let service: jest.Mocked<Partial<ExpenseDocumentsService>>;

  beforeEach(async () => {
    service = {
      create: jest.fn().mockResolvedValue({ id: 'doc-1', number: 'EX-20260510-0001' }),
      list: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 }),
      getSummary: jest.fn().mockResolvedValue({
        totalCount: 0,
        byStatus: {},
        accrualUnpaidCount: 0,
        accrualUnpaidTotal: 0,
      }),
      findOne: jest.fn().mockResolvedValue({ id: 'doc-1' }),
      update: jest.fn().mockResolvedValue({ id: 'doc-1' }),
      post: jest.fn().mockResolvedValue({ entryNo: 'JE-1' }),
      voidDocument: jest.fn().mockResolvedValue({ id: 'doc-1' }),
      softDelete: jest.fn().mockResolvedValue({ id: 'doc-1' }),
      createCreditNote: jest.fn().mockResolvedValue({ id: 'cn-1', number: 'CN-20260510-0001' }),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [ExpenseDocumentsController],
      providers: [{ provide: ExpenseDocumentsService, useValue: service }],
    })
      .overrideGuard(require('../../auth/guards/jwt-auth.guard').JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(require('../../auth/guards/roles.guard').RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(ExpenseDocumentsController);
  });

  it('POST / calls service.create with userId', async () => {
    await controller.create({ documentType: 'EXPENSE' } as never, { id: 'user-1' } as never);
    expect(service.create).toHaveBeenCalledWith({ documentType: 'EXPENSE' }, 'user-1');
  });

  it('GET / passes query + user context', async () => {
    await controller.list(
      { tab: 'draft' } as never,
      { user: { id: 'u', branchId: 'b1', role: 'BRANCH_MANAGER' } } as never,
    );
    expect(service.list).toHaveBeenCalledWith(
      { tab: 'draft' },
      { branchId: 'b1', role: 'BRANCH_MANAGER' },
    );
  });

  it('GET /summary calls service.getSummary', async () => {
    await controller.summary('b1', undefined, undefined, {
      user: { id: 'u', branchId: 'b1', role: 'OWNER' },
    } as never);
    expect(service.getSummary).toHaveBeenCalledWith({
      branchId: 'b1',
      startDate: undefined,
      endDate: undefined,
    });
  });

  it('GET /:id calls findOne', async () => {
    await controller.findOne('doc-1');
    expect(service.findOne).toHaveBeenCalledWith('doc-1');
  });

  it('POST /:id/post fires post', async () => {
    await controller.post('doc-1', { id: 'user-1' } as never);
    expect(service.post).toHaveBeenCalledWith('doc-1', 'user-1');
  });

  it('POST /:id/void fires voidDocument', async () => {
    await controller.void('doc-1', { id: 'user-1' } as never);
    expect(service.voidDocument).toHaveBeenCalledWith('doc-1', 'user-1');
  });

  it('PATCH /:id calls update', async () => {
    await controller.update('doc-1', { description: 'X' } as never, { id: 'user-1' } as never);
    expect(service.update).toHaveBeenCalledWith('doc-1', { description: 'X' }, 'user-1');
  });

  it('DELETE /:id calls softDelete', async () => {
    await controller.delete('doc-1', { id: 'user-1' } as never);
    expect(service.softDelete).toHaveBeenCalledWith('doc-1', 'user-1');
  });

  it('POST /credit-note calls service.createCreditNote with userId', async () => {
    await controller.createCreditNote({ originalDocumentId: 'orig-1' } as never, { id: 'user-1' } as never);
    expect(service.createCreditNote).toHaveBeenCalledWith({ originalDocumentId: 'orig-1' }, 'user-1');
  });
});
