import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

/**
 * D1.2.2.* — Public-safe CompanyInfo for voucher/receipt branding.
 *
 * Reads via the authenticated-but-all-roles endpoint `GET /companies/public`.
 * Returns SHOP and FINANCE entities (the two-entity structure documented in
 * CLAUDE.md: SHOP = retail, FINANCE = installment). Voucher headers can pick
 * either, or both for combined documents.
 *
 * Default fallback used during the first fetch (or on error) is the project's
 * pre-D1 hardcoded "BESTCHOICE FINANCE × SHOP" header so existing print jobs
 * never produce a blank header.
 */
export interface PublicCompanyInfo {
  id: string;
  nameTh: string;
  nameEn: string | null;
  taxId: string;
  companyCode: string | null;
  address: string;
  phone: string | null;
  logoUrl: string | null;
}

export interface CompanyInfoBundle {
  shop: PublicCompanyInfo | null;
  finance: PublicCompanyInfo | null;
}

const DEFAULT_COMPANY_INFO: CompanyInfoBundle = { shop: null, finance: null };

export function useCompanyInfo(): CompanyInfoBundle {
  const { data } = useQuery<CompanyInfoBundle>({
    queryKey: ['company-info-public'],
    queryFn: async () => {
      const { data } = await api.get<CompanyInfoBundle>('/companies/public');
      return data;
    },
    staleTime: 15 * 60_000, // 15 min — branding rarely changes mid-session
  });
  return data ?? DEFAULT_COMPANY_INFO;
}

/**
 * D1.2.2.1 — combined name string for the voucher `<h1>` header. Renders
 * the canonical "FINANCE × SHOP" pattern when both companies are configured,
 * single name when only one, or the legacy literal as last-resort fallback
 * so we never print a blank header.
 */
export function useCompanyDisplayName(): string {
  const { shop, finance } = useCompanyInfo();
  if (finance && shop) return `${finance.nameTh} × ${shop.nameTh}`;
  if (finance) return finance.nameTh;
  if (shop) return shop.nameTh;
  return 'BESTCHOICE FINANCE × SHOP';
}

/**
 * D1.2.2.2 — single address string for the voucher sub-header.
 * Prefers FINANCE (primary entity for accounting docs) then SHOP, then a
 * legacy placeholder so first-render never prints blank.
 */
export function useCompanyAddress(): string {
  const { shop, finance } = useCompanyInfo();
  return finance?.address ?? shop?.address ?? 'เลขประจำตัวผู้เสียภาษี · สำนักงานใหญ่';
}
