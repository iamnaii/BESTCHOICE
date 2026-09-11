import { ContractQueryService } from '../../contracts/services/contract-query.service';
import { ContractWorkflowService } from '../../contracts/contract-workflow.service';
import { PrismaService } from '../../../prisma/prisma.service';

jest.mock('../../../utils/validation.util', () => ({
  checkRequiredContractFields: jest.fn().mockReturnValue([]),
  contractSignatureRequirements: jest.requireActual('../../../utils/validation.util').contractSignatureRequirements,
}));

it.each(['detail', 'submit-review'])(
  'keeps imported OCR private in the contract %s response while retaining the internal approval gate',
  async (endpoint) => {
    const contract = {
      id: 'contract',
      branchId: 'branch',
      deletedAt: null,
      salespersonId: 'sales',
      workflowStatus: 'CREATING',
      creditCheck: {
        id: 'credit',
        status: 'APPROVED',
        aiAnalysis: { source: 'chat-statement', monthlyIncome: 20000 },
      },
      customer: {},
      product: {},
      pdpaConsentId: 'consent',
      contractNumber: 'TEST',
      customerId: 'customer',
      productId: 'product',
      sellingPrice: 100,
      downPayment: 10,
      totalMonths: 3,
      monthlyPayment: 30,
      signatures: [
        { id: 's1', signerType: 'CUSTOMER' },
        { id: 's2', signerType: 'COMPANY' },
      ],
    };
    const db = {
      contract: { findUnique: jest.fn().mockResolvedValue(contract), update: jest.fn() },
      creditCheck: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const query = new ContractQueryService(db as unknown as PrismaService);
    const workflow = Object.assign(Object.create(ContractWorkflowService.prototype), {
      prisma: db,
    }) as ContractWorkflowService;
    const response =
      endpoint === 'detail'
        ? await query.findOne('contract', { id: 'sales', role: 'SALES', branchId: 'branch' })
        : await workflow.submitForReview('contract', 'sales');
    expect(response.creditCheck).toBeNull();
    if (endpoint === 'submit-review') expect(db.contract.update).toHaveBeenCalled();
  },
);
