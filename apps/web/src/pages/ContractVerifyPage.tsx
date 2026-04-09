import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatDateMedium } from '@/utils/formatters';

interface VerifyResponse {
  verified: boolean;
  reason: string;
  contract: {
    contractNumber: string;
    status: string;
    workflowStatus: string;
    customerName: string;
    branchName: string;
    createdAt: string;
    totalMonths: number;
    monthlyPayment: number;
  };
  signatures: { type: string; name: string; signedAt: string }[];
  hash: string;
}

export default function ContractVerifyPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const hash = searchParams.get('hash') || '';

  const { data, isLoading: loading, error: queryError } = useQuery({
    queryKey: ['contract-verify', id, hash],
    queryFn: async () => {
      const res = await api.get(`/contracts/${id}/verify`, { params: { hash } });
      return res.data as VerifyResponse;
    },
    enabled: !!id,
    retry: false,
  });

  const error = queryError ? 'ไม่สามารถตรวจสอบสัญญาได้ กรุณาลองใหม่' : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-[480px]">
        {/* Logo */}
        <div className="flex items-center gap-2.5 mb-8 justify-center">
          <div className="size-9 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-white font-bold text-sm">B</span>
          </div>
          <span className="text-xl font-bold text-foreground tracking-tight">
            BEST<span className="text-primary">CHOICE</span>
          </span>
        </div>

        <div className="bg-card rounded-xl shadow-sm border border-border/50 p-6">
          {loading && (
            <div className="flex flex-col items-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
              <p className="mt-3 text-sm text-muted-foreground">กำลังตรวจสอบสัญญา...</p>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center py-8 text-center">
              <div className="size-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-4">
                <svg className="size-6 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-1">เกิดข้อผิดพลาด</h2>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          )}

          {data && !loading && !queryError && (
            <>
              {data.verified ? (
                <div className="flex flex-col items-center text-center mb-5">
                  <div className="size-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-3">
                    <svg className="size-6 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h2 className="text-lg font-semibold text-green-700 dark:text-green-400">สัญญาถูกต้อง</h2>
                  <p className="text-sm text-muted-foreground mt-1">{data.reason}</p>
                </div>
              ) : (
                <div className="flex flex-col items-center text-center mb-5">
                  <div className="size-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-3">
                    <svg className="size-6 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </div>
                  <h2 className="text-lg font-semibold text-red-700 dark:text-red-400">ไม่สามารถยืนยันสัญญา</h2>
                  <p className="text-sm text-muted-foreground mt-1">{data.reason}</p>
                </div>
              )}

              {/* Contract details */}
              {data.contract && (
                <div className="space-y-3 border-t border-border pt-4">
                  <h3 className="text-sm font-medium text-foreground">รายละเอียดสัญญา</h3>
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">เลขสัญญา</dt>
                      <dd className="font-medium text-foreground">{data.contract.contractNumber}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">สถานะ</dt>
                      <dd className="font-medium text-foreground">{data.contract.status}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">ลูกค้า</dt>
                      <dd className="font-medium text-foreground">{data.contract.customerName}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">สาขา</dt>
                      <dd className="font-medium text-foreground">{data.contract.branchName}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">จำนวนงวด</dt>
                      <dd className="font-medium text-foreground">{data.contract.totalMonths} เดือน</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">ค่างวด/เดือน</dt>
                      <dd className="font-medium text-foreground">
                        {data.contract.monthlyPayment?.toLocaleString('th-TH')} บาท
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">วันที่สร้าง</dt>
                      <dd className="font-medium text-foreground">
                        {formatDateMedium(data.contract.createdAt)}
                      </dd>
                    </div>
                  </dl>
                </div>
              )}

              {/* Signatures */}
              {data.signatures && data.signatures.length > 0 && (
                <div className="space-y-3 border-t border-border pt-4 mt-4">
                  <h3 className="text-sm font-medium text-foreground">ลายเซ็น</h3>
                  <div className="space-y-2">
                    {data.signatures.map((sig, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <div>
                          <span className="text-muted-foreground">{sig.type}</span>
                          <span className="mx-1.5 text-muted-foreground/50">-</span>
                          <span className="font-medium text-foreground">{sig.name}</span>
                        </div>
                        <span className="text-muted-foreground text-xs">
                          {formatDateMedium(sig.signedAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Hash */}
              {data.hash && (
                <div className="border-t border-border pt-4 mt-4">
                  <h3 className="text-sm font-medium text-foreground mb-2">Hash</h3>
                  <p className="text-xs font-mono text-muted-foreground bg-muted/50 rounded px-2 py-1.5 break-all">
                    {data.hash}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
