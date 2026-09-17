import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ContactResolverService } from '../contact-resolver.service';
import { CustomerPiiService } from '../../customers/customer-pii.service';
import { hashPII } from '../../../utils/pii.util';
import { decryptPII } from '../../../utils/crypto.util';

const PII_KEY = 'd'.repeat(64);
const PII_SALT = 'ensure-role-spec-salt-0123456789abcdef';

describe('ContactResolverService.ensureRole', () => {
  let svc: ContactResolverService;
  let tx: {
    contact: { findFirst: jest.Mock; update: jest.Mock };
    supplier: { findFirst: jest.Mock; create: jest.Mock };
    customer: { findFirst: jest.Mock; create: jest.Mock };
  };

  beforeEach(async () => {
    tx = {
      contact: { findFirst: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      supplier: { findFirst: jest.fn(), create: jest.fn() },
      customer: { findFirst: jest.fn(), create: jest.fn() },
    };
    const mod = await Test.createTestingModule({
      providers: [
        ContactResolverService,
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();
    svc = mod.get(ContactResolverService);
  });

  it('returns the existing supplier id without creating (idempotent)', async () => {
    tx.contact.findFirst.mockResolvedValue({
      id: 'c1', name: 'ABC', phone: '0812345678', roles: ['SUPPLIER'],
    });
    tx.supplier.findFirst.mockResolvedValue({ id: 'sup1' });

    const result = await svc.ensureRole(tx as any, 'c1', 'SUPPLIER');

    expect(result).toEqual({
      contactId: 'c1', role: 'SUPPLIER', supplierId: 'sup1', provisioned: false,
    });
    expect(tx.supplier.create).not.toHaveBeenCalled();
    expect(tx.contact.update).not.toHaveBeenCalled();
  });

  it('creates a Supplier with blank-phone fallback and adds the role', async () => {
    tx.contact.findFirst.mockResolvedValue({
      id: 'c2', name: 'NoPhone Co', phone: null, roles: ['CUSTOMER'],
    });
    tx.supplier.findFirst.mockResolvedValue(null);
    tx.supplier.create.mockResolvedValue({ id: 'sup2' });

    const result = await svc.ensureRole(tx as any, 'c2', 'SUPPLIER');

    expect(tx.supplier.create).toHaveBeenCalledWith({
      data: { name: 'NoPhone Co', phone: '', contactId: 'c2' },
      select: { id: true },
    });
    expect(tx.contact.update).toHaveBeenCalledWith({
      where: { id: 'c2' },
      data: { roles: { set: ['CUSTOMER', 'SUPPLIER'] } },
    });
    expect(result).toEqual({
      contactId: 'c2', role: 'SUPPLIER', supplierId: 'sup2', provisioned: true,
    });
  });

  it('adds the role when a supplier row already exists but role is missing', async () => {
    tx.contact.findFirst.mockResolvedValue({
      id: 'c3', name: 'ABC', phone: '02', roles: ['CUSTOMER'],
    });
    tx.supplier.findFirst.mockResolvedValue({ id: 'sup3' });

    const result = await svc.ensureRole(tx as any, 'c3', 'SUPPLIER');

    expect(tx.supplier.create).not.toHaveBeenCalled();
    expect(tx.contact.update).toHaveBeenCalledWith({
      where: { id: 'c3' },
      data: { roles: { set: ['CUSTOMER', 'SUPPLIER'] } },
    });
    expect(result.provisioned).toBe(true);
    expect(result.supplierId).toBe('sup3');
  });

  it('throws NotFound when the contact does not exist', async () => {
    tx.contact.findFirst.mockResolvedValue(null);
    await expect(svc.ensureRole(tx as any, 'missing', 'SUPPLIER')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('treats a soft-deleted supplier as absent (deletedAt: null filter) and provisions fresh', async () => {
    tx.contact.findFirst.mockResolvedValue({
      id: 'c4', name: 'Revived Co', phone: '03', roles: ['CUSTOMER'],
    });
    // soft-deleted supplier is filtered out by deletedAt: null -> findFirst returns null
    tx.supplier.findFirst.mockResolvedValue(null);
    tx.supplier.create.mockResolvedValue({ id: 'sup4' });

    const result = await svc.ensureRole(tx as any, 'c4', 'SUPPLIER');

    expect(tx.supplier.create).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      contactId: 'c4', role: 'SUPPLIER', supplierId: 'sup4', provisioned: true,
    });
  });

  it('provisions a Customer with blank-phone fallback and adds the CUSTOMER role', async () => {
    tx.contact.findFirst.mockResolvedValue({
      id: 'c5', name: 'Walkin Co', phone: null, roles: ['SUPPLIER'],
    });
    tx.customer.findFirst.mockResolvedValue(null);
    tx.customer.create.mockResolvedValue({ id: 'cus5' });

    const result = await svc.ensureRole(tx as any, 'c5', 'CUSTOMER');

    expect(tx.customer.create).toHaveBeenCalledWith({
      data: { name: 'Walkin Co', phone: '', contactId: 'c5' },
      select: { id: true },
    });
    expect(tx.contact.update).toHaveBeenCalledWith({
      where: { id: 'c5' },
      data: { roles: { set: ['SUPPLIER', 'CUSTOMER'] } },
    });
    expect(result).toEqual({
      contactId: 'c5', role: 'CUSTOMER', customerId: 'cus5', provisioned: true,
    });
    expect(tx.supplier.create).not.toHaveBeenCalled();
  });

  describe('CUSTOMER stub ที่มีเบอร์ — normalize + hash + เข้ารหัส', () => {
    const saved = { key: process.env.PII_ENCRYPTION_KEY, salt: process.env.PII_HASH_SALT };
    beforeEach(() => {
      process.env.PII_ENCRYPTION_KEY = PII_KEY;
      process.env.PII_HASH_SALT = PII_SALT;
    });
    afterEach(() => {
      if (saved.key === undefined) delete process.env.PII_ENCRYPTION_KEY;
      else process.env.PII_ENCRYPTION_KEY = saved.key;
      if (saved.salt === undefined) delete process.env.PII_HASH_SALT;
      else process.env.PII_HASH_SALT = saved.salt;
    });

    it('เขียน phone ที่ normalize แล้ว + phoneHash + phoneEncrypted และไม่ล็อกเบอร์', async () => {
      const lockTx = { ...tx, $executeRaw: jest.fn(), $executeRawUnsafe: jest.fn() };
      lockTx.contact.findFirst.mockResolvedValue({
        id: 'c9', name: 'Seller', phone: '081-234 5678', roles: ['TRADE_IN_SELLER'],
      });
      lockTx.customer.findFirst.mockResolvedValue(null);
      lockTx.customer.create.mockResolvedValue({ id: 'cus9' });

      const result = await svc.ensureRole(lockTx as any, 'c9', 'CUSTOMER');

      const data = lockTx.customer.create.mock.calls[0][0].data;
      expect(data.name).toBe('Seller');
      expect(data.contactId).toBe('c9');
      expect(data.phone).toBe('0812345678');
      expect(data.phoneHash).toBe(hashPII('0812345678', PII_SALT));
      expect(decryptPII(data.phoneEncrypted, PII_KEY)).toBe('0812345678');
      expect(lockTx.$executeRaw).not.toHaveBeenCalled();
      expect(lockTx.$executeRawUnsafe).not.toHaveBeenCalled();
      expect(result.customerId).toBe('cus9');
    });

    it('ใช้ CustomerPiiService ที่ฉีดมา', async () => {
      const pii = {
        encryptCustomerFields: jest.fn().mockReturnValue({ phoneHash: 'H', phoneEncrypted: 'E' }),
      };
      const injected = new ContactResolverService({} as never, pii as unknown as CustomerPiiService);
      tx.contact.findFirst.mockResolvedValue({
        id: 'c10', name: 'Seller', phone: '+66812345678', roles: ['CUSTOMER'],
      });
      tx.customer.findFirst.mockResolvedValue(null);
      tx.customer.create.mockResolvedValue({ id: 'cus10' });

      await injected.ensureRole(tx as any, 'c10', 'CUSTOMER');

      expect(pii.encryptCustomerFields).toHaveBeenCalledWith({ phone: '0812345678' });
      expect(tx.customer.create).toHaveBeenCalledWith({
        data: {
          name: 'Seller', phone: '0812345678', phoneHash: 'H', phoneEncrypted: 'E', contactId: 'c10',
        },
        select: { id: true },
      });
    });
  });

  it('เบอร์ที่มีแต่ช่องว่าง/ขีด → เขียน \'\' ไม่ต้องใช้กุญแจ', async () => {
    const saved = process.env.PII_ENCRYPTION_KEY;
    delete process.env.PII_ENCRYPTION_KEY;
    try {
      tx.contact.findFirst.mockResolvedValue({
        id: 'c11', name: 'Blank', phone: ' - ', roles: ['CUSTOMER'],
      });
      tx.customer.findFirst.mockResolvedValue(null);
      tx.customer.create.mockResolvedValue({ id: 'cus11' });
      await svc.ensureRole(tx as any, 'c11', 'CUSTOMER');
      expect(tx.customer.create).toHaveBeenCalledWith({
        data: { name: 'Blank', phone: '', contactId: 'c11' },
        select: { id: true },
      });
    } finally {
      if (saved !== undefined) process.env.PII_ENCRYPTION_KEY = saved;
    }
  });

  it('returns the existing customer id without creating (idempotent)', async () => {
    tx.contact.findFirst.mockResolvedValue({
      id: 'c6', name: 'ABC', phone: '02', roles: ['CUSTOMER'],
    });
    tx.customer.findFirst.mockResolvedValue({ id: 'cus6' });

    const result = await svc.ensureRole(tx as any, 'c6', 'CUSTOMER');

    expect(tx.customer.create).not.toHaveBeenCalled();
    expect(tx.contact.update).not.toHaveBeenCalled();
    expect(result).toEqual({
      contactId: 'c6', role: 'CUSTOMER', customerId: 'cus6', provisioned: false,
    });
  });

  it('rejects a role that is not SUPPLIER, CUSTOMER, or TRADE_IN_SELLER (e.g. FINANCE_COMPANY)', async () => {
    tx.contact.findFirst.mockResolvedValue(null);
    await expect(svc.ensureRole(tx as any, 'c1', 'FINANCE_COMPANY' as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('TRADE_IN_SELLER: appends role when absent, returns { contactId, role, provisioned:true } with no child created', async () => {
    tx.contact.findFirst.mockResolvedValue({
      id: 'c7', name: 'Walk-in Seller', phone: '0899999999', roles: [],
    });

    const result = await svc.ensureRole(tx as any, 'c7', 'TRADE_IN_SELLER');

    expect(tx.supplier.create).not.toHaveBeenCalled();
    expect(tx.customer.create).not.toHaveBeenCalled();
    expect(tx.contact.update).toHaveBeenCalledWith({
      where: { id: 'c7' },
      data: { roles: { set: ['TRADE_IN_SELLER'] } },
    });
    expect(result).toEqual({ contactId: 'c7', role: 'TRADE_IN_SELLER', provisioned: true });
    expect(result).not.toHaveProperty('supplierId');
    expect(result).not.toHaveProperty('customerId');
  });

  it('TRADE_IN_SELLER idempotent: contact already has the role → no update, provisioned:false', async () => {
    tx.contact.findFirst.mockResolvedValue({
      id: 'c8', name: 'Repeat Seller', phone: '0811111111', roles: ['TRADE_IN_SELLER'],
    });

    const result = await svc.ensureRole(tx as any, 'c8', 'TRADE_IN_SELLER');

    expect(tx.supplier.create).not.toHaveBeenCalled();
    expect(tx.customer.create).not.toHaveBeenCalled();
    expect(tx.contact.update).not.toHaveBeenCalled();
    expect(result).toEqual({ contactId: 'c8', role: 'TRADE_IN_SELLER', provisioned: false });
  });
});
