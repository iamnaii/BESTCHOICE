import { useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { STATUS_LABELS } from '@installment/shared';
import { Button } from '@/components/ui/button';
import { formatDateMedium } from '@/utils/formatters';

type VerifyResponse = {
  verified: boolean;
  reason: string;
  contract?: { contractNumber: string; status: string; createdAt: string };
  signatureCount?: number;
};

export default function ContractVerifyPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const hash = searchParams.get('hash') || '';

  const {
    data,
    isLoading: loading,
    error: queryError,
    refetch,
    isFetching,
  } = useQuery({
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
    <div className="app-shell flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-[480px]">
        {/* Logo */}
        <div className="flex items-center gap-2.5 mb-8 justify-center">
          <div className="size-9 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-sm">B</span>
          </div>
          <span className="text-xl font-bold text-foreground tracking-tight">
            BEST<span className="text-primary">CHOICE</span>
          </span>
        </div>

        <div className="bg-card rounded-xl shadow-sm border border-border/50 p-6">
          {loading && (
            <div className="flex flex-col items-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              <p className="mt-3 text-sm text-muted-foreground">กำลังตรวจสอบสัญญา...</p>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center py-8 text-center">
              <div className="size-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
                <svg
                  className="size-6 text-destructive"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-1">เกิดข้อผิดพลาด</h2>
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button
                className="mt-4"
                variant="outline"
                disabled={isFetching}
                onClick={() => refetch()}
              >
                ลองใหม่
              </Button>
            </div>
          )}

          {data && !loading && !queryError && (
            <>
              {data.verified ? (
                <div className="flex flex-col items-center text-center mb-5">
                  <div className="size-12 rounded-full bg-success/10 flex items-center justify-center mb-3">
                    <svg
                      className="size-6 text-success"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h2 className="text-lg font-semibold text-success">สัญญาถูกต้อง</h2>
                  <p className="text-sm text-muted-foreground mt-1">{data.reason}</p>
                </div>
              ) : (
                <div className="flex flex-col items-center text-center mb-5">
                  <div className="size-12 rounded-full bg-destructive/10 flex items-center justify-center mb-3">
                    <svg
                      className="size-6 text-destructive"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </div>
                  <h2 className="text-lg font-semibold text-destructive">ไม่สามารถยืนยันสัญญา</h2>
                  <p className="text-sm text-muted-foreground mt-1">{data.reason}</p>
                </div>
              )}

              {/* Contract details */}
              {data.contract && (
                <div className="space-y-3 border-t border-border pt-4">
                  <h3 className="text-sm font-medium text-foreground">รายละเอียดสัญญา</h3>
                  <dl className="space-y-2 text-sm">
                    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-4">
                      <dt className="text-muted-foreground">เลขสัญญา</dt>
                      <dd className="min-w-0 break-words text-right font-medium text-foreground">
                        {data.contract.contractNumber}
                      </dd>
                    </div>
                    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-4">
                      <dt className="text-muted-foreground">สถานะ</dt>
                      <dd className="min-w-0 break-words text-right font-medium text-foreground">
                        {STATUS_LABELS.contract[
                          data.contract.status as keyof typeof STATUS_LABELS.contract
                        ] ?? data.contract.status}
                      </dd>
                    </div>
                    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-4">
                      <dt className="text-muted-foreground">วันที่สร้าง</dt>
                      <dd className="min-w-0 break-words text-right font-medium text-foreground">
                        {formatDateMedium(data.contract.createdAt)}
                      </dd>
                    </div>
                  </dl>
                </div>
              )}

              {data.verified && data.signatureCount !== undefined && (
                <p className="border-t border-border pt-4 mt-4 text-sm text-muted-foreground">
                  ลายเซ็นในระบบ {data.signatureCount} รายการ
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
