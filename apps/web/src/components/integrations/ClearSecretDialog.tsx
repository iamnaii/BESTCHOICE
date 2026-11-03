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
    // Only reader: the webhook GET handshake (facebook-webhook.controller verifyWebhook — no
    // token ⇒ 400, so Meta cannot verify the Callback URL when it is set or edited). Messenger
    // POSTs are checked with the App Secret (HMAC) and sent with the Page Access Token; the
    // page-comment transport stopped requiring it in Task 35
    // (FacebookCommentGraphTransport.credentials()).
    case 'facebook.verifyToken':
      return 'ใช้เฉพาะตอนยืนยัน webhook กับ Facebook — ล้างแล้ว การตั้งหรือแก้ Callback URL ในหน้าแอปของ Meta จะยืนยันไม่ผ่านจนกว่าจะบันทึกค่าใหม่ · ข้อความ Messenger และคอมเมนต์เพจไม่ได้ใช้ค่านี้ จึงรับส่งได้ตามเดิม';
    // Readers: facebook.adapter sendMessage (bot + inbox staff replies — definitelyNotSent) and
    // getUserProfile (null ⇒ new rooms without name/avatar); inbound POSTs are checked with the
    // App Secret, so customer messages still arrive. Comment client/transport ⇒ notReady CONFIG ⇒
    // replies CAPABILITY_UNVERIFIED and, with comments enabled, ingest skips the event as permanent
    // (webhook answers 200, no redelivery; Messenger in the request continues — Task 35).
    // facebook-persistent-menu (Get Started button), backfill-profiles and the App Review panel's
    // Page-token calls fail.
    case 'facebook.pageAccessToken':
      return `${integrationName} จะส่งข้อความออกไม่ได้จนกว่าจะบันทึกค่าใหม่ — ทั้งบอทและพนักงานที่ตอบจากอินบ็อกซ์ · ข้อความที่ลูกค้าส่งเข้ามายังเข้าอินบ็อกซ์ แต่ลูกค้าที่ทักมาใหม่จะไม่มีชื่อและรูปโปรไฟล์จาก Facebook · ตอบคอมเมนต์เพจไม่ได้ และถ้าเปิดรับคอมเมนต์ไว้ คอมเมนต์ใหม่จะไม่เข้าอินบ็อกซ์และ Facebook จะไม่ส่งมาซ้ำ · ปุ่ม "ตั้งค่าปุ่ม Get Started" "Backfill รูปโปรไฟล์" และการทดสอบสิทธิ์ Facebook App ตรวจสอบที่ใช้ token ของเพจใช้ไม่ได้`;
    // yeastar-webhook.controller: no secret ⇒ 401 in production (call-status popup gone);
    // yeastar-cdr.cron still pulls call records every 15 min with the API credentials.
    case 'yeastar.webhookSecret':
      return 'ระบบจริงจะปฏิเสธ webhook ของ Yeastar ทุกครั้งจนกว่าจะบันทึกค่าใหม่ — หน้าต่างสายเรียกเข้าจะไม่ขึ้นให้พนักงาน ส่วนประวัติการโทรยังเข้ามาทางรอบดึงข้อมูลทุก 15 นาที';
    // Hub readers: finance-ai, vision (slips), ocr, credit-check AI, line-oa legacy chatbot.
    // Env ANTHROPIC_API_KEY readers keep going: sales-bot ClaudeProvider, after-hours,
    // ai-text (staff inbox assistant), staff-chat sales-state, chat-history knowledge extractor.
    case 'claude-ai.apiKey':
      return 'ฟีเจอร์ที่อ่านคีย์ผ่านหน้านี้จะหยุด: บอทน้องเบส · อ่านสลิป · อ่านเอกสาร (OCR) · วิเคราะห์เครดิตด้วย AI · บอทตอบแชท LINE SHOP แบบเดิม — ส่วนบอทขายในอินบ็อกซ์ · ข้อความตอบนอกเวลาทำการ · ผู้ช่วย AI ของพนักงานในอินบ็อกซ์ · การดึงคลังคำตอบจากแชทเก่า อ่าน ANTHROPIC_API_KEY ของเซิร์ฟเวอร์โดยตรง ไม่ได้อ่านผ่านหน้านี้ จึงไม่หยุดตาม (ต้องให้ผู้ดูแลระบบเอาออกเอง)';
    // EmailService (Hub) sends every email today: password reset, invites, weekly PDF report.
    // notifications/email-provider (env SMTP_PASS) has no caller yet.
    case 'email.pass':
      return 'อีเมลที่ระบบส่งจะหยุดจนกว่าจะบันทึกค่าใหม่ — ลิงก์รีเซ็ตรหัสผ่าน อีเมลเชิญผู้ใช้ และรายงานติดตามหนี้รายสัปดาห์ (PDF)';
    default:
      return `ฟีเจอร์ที่ใช้ ${fieldLabel} ของ ${integrationName} จะหยุดจนกว่าจะบันทึกค่าใหม่`;
  }
}

/**
 * Helper line under a required secret that has no value (never set, or cleared). Same source
 * as `clearImpactText`, so it never claims more than the confirmation did: only LINE FINANCE's
 * token keeps the B3 copy "การเชื่อมต่อใช้งานไม่ได้" (the dialog says the OA stops); other
 * fields (e.g. a LINE Channel Secret — sending still works) get neutral wording.
 */
export function missingRequiredSecretHelp(integrationKey: string, fieldKey: string): string {
  if (integrationKey === 'line-finance' && fieldKey === 'channelToken') {
    return 'ช่องนี้จำเป็น — การเชื่อมต่อใช้งานไม่ได้จนกว่าจะบันทึกค่าใหม่';
  }
  return 'ช่องนี้จำเป็น — บันทึกค่าใหม่เพื่อให้ใช้งานได้ครบ';
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
