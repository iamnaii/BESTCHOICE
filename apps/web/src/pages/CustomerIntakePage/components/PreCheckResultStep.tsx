import { Button } from '@/components/ui/button';
import CustomerTierBadge from '@/components/customer/CustomerTierBadge';
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import type { PreCheckResponse } from '@/lib/api/customer-precheck';

interface Props {
  result: PreCheckResponse;
  onProceed: () => void;
  onCancel: () => void;
}

export default function PreCheckResultStep({ result, onProceed, onCancel }: Props) {
  const Icon =
    result.decision === 'PASS' ? CheckCircle2 : result.decision === 'FAIL' ? XCircle : AlertTriangle;
  const tone =
    result.decision === 'PASS'
      ? 'text-success'
      : result.decision === 'FAIL'
        ? 'text-destructive'
        : 'text-warning';
  const title =
    result.decision === 'PASS'
      ? 'ผ่านการตรวจเครดิตเบื้องต้น'
      : result.decision === 'FAIL'
        ? 'ไม่ผ่านการตรวจเครดิต'
        : 'ต้องให้ผู้จัดการตรวจเพิ่ม';

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
        <div className="flex items-start gap-4">
          <Icon className={`size-10 ${tone} shrink-0`} />
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className={`text-lg font-semibold ${tone}`}>{title}</h3>
              <CustomerTierBadge tier={result.tier} size="md" />
            </div>
            <p className="text-sm text-muted-foreground">
              {result.isNewCustomer ? 'ลูกค้าใหม่ในระบบ' : 'พบลูกค้าเดิม'}
              {result.aiScore !== undefined && ` · คะแนน AI: ${result.aiScore}/100`}
            </p>
          </div>
        </div>

        <div className="border-t border-border pt-3">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            เหตุผล
          </h4>
          <ul className="space-y-1.5">
            {result.reasons.map((r, i) => (
              <li key={i} className="text-sm text-foreground flex items-start gap-2">
                <span className="text-muted-foreground mt-0.5">•</span>
                {r.message}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onCancel}>
          กลับ
        </Button>
        {result.decision !== 'FAIL' && (
          <Button variant="primary" size="lg" onClick={onProceed}>
            {result.decision === 'PASS' ? 'กรอกข้อมูลเต็ม' : 'ส่งให้ผู้จัดการ + กรอกข้อมูลเต็ม'}
          </Button>
        )}
        {result.decision === 'FAIL' && (
          <Button variant="outline" onClick={onCancel}>
            เริ่มใหม่
          </Button>
        )}
      </div>
    </div>
  );
}
