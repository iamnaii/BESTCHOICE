import api from '@/lib/api';

/** `GET /expense-documents/payroll/meta?scope=` — whitelist รายได้พิเศษ + บัญชีจ่าย + รหัสบัญชีของแถวลงเวลา (Payroll D4) */
export interface PayrollMetaResponse {
  scope: 'SHOP' | 'FINANCE';
  incomeWhitelist: { code: string; name: string }[];
  cashAccounts: { code: string; name: string }[];
  /** รหัสบัญชี OT / ทำงานวันหยุดของฝั่งนี้ — แถวที่กรอกเองด้วยรหัสเหล่านี้คือ "OT ที่กรอกเอง" */
  attendanceAccountCodes?: string[];
}

/** ใช้ทั้ง `useQuery` ของตาราง และ `fetchQuery` ตอนบันทึก (cache เดียวกัน) */
export const payrollMetaQuery = (scope: 'SHOP' | 'FINANCE') => ({
  queryKey: ['payroll-meta', scope] as const,
  queryFn: async (): Promise<PayrollMetaResponse> =>
    (await api.get(`/expense-documents/payroll/meta?scope=${scope}`)).data,
  staleTime: 5 * 60 * 1000,
});
