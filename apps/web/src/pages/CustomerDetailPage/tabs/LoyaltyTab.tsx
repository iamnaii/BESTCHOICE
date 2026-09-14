import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import api, { getErrorMessage } from '@/lib/api';
import { toast } from 'sonner';
import { formatDateShort } from '@/utils/formatters';
import type { LoyaltyHistory, LoyaltyPoints, ReferralStats } from '../hooks/useCustomerDetailData';

interface LoyaltyTabProps {
  customerId: string | undefined;
  canEdit: boolean | null | undefined;
  loyaltyPoints: LoyaltyPoints | undefined;
  loyaltyHistory: LoyaltyHistory | undefined;
  referralStats: ReferralStats | undefined;
}

export default function LoyaltyTab({ customerId, canEdit, loyaltyPoints, loyaltyHistory, referralStats }: LoyaltyTabProps) {
  const queryClient = useQueryClient();

  const [redeemForm, setRedeemForm] = useState({ amount: '', description: '' });

  const redeemMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/loyalty/${customerId}/redeem`, {
        amount: parseInt(redeemForm.amount),
        description: redeemForm.description,
      });
      return data;
    },
    onSuccess: (result: { newBalance: number; redeemedPoints: number; discountAmount: number }) => {
      toast.success(`แลก ${result.redeemedPoints} แต้มสำเร็จ — ส่วนลด ${result.discountAmount.toLocaleString()} บาท`);
      queryClient.invalidateQueries({ queryKey: ['customer-loyalty-points', customerId] });
      queryClient.invalidateQueries({ queryKey: ['customer-loyalty-history', customerId] });
      setRedeemForm({ amount: '', description: '' });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  return (
    <>
      {/* Points Balance */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card className="rounded-xl border border-border/50 bg-card shadow-sm relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-1 rounded-r-full bg-primary" />
          <CardContent className="p-5 text-center">
            <div className="text-3xl font-bold text-primary tabular-nums">
              {loyaltyPoints?.balance?.toLocaleString() ?? 0}
            </div>
            <div className="text-xs text-muted-foreground mt-1">แต้มคงเหลือ</div>
          </CardContent>
        </Card>
        <Card className="rounded-xl border border-border/50 bg-card shadow-sm relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-1 rounded-r-full bg-success" />
          <CardContent className="p-5 text-center">
            <div className="text-2xl font-bold text-success tabular-nums">
              {loyaltyPoints?.lifetimeEarned?.toLocaleString() ?? 0}
            </div>
            <div className="text-xs text-muted-foreground mt-1">แต้มสะสมทั้งหมด</div>
          </CardContent>
        </Card>
        <Card className="rounded-xl border border-border/50 bg-card shadow-sm relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-1 rounded-r-full bg-warning" />
          <CardContent className="p-5 text-center">
            <div className="text-2xl font-bold text-warning tabular-nums">
              {loyaltyPoints?.lifetimeRedeemed?.toLocaleString() ?? 0}
            </div>
            <div className="text-xs text-muted-foreground mt-1">แต้มที่ใช้ไป</div>
          </CardContent>
        </Card>
        <Card className="rounded-xl border border-border/50 bg-card shadow-sm relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-1 rounded-r-full bg-info" />
          <CardContent className="p-5 text-center">
            <div className="text-2xl font-bold text-info tabular-nums">
              {loyaltyPoints?.referralCount?.toLocaleString() ?? 0}
            </div>
            <div className="text-xs text-muted-foreground mt-1">คนที่แนะนำ</div>
          </CardContent>
        </Card>
      </div>

      {/* Redeem points form */}
      {canEdit && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>แลกแต้ม</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground mb-3">1 แต้ม = ส่วนลด 1 บาท · แต้มหมดอายุหลัง 1 ปี</div>
            <div className="flex gap-3 flex-wrap">
              <input
                type="number"
                placeholder="จำนวนแต้ม"
                value={redeemForm.amount}
                onChange={(e) => setRedeemForm((p) => ({ ...p, amount: e.target.value }))}
                min={1}
                max={loyaltyPoints?.balance ?? 0}
                className="h-10 w-32 px-3 rounded-lg border border-input bg-background text-sm focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20"
              />
              <input
                type="text"
                placeholder="หมายเหตุ เช่น แลกลดราคาสินค้า"
                value={redeemForm.description}
                onChange={(e) => setRedeemForm((p) => ({ ...p, description: e.target.value }))}
                className="h-10 flex-1 min-w-40 px-3 rounded-lg border border-input bg-background text-sm focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20"
              />
              <button
                onClick={() => redeemMutation.mutate()}
                disabled={
                  redeemMutation.isPending ||
                  !redeemForm.amount ||
                  !redeemForm.description ||
                  parseInt(redeemForm.amount) <= 0 ||
                  parseInt(redeemForm.amount) > (loyaltyPoints?.balance ?? 0)
                }
                className="h-10 px-4 bg-primary text-primary-foreground text-sm rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {redeemMutation.isPending ? 'กำลังแลก...' : 'แลกแต้ม'}
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Point history */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>ประวัติแต้ม</CardTitle>
        </CardHeader>
        <CardContent>
          {loyaltyHistory && loyaltyHistory.data.length > 0 ? (
            <div className="space-y-2">
              {loyaltyHistory.data.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between py-2.5 border-b border-border/40 last:border-0"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`size-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                        item.type === 'EARN'
                          ? 'bg-success/10 text-success dark:bg-success/20'
                          : 'bg-warning/10 text-warning dark:bg-warning/20'
                      }`}
                    >
                      {item.type === 'EARN' ? '+' : '-'}
                    </span>
                    <div>
                      <div className="text-sm font-medium text-foreground">
                        {item.reason === 'ON_TIME_PAYMENT'
                          ? 'ชำระงวดตรงเวลา'
                          : item.reason === 'REFERRAL'
                          ? 'แนะนำลูกค้า'
                          : item.reason}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDateShort(item.createdAt)}
                      </div>
                    </div>
                  </div>
                  <span
                    className={`text-sm font-bold ${
                      item.type === 'EARN' ? 'text-success' : 'text-warning'
                    }`}
                  >
                    {item.type === 'EARN' ? '+' : '-'}
                    {item.points.toLocaleString()} แต้ม
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-sm text-muted-foreground">
              ยังไม่มีประวัติแต้ม
            </div>
          )}
        </CardContent>
      </Card>

      {/* Referral stats */}
      {referralStats && referralStats.totalReferrals > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>ลูกค้าที่แนะนำ</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground mb-3">
              แนะนำ {referralStats.totalReferrals} คน · {referralStats.referralsWithContract} คนทำสัญญาแล้ว · ได้ {referralStats.totalPointsFromReferrals.toLocaleString()} แต้มจาก referral
            </div>
            <div className="space-y-2">
              {referralStats.referrals.map((ref) => (
                <div key={ref.id} className="flex items-center justify-between py-2 border-b border-border/40 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className={`size-2 rounded-full shrink-0 ${ref.hasContract ? 'bg-success' : 'bg-muted-foreground'}`} />
                    <span className="text-sm">{ref.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {ref.hasContract ? (
                      <span className="text-2xs px-1.5 py-0.5 rounded bg-success/10 text-success font-medium">ทำสัญญาแล้ว</span>
                    ) : (
                      <span className="text-2xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">ยังไม่ทำสัญญา</span>
                    )}
                    <span className="text-xs text-muted-foreground">{formatDateShort(ref.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
