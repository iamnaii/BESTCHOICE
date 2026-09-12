export type Company = 'SHOP' | 'FINANCE';
export const WORK_COMPANY = { shop: 'SHOP', fin: 'FINANCE' } as const;

// Installed by LayoutProvider before company-specific pages mount.
let requestCompany: Company | undefined;
let scopeRevision = 0;
export function getCompanyScopeRevision() { return scopeRevision; }
export function getRequestCompany() { return requestCompany; }
export function setRequestCompany(company: Company | undefined) {
  if (requestCompany !== company) scopeRevision++;
  requestCompany = company;
  try {
    if (company) localStorage.setItem('bc-entity-scope', company);
    else localStorage.removeItem('bc-entity-scope');
  } catch { /* The in-memory scope also works without localStorage. */ }
}
