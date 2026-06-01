import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ContactResolverService } from '../contacts/contact-resolver.service';

/**
 * T5-C18: Supplier bank account cannot be swapped while an open (non-CANCELLED)
 * PO still points at the supplier. Historical POs carry bankAccountSnapshot +
 * bankNameSnapshot from the PO create path; the service-level block here is
 * the second leg of the same invariant ("don't let money go to a new account
 * that the PO never agreed to").
 */
describe('SuppliersService — T5-C18 bank swap guard', () => {
  let service: SuppliersService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      supplier: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'sup-1',
          name: 'Sup',
          deletedAt: null,
          _count: { products: 0, purchaseOrders: 0 },
          paymentMethods: [],
        }),
        update: jest.fn().mockResolvedValue({ id: 'sup-1' }),
      },
      purchaseOrder: {
        count: jest.fn().mockResolvedValue(0),
      },
      supplierPaymentMethod: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn().mockImplementation(async (fn) => {
        if (typeof fn === 'function') return fn(prisma);
        return Promise.all(fn);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SuppliersService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ContactResolverService,
          useValue: { findOrCreateByNaturalKey: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<SuppliersService>(SuppliersService);
  });

  it('allows paymentMethods edit when no open PO exists', async () => {
    prisma.purchaseOrder.count.mockResolvedValue(0);
    prisma.supplier.findUnique.mockResolvedValue({
      id: 'sup-1',
      deletedAt: null,
      _count: { products: 0, purchaseOrders: 0 },
      paymentMethods: [
        { bankName: 'KBank', bankAccountNumber: '111', paymentMethod: 'BANK_TRANSFER' },
      ],
    });

    await expect(
      service.update('sup-1', {
        paymentMethods: [
          { paymentMethod: 'BANK_TRANSFER', bankName: 'SCB', bankAccountNumber: '222' },
        ],
      } as never),
    ).resolves.toBeDefined();

    expect(prisma.supplierPaymentMethod.updateMany).toHaveBeenCalled();
  });

  it('rejects bank swap when non-CANCELLED PO exists', async () => {
    prisma.purchaseOrder.count.mockResolvedValue(2); // open POs
    prisma.supplierPaymentMethod.findMany.mockResolvedValue([
      { bankName: 'KBank', bankAccountNumber: '111' },
    ]);

    await expect(
      service.update('sup-1', {
        paymentMethods: [
          { paymentMethod: 'BANK_TRANSFER', bankName: 'SCB', bankAccountNumber: '222' },
        ],
      } as never),
    ).rejects.toThrow(BadRequestException);

    // update must NOT have been called
    expect(prisma.supplier.update).not.toHaveBeenCalled();
  });

  it('allows paymentMethods update when open POs exist but bank details are unchanged', async () => {
    // Scenario: user flips isDefault among existing bank accounts but doesn't
    // actually change the bank/account. That should still be allowed.
    prisma.purchaseOrder.count.mockResolvedValue(1);
    prisma.supplierPaymentMethod.findMany.mockResolvedValue([
      { bankName: 'KBank', bankAccountNumber: '111' },
    ]);

    await expect(
      service.update('sup-1', {
        paymentMethods: [
          {
            paymentMethod: 'BANK_TRANSFER',
            bankName: 'KBank',
            bankAccountNumber: '111',
            isDefault: true,
          },
        ],
      } as never),
    ).resolves.toBeDefined();
  });
});

/**
 * Task 9: creating a Supplier links a Contact (party master) under the
 * SUPPLIER role. The Contact resolve + supplier create run in the SAME
 * $transaction so the FK is atomic.
 */
describe('SuppliersService — Contact party-master link on create', () => {
  let service: SuppliersService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let contactResolver: any;

  beforeEach(async () => {
    prisma = {
      supplier: {
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: 'sup-new',
          ...data,
        })),
      },
      $transaction: jest.fn().mockImplementation(async (fn) => {
        if (typeof fn === 'function') return fn(prisma);
        return Promise.all(fn);
      }),
    };

    contactResolver = {
      findOrCreateByNaturalKey: jest.fn().mockResolvedValue({ id: 'contact-123' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SuppliersService,
        { provide: PrismaService, useValue: prisma },
        { provide: ContactResolverService, useValue: contactResolver },
      ],
    }).compile();

    service = module.get<SuppliersService>(SuppliersService);
  });

  it('resolves a Contact (SUPPLIER role) and links it on create', async () => {
    await service.create({
      name: 'ACME Co',
      taxId: '0105500000001',
      phone: '081-234-5678',
    } as never);

    expect(contactResolver.findOrCreateByNaturalKey).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        name: 'ACME Co',
        taxId: '0105500000001',
        phone: '081-234-5678',
        nationalIdHash: null,
        role: 'SUPPLIER',
      }),
    );

    const createArg = prisma.supplier.create.mock.calls[0][0];
    expect(createArg.data.contactId).toBe('contact-123');
  });

  it('passes null taxId/phone to the resolver when absent', async () => {
    await service.create({ name: 'No-Tax Vendor' } as never);

    expect(contactResolver.findOrCreateByNaturalKey).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        name: 'No-Tax Vendor',
        taxId: null,
        phone: null,
        nationalIdHash: null,
        role: 'SUPPLIER',
      }),
    );
  });

  it('runs resolve + create inside a single $transaction', async () => {
    await service.create({ name: 'ACME Co', taxId: '0105500000001' } as never);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
