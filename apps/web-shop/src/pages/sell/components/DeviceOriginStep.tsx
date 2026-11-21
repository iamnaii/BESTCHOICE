import type { BuybackQuestion } from '@/types/buyback';
import { lineOaMessageUrl } from '@/lib/copy';
import ChoiceButton from './ChoiceButton';
import { sellThaiPartSuffix } from '@installment/shared';

export function isThaiOriginLabel(label: string) {
  return /^เครื่อง(ศูนย์)?ไทย(?:\s|\(|$)/.test(label.trim());
}

export default function DeviceOriginStep({
  question,
  answer,
  disabled,
  onSelect,
  model,
  storage,
}: {
  question: BuybackQuestion;
  answer: string[] | undefined;
  disabled: boolean;
  onSelect: (id: string) => void;
  model: string;
  storage: string;
}) {
  const suffix = sellThaiPartSuffix(model);
  const thai = question.choices.find((choice) => isThaiOriginLabel(choice.label));
  const imported = question.choices.find((choice) => /^เครื่องนอก/.test(choice.label.trim()));
  const rejected = imported && answer?.includes(imported.id);
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-secondary p-4 text-secondary-foreground">
        <p className="font-bold">รับเครื่องโมเดลไทย · รหัสขึ้นต้น M เท่านั้น</p>
        <p className="mt-1 text-sm">ไม่รับโมเดลนอก รวมถึงรหัสขึ้นต้น N ตัวเลข หรืออักษรอื่น</p>
      </div>
      <details className="rounded-xl border border-border px-4">
        <summary className="min-h-11 cursor-pointer py-3 font-semibold text-secondary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          ดูไม่เป็น? กดดูวิธีเช็ก
        </summary>
        <section aria-label="วิธีเช็กโมเดลเครื่อง" className="space-y-3 pb-4 pt-2">
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>
              เปิด <strong>การตั้งค่า → ทั่วไป → เกี่ยวกับ</strong>
              <span className="block text-muted-foreground">Settings → General → About</span>
            </li>
            <li>
              ดูแถว <strong>หมายเลขรุ่น (Model Number)</strong> แล้วดูรหัสท้ายก่อนและหลังเครื่องหมาย
              /
            </li>
            <li>
              ถ้าเห็นรหัสขึ้นต้น <strong>A ตามด้วยตัวเลข</strong>{' '}
              ให้แตะหนึ่งครั้งเพื่อสลับกลับมาดูรหัสสินค้า
            </li>
          </ol>
          <div className="rounded-lg border border-border bg-muted p-3">
            <p className="text-sm font-semibold">สำหรับ {model}</p>
            {suffix ? (
              <>
                <p className="mt-2 text-xl tracking-wide">
                  <strong className="text-primary">M</strong>xxxx
                  <strong className="text-primary">{suffix}</strong>
                </p>
                <p className="mt-2 text-sm">
                  ตัวแรกต้องเป็น <strong>M</strong> และลงท้าย <strong>{suffix}</strong>
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm">ให้ร้านช่วยตรวจรหัสของรุ่นนี้ก่อน</p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              x เป็นตัวอย่างตำแหน่งอักษรหรือตัวเลข ให้ดูเทียบกับรหัสบนเครื่องของคุณ
            </p>
          </div>
          <details className="text-sm">
            <summary className="min-h-11 cursor-pointer py-3 text-secondary-foreground underline">
              ดูรหัสท้ายแยกตามรุ่น
            </summary>
            <ul className="space-y-2 pb-3">
              <li>
                iPhone 13 ทุกรุ่นย่อย: <strong>TH/A</strong>
              </li>
              <li>
                iPhone 14, 15, 16, 17 ทุกรุ่นย่อย: <strong>ZP/A</strong>
              </li>
              <li>
                iPhone Air: <strong>ZP/A</strong>
              </li>
            </ul>
          </details>
          <p className="text-sm">
            ZP/A ใช้ร่วมกันหลายประเทศ รหัสตรงอย่างเดียวจึงยังยืนยันว่าเป็นเครื่องศูนย์ไทยไม่ได้
            หากไม่ทราบที่มาหรือดูไม่เป็น ให้ร้านช่วยเช็กก่อน
          </p>
          <a
            className="inline-flex min-h-11 items-center text-sm text-secondary-foreground underline"
            href="https://support.apple.com/th-th/106343"
            target="_blank"
            rel="noopener noreferrer"
          >
            ดูวิธีหาหมายเลขรุ่นจาก Apple
          </a>
        </section>
      </details>
      <div className="grid gap-2" role="group" aria-label="โมเดลไทยหรือโมเดลนอก">
        {thai && (
          <ChoiceButton
            selected={answer?.includes(thai.id) ?? false}
            disabled={disabled}
            onClick={() => onSelect(thai.id)}
            label="เครื่องโมเดลไทย"
          >
            <span>
              <span className="block font-semibold">เครื่องโมเดลไทย</span>
              <span className="mt-1 block text-sm">ยืนยันว่าเป็นเครื่องศูนย์ไทย รหัสขึ้นต้น M</span>
            </span>
          </ChoiceButton>
        )}
        {imported && (
          <ChoiceButton
            selected={answer?.includes(imported.id) ?? false}
            disabled={disabled}
            onClick={() => onSelect(imported.id)}
            label="เครื่องโมเดลนอก"
          >
            <span>
              <span className="block font-semibold">เครื่องโมเดลนอก</span>
              <span className="mt-1 block text-sm">
                เครื่องสำหรับจำหน่ายต่างประเทศ · ร้านไม่รับซื้อหรือเทิร์น
              </span>
            </span>
          </ChoiceButton>
        )}
      </div>
      {(rejected || !thai) && (
        <div
          role="status"
          aria-label="ผลการเช็กโมเดล"
          className="space-y-3 rounded-xl border border-border bg-muted p-4"
        >
          <p className="font-semibold">
            {rejected ? 'ขออภัย ร้านไม่รับเครื่องโมเดลนอก' : 'ให้ร้านช่วยเช็กโมเดลก่อนได้ครับ'}
          </p>
          <p className="text-sm">
            {rejected
              ? 'จึงยังประเมินราคาขายหรือเทิร์นเครื่องนี้ต่อไม่ได้ หากเลือกผิด ให้กลับมาเลือกคำตอบด้านบน'
              : 'ส่งรหัสในแถวหมายเลขรุ่นให้ร้านทาง LINE ได้เลย เมื่อยืนยันว่าเป็นโมเดลไทยแล้ว ค่อยกลับมาเลือกเครื่องโมเดลไทย'}
          </p>
          <a
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 py-3 font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            href={lineOaMessageUrl(
              `สวัสดีครับ/ค่ะ รบกวนช่วยเช็กว่า ${model} ${storage} เป็นโมเดลไทยหรือโมเดลนอก\nรหัสในแถวหมายเลขรุ่น: (พิมพ์รหัสหรือแนบภาพในแชทได้เลย)\nรับทราบว่าร้านรับเฉพาะโมเดลไทย รหัสขึ้นต้น M ครับ/ค่ะ`,
            )}
            target="_blank"
            rel="noopener noreferrer"
          >
            ให้ร้านช่วยเช็กทาง LINE
          </a>
          <p className="text-xs text-muted-foreground">
            เปิดแชทพร้อมข้อความให้แก้ไข แล้วคุณกดส่งเองใน LINE
          </p>
        </div>
      )}
    </div>
  );
}
