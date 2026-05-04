/**
 * T16: Tolerance Approval Dialog
 *
 * Shown when the cashier enters an amount that differs from the outstanding balance
 * by 0.01–1.00 ฿ (rounding tolerance zone). An OWNER, ACCOUNTANT, or BRANCH_MANAGER
 * must confirm before the payment is submitted. The approver's id is sent to the API
 * which validates the role server-side and writes a TOLERANCE_APPROVED AuditLog row.
 */
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/AuthContext';

const APPROVER_ROLES = ['OWNER', 'ACCOUNTANT', 'BRANCH_MANAGER'];

interface ToleranceApprovalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Positive = overpay, negative = underpay */
  diff: number;
  amountReceived: number;
  outstanding: number;
  onApprove: (approverId: string) => void;
  onCancel: () => void;
}

export function ToleranceApprovalDialog({
  open,
  onOpenChange,
  diff,
  amountReceived,
  outstanding,
  onApprove,
  onCancel,
}: ToleranceApprovalDialogProps) {
  const { user } = useAuth();
  const canApprove = user != null && APPROVER_ROLES.includes(user.role);
  const isOverpay = diff > 0;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>ยืนยันการอนุมัติส่วนต่าง</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">ยอดคงค้าง</span>
                <span className="font-mono">{outstanding.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">รับเงินจริง</span>
                <span className="font-mono">{amountReceived.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿</span>
              </div>
              <div className="flex justify-between border-t border-border pt-2 font-medium">
                <span className={isOverpay ? 'text-foreground' : 'text-destructive'}>
                  {isOverpay ? 'รับเกิน (53-1503 รายได้ปัดเศษ)' : 'รับขาด (52-1104 ปัดเศษ)'}
                </span>
                <span className="font-mono">{Math.abs(diff).toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿</span>
              </div>
              {!canApprove && (
                <p className="text-destructive text-xs pt-1">
                  คุณไม่มีสิทธิ์อนุมัติส่วนต่าง — ต้องเป็น OWNER, ACCOUNTANT หรือ BRANCH_MANAGER
                </p>
              )}
              {canApprove && (
                <p className="text-muted-foreground text-xs pt-1">
                  อนุมัติโดย: <span className="font-medium text-foreground">{user?.name}</span> ({user?.role})
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>ยกเลิก</AlertDialogCancel>
          <AlertDialogAction
            disabled={!canApprove}
            onClick={() => {
              if (canApprove && user) {
                onApprove(user.id);
              }
            }}
          >
            อนุมัติ
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
