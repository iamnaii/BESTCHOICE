import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

/**
 * ผู้จ่ายเงินได้บนหนังสือรับรองการหักภาษี ณ ที่จ่าย (ม.50 ทวิ) ทุกฉบับ — ภ.ง.ด.1ก ของ
 * พนักงาน และ ภ.ง.ด.2 ของผู้ถือหุ้น — คือนิติบุคคลจดทะเบียน (FINANCE CompanyInfo) เท่านั้น.
 *
 * ไม่มีบริษัทฝั่ง FINANCE = ออกใบไม่ได้ ห้ามหยิบบริษัทแรกในรายการ (SHOP) มาแทนโดยเงียบ
 * (DOC-04 #1563 / DOC-08 #1567: ทั้งสองหน้าเคยเรียก `/company` ซึ่งไม่มี route จึงไม่เคยหาผู้จ่ายเจอ).
 */
export interface CertificatePayer {
  id: string;
  nameTh: string;
  taxId: string;
  address: string;
  directorName: string;
  companyCode: string | null;
}

/** `GET /companies` — the registered-entity list (director name included; ACCOUNTANT and up). */
export const CERTIFICATE_PAYER_ENDPOINT = '/companies';

export function resolveCertificatePayer(rows: CertificatePayer[] | null | undefined): CertificatePayer | null {
  return rows?.find((c) => c.companyCode === 'FINANCE') ?? null;
}

export interface CertificatePayerQuery {
  payer: CertificatePayer | null;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

export function useCertificatePayer(): CertificatePayerQuery {
  const companies = useQuery({
    queryKey: ['company-info-list'],
    queryFn: () => api.get<CertificatePayer[]>(CERTIFICATE_PAYER_ENDPOINT).then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });
  return { payer: resolveCertificatePayer(companies.data), isPending: companies.isPending, isError: companies.isError, error: companies.error, refetch: companies.refetch };
}
