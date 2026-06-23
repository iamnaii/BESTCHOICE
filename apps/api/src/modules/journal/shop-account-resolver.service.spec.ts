import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ShopAccountResolver } from './shop-account-resolver.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ShopAccountResolver', () => {
  let resolver: ShopAccountResolver;
  let prisma: any;

  beforeEach(async () => {
    prisma = { branch: { findUnique: jest.fn() } };
    const mod = await Test.createTestingModule({
      providers: [ShopAccountResolver, { provide: PrismaService, useValue: prisma }],
    }).compile();
    resolver = mod.get(ShopAccountResolver);
  });

  it('maps PHONE_NEW + TABLET to the new-phone S-codes', () => {
    const expected = { inventoryAccountCode: 'S11-2001', cogsAccountCode: 'S50-1101', revenueAccountCode: 'S41-1101' };
    expect(resolver.resolveProductAccounts('PHONE_NEW')).toEqual(expected);
    expect(resolver.resolveProductAccounts('TABLET')).toEqual(expected);
  });

  it('maps PHONE_USED and ACCESSORY to their S-codes', () => {
    expect(resolver.resolveProductAccounts('PHONE_USED')).toEqual({ inventoryAccountCode: 'S11-2002', cogsAccountCode: 'S50-1102', revenueAccountCode: 'S41-1102' });
    expect(resolver.resolveProductAccounts('ACCESSORY')).toEqual({ inventoryAccountCode: 'S11-2003', cogsAccountCode: 'S50-1103', revenueAccountCode: 'S41-1103' });
  });

  it('resolves a configured branch cash account', async () => {
    prisma.branch.findUnique.mockResolvedValue({ shopCashAccountCode: 'S11-1102' });
    await expect(resolver.resolveBranchCashAccount('br-1')).resolves.toBe('S11-1102');
  });

  it('fail-closed: throws when branch has no shopCashAccountCode', async () => {
    prisma.branch.findUnique.mockResolvedValue({ shopCashAccountCode: null });
    await expect(resolver.resolveBranchCashAccount('br-1')).rejects.toThrow(BadRequestException);
  });

  it('resolveInflowCashAccount: CASH → the branch till', async () => {
    prisma.branch.findUnique.mockResolvedValue({ shopCashAccountCode: 'S11-1102' });
    await expect(resolver.resolveInflowCashAccount('br-1', 'CASH')).resolves.toBe('S11-1102');
  });

  it('resolveInflowCashAccount: non-CASH (transfer/QR) → the receiving bank S11-1201', async () => {
    await expect(resolver.resolveInflowCashAccount('br-1', 'BANK_TRANSFER')).resolves.toBe('S11-1201');
    await expect(resolver.resolveInflowCashAccount('br-1', 'QR_EWALLET')).resolves.toBe('S11-1201');
    expect(prisma.branch.findUnique).not.toHaveBeenCalled();
  });

  it('resolveInflowCashAccount: non-CASH methods (CREDIT_BALANCE, ONLINE_GATEWAY) → S11-1201', async () => {
    await expect(resolver.resolveInflowCashAccount('br-1', 'CREDIT_BALANCE')).resolves.toBe('S11-1201');
    await expect(resolver.resolveInflowCashAccount('br-1', 'ONLINE_GATEWAY')).resolves.toBe('S11-1201');
    expect(prisma.branch.findUnique).not.toHaveBeenCalled();
  });

  it('resolveOutflowCashAccount: CASH → the branch till', async () => {
    prisma.branch.findUnique.mockResolvedValue({ shopCashAccountCode: 'S11-1102' });
    await expect(resolver.resolveOutflowCashAccount('br-1', 'CASH')).resolves.toBe('S11-1102');
  });

  it('resolveOutflowCashAccount: TRANSFER / null → the paying bank S11-1202', async () => {
    await expect(resolver.resolveOutflowCashAccount('br-1', 'TRANSFER')).resolves.toBe('S11-1202');
    await expect(resolver.resolveOutflowCashAccount('br-1', null)).resolves.toBe('S11-1202');
    expect(prisma.branch.findUnique).not.toHaveBeenCalled();
  });
});
