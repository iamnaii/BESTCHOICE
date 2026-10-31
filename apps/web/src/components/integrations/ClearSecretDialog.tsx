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

/**
 * First paragraph: what stops — and what keeps working — when this field is cleared.
 * Each case below was checked against the API code (Task 32 review I2/M1); every other
 * field gets a neutral sentence that does not claim more than "features using it stop".
 * Readers that bypass the Hub and read env directly are listed in `.claude/rules/security.md`.
 */
export function clearImpactText(target: ClearSecretTarget): string {
  const { integrationKey, integrationName, fieldKey, fieldLabel } = target;
  // Mockup B2 (owner-approved). Bot + inbox + notifications all send with this token (getValue).
  if (integrationKey === 'line-finance' && fieldKey === 'channelToken') {
    return `${integrationName} จะใช้งานไม่ได้จนกว่าจะบันทึกค่าใหม่ — น้องเบสส่งข้อความหาลูกค้าไม่ได้ ทั้งบอทและพนักงานที่ตอบจากอินบ็อกซ์`;
  }
  // The secret only verifies inbound webhooks (line-webhook / line-finance / line-staff guards:
  // 401 in production when missing); outbound sends use the Channel Access Token.
  if (integrationKey.startsWith('line-') && fieldKey === 'channelSecret') {
    return `${integrationName} จะรับข้อความที่ส่งเข้ามาไม่ได้ — ระบบจริงปฏิเสธ webhook จาก LINE ทุกครั้งจนกว่าจะบันทึกค่าใหม่ ส่วนการส่งข้อความออกยังทำงาน`;
  }
  switch (`${integrationKey}.${fieldKey}`) {
    // Only the GET subscribe handshake reads it (facebook-webhook.controller verifyWebhook).
    case 'facebook.verifyToken':
      return 'Facebook Messenger ยังรับส่งข้อความต่อได้ — Verify Token ใช้เฉพาะตอนยืนยัน webhook กับ Facebook (สมัครครั้งแรกหรือสมัครใหม่) ถ้าต้องยืนยันใหม่ต้องบันทึกค่าใหม่ก่อน · การ์ดจะขึ้น “ยังไม่ตั้งค่า” เพราะช่องนี้จำเป็น';
    // yeastar-webhook.controller: no secret ⇒ 401 in production (call-status popup gone);
    // yeastar-cdr.cron still pulls call records every 15 min with the API credentials.
    case 'yeastar.webhookSecret':
      return 'ระบบจริงจะปฏิเสธ webhook ของ Yeastar ทุกครั้งจนกว่าจะบันทึกค่าใหม่ — หน้าต่างสายเรียกเข้าจะไม่ขึ้นให้พนักงาน ส่วนประวัติการโทรยังเข้ามาทางรอบดึงข้อมูลทุก 15 นาที';
    // Hub readers: finance-ai, vision (slips), ocr, credit-check AI, line-oa legacy chatbot.
    // Env ANTHROPIC_API_KEY readers keep going: sales-bot ClaudeProvider, after-hours,
    // ai-text (staff inbox assistant), staff-chat sales-state, chat-history knowledge extractor.
    case 'claude-ai.apiKey':
      return 'ฟีเจอร์ที่ใช้คีย์จากหน้านี้จะหยุด: บอทน้องเบส · อ่านสลิป · อ่านเอกสาร (OCR) · วิเคราะห์เครดิตด้วย AI · บอทตอบแชท LINE SHOP แบบเดิม — แต่บอทขายในอินบ็อกซ์ · ข้อความตอบนอกเวลาทำการ · ผู้ช่วย AI ของพนักงานในอินบ็อกซ์ · การดึงคลังคำตอบจากแชทเก่า ยังใช้ ANTHROPIC_API_KEY ของเซิร์ฟเวอร์ต่อไปจนกว่าผู้ดูแลระบบจะเอาออก';
    // EmailService (Hub) sends every email today: password reset, invites, weekly PDF report.
    // notifications/email-provider (env SMTP_PASS) has no caller yet.
    case 'email.pass':
      return 'อีเมลที่ระบบส่งจะหยุดจนกว่าจะบันทึกค่าใหม่ — ลิงก์รีเซ็ตรหัสผ่าน อีเมลเชิญผู้ใช้ และรายงานติดตามหนี้รายสัปดาห์ (PDF)';
    default:
      return `ฟีเจอร์ที่ใช้ ${fieldLabel} ของ ${integrationName} จะหยุดจนกว่าจะบันทึกค่าใหม่`;
  }
}

/** Where a lost value is copied from again — LINE OAs only; elsewhere the copy stays generic. */
function valueSource(integrationKey: string): string | null {
  return integrationKey.startsWith('line-') ? 'LINE Developers Console' : null;
}

export interface ClearSecretTarget {
  integrationKey: string;
  integrationName: string;
  fieldKey: string;
  fieldLabel: string;
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
                    <p>{clearImpactText(target)}</p>
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
