import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LIFF_CONSENT_WITHDRAW_TEXT } from '../liff-contact';

/**
 * โมดัล "ข้อตกลงการใช้งาน" ของ `/liff/contract` (ธง `customers.chat_consent`) — แยกออกจาก `LiffContract` ใน Task 33 fix round 1:
 * ข้อความถอนความยินยอมเดิมอ้าง "หน้าโปรไฟล์" ซึ่งไม่มีทางนั้น ⇒ ใช้ทางที่มีจริงชุดเดียวกับหน้า "ผูก LINE เรียบร้อย" (C3) ·
 * ลูกค้าที่ยินยอมตอนผูก LINE แล้วไม่เห็นโมดัลนี้ (API `GET line-oa/liff/consent` นับแถว pdpa_consents ของการผูก — คำตัดสินเจ้าของข้อ 30)
 */
export default function LiffConsentModal({
  pending,
  onAccept,
}: {
  pending: boolean;
  onAccept: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4">
      <Card
        role="dialog"
        aria-modal="true"
        aria-labelledby="liff-consent-title"
        className="max-w-md w-full animate-in slide-in-from-bottom-4"
      >
        <CardContent className="py-6">
          <h2 id="liff-consent-title" className="text-base font-bold mb-3 leading-snug">
            ข้อตกลงการใช้งาน
          </h2>
          <div className="text-xs text-muted-foreground space-y-2 mb-4 max-h-40 overflow-y-auto leading-snug">
            <p>
              BEST CHOICE ขอความยินยอมในการเก็บรวบรวม ใช้ และเปิดเผยข้อมูลส่วนบุคคลของท่าน
              เพื่อวัตถุประสงค์ดังนี้:
            </p>
            <p>1. การจัดการสัญญาเช่าซื้อและการชำระเงิน</p>
            <p>2. การแจ้งเตือนค่างวดและข้อมูลสัญญาผ่าน LINE</p>
            <p>3. การให้บริการลูกค้าผ่านระบบแชทอัตโนมัติ</p>
            <p>ต้องการยกเลิกความยินยอม: {LIFF_CONSENT_WITHDRAW_TEXT}</p>
          </div>
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            onClick={onAccept}
            disabled={pending}
          >
            {pending ? 'กำลังบันทึก...' : 'ยินยอม'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
