import { Eraser, Loader2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/**
 * Task 32 — "ล้างค่า" confirmation for one stored secret in the Integration Hub edit dialog
 * (mockup row B, board B2, owner-approved). Clearing is immediate on the API
 * (`DELETE /integrations/:key/config/:field`) and cannot be undone — the value has to be
 * re-entered — so this is an AlertDialog: focus starts on "ไม่ล้าง" (Radix focuses Cancel),
 * Esc = ไม่ล้าง, the destructive button sits on the opposite side.
 */

/** What stops working, per integration + field — only where it was verified (LINE FINANCE token = the mockup copy). */
const CLEAR_IMPACT: Record<string, string> = {
  'line-finance.channelToken':
    'น้องเบสส่งข้อความหาลูกค้าไม่ได้ ทั้งบอทและพนักงานที่ตอบจากอินบ็อกซ์',
};

/** Where a lost value is copied from again — LINE OAs only; elsewhere the copy stays generic. */
function valueSource(integrationKey: string): string | null {
  return integrationKey.startsWith('line-') ? 'LINE Developers Console' : null;
}

export interface ClearSecretTarget {
  integrationKey: string;
  integrationName: string;
  fieldKey: string;
  fieldLabel: string;
  required: boolean;
}

export function ClearSecretDialog({
  target,
  pending,
  onCancel,
  onConfirm,
}: {
  /** null = closed */
  target: ClearSecretTarget | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const impact = target ? CLEAR_IMPACT[`${target.integrationKey}.${target.fieldKey}`] : undefined;
  const source = target ? valueSource(target.integrationKey) : null;

  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onCancel();
      }}
    >
      <AlertDialogContent className="max-w-[480px] gap-5 rounded-xl">
        {target && (
          <>
            <div className="flex items-start gap-3.5">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <TriangleAlert className="size-5" aria-hidden="true" />
              </div>
              <div className="flex flex-col gap-2">
                <AlertDialogTitle className="text-base leading-snug">
                  ล้างค่า {target.fieldLabel}?
                </AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="flex flex-col gap-2 text-sm leading-snug text-muted-foreground">
                    <p>
                      {target.required
                        ? `${target.integrationName} จะใช้งานไม่ได้จนกว่าจะบันทึกค่าใหม่`
                        : `ระบบจะถือว่ายังไม่ได้ตั้งค่า ${target.fieldLabel} จนกว่าจะบันทึกค่าใหม่`}
                      {impact ? ` — ${impact}` : ''}
                    </p>
                    <p className="text-foreground">
                      <strong className="font-semibold">ล้างทันทีที่กด และย้อนกลับไม่ได้</strong>
                      {source
                        ? ` — ถ้าล้างผิด ต้องคัดลอกค่าใหม่จาก ${source} มากรอกเอง`
                        : ' — ถ้าล้างผิด ต้องนำค่าใหม่มากรอกเอง'}
                    </p>
                    <p>
                      ถ้าแค่จะเปลี่ยนเป็นค่าใหม่ ไม่ต้องล้าง —
                      กรอกค่าใหม่ทับในช่องแล้วกดบันทึกได้เลย
                    </p>
                  </div>
                </AlertDialogDescription>
              </div>
            </div>
            <AlertDialogFooter className="gap-2 border-t border-border pt-4 sm:justify-between">
              {/* Not AlertDialogAction — the dialog closes itself only after the API succeeded
                  (an error keeps it open with the API message in a toast). */}
              <Button
                type="button"
                variant="destructive"
                onClick={onConfirm}
                disabled={pending}
                aria-busy={pending}
              >
                {pending ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <Eraser aria-hidden="true" />
                )}
                ล้างค่า
              </Button>
              <AlertDialogCancel disabled={pending}>ไม่ล้าง</AlertDialogCancel>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
