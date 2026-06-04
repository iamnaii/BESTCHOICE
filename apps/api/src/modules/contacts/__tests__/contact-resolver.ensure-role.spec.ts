import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ContactResolverService } from '../contact-resolver.service';

describe('ContactResolverService.ensureRole', () => {
  let svc: ContactResolverService;
  let tx: {
    contact: { findFirst: jest.Mock; update: jest.Mock };
    supplier: { findFirst: jest.Mock; create: jest.Mock };
  };

  beforeEach(async () => {
    tx = {
      contact: { findFirst: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      supplier: { findFirst: jest.fn(), create: jest.fn() },
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

  it('rejects CUSTOMER provisioning in this phase', async () => {
    tx.contact.findFirst.mockResolvedValue(null);
    await expect(svc.ensureRole(tx as any, 'c1', 'CUSTOMER' as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
