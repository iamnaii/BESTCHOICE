import { ROLE_ACCESS_MAP } from './backfill-user-companies.cli';

describe('Backfill user companies — role mapping policy', () => {
  it('OWNER has both companies, primary SHOP', () => {
    expect(ROLE_ACCESS_MAP.OWNER).toEqual({ accessible: ['SHOP', 'FINANCE'], primary: 'SHOP' });
  });

  it('ACCOUNTANT has both companies, primary FINANCE', () => {
    expect(ROLE_ACCESS_MAP.ACCOUNTANT).toEqual({ accessible: ['SHOP', 'FINANCE'], primary: 'FINANCE' });
  });

  it('FINANCE_MANAGER has only FINANCE', () => {
    expect(ROLE_ACCESS_MAP.FINANCE_MANAGER.accessible).toEqual(['FINANCE']);
  });

  it('SALES has only SHOP', () => {
    expect(ROLE_ACCESS_MAP.SALES.accessible).toEqual(['SHOP']);
  });

  it('BRANCH_MANAGER has only SHOP', () => {
    expect(ROLE_ACCESS_MAP.BRANCH_MANAGER.accessible).toEqual(['SHOP']);
  });
});
