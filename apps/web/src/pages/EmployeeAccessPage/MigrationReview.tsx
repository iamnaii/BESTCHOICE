import type { EmployeeAccessBranchOption } from '@installment/shared';
import { ROLE_LABELS } from '@/constants/user-roles';
import { ACCOUNTING_PERMISSION_LABELS } from '@/lib/accounting-permissions';
import { PAYMENT_APPROVAL_PERMISSION_LABELS } from '@/lib/payment-approval-permissions';
import type { MigrationPreview } from './api';
import { WORK_NAMES } from './preview';

function overrideLabels(value: unknown, labels: Record<string, string>) {
  if (value === undefined || (Array.isArray(value) && value.length === 0)) return 'ไม่มีรายการ';
  if (!Array.isArray(value)) return 'อ่านข้อมูลไม่ได้';
  const known = value.flatMap((item: unknown) =>
    typeof item === 'string' && Object.prototype.hasOwnProperty.call(labels, item) ? [labels[item]] : [],
  );
  const unknownCount = value.length - known.length;
  return [...known, ...(unknownCount ? [`ไม่ทราบประเภท ${unknownCount} รายการ`] : [])].join(' · ');
}

export function MigrationReview({
  preview,
  branches,
}: {
  preview: MigrationPreview;
  branches: EmployeeAccessBranchOption[];
}) {
  const { canReverseOverride, accounting_permissions, payment_approval_permissions } = preview.personalGrants;
  const reverse =
    canReverseOverride === true
      ? 'อนุญาตเป็นรายบุคคล'
      : canReverseOverride === false
        ? 'ปฏิเสธเป็นรายบุคคล'
        : 'ไม่มีการตั้งค่าเฉพาะบุคคล';

  return (
    <section
      aria-label="การเปลี่ยนจากสิทธิ์เดิม"
      className="space-y-2 rounded-lg border border-warning/50 bg-warning/10 p-3 leading-snug"
    >
      <h3 className="font-semibold">เริ่มใช้สิทธิ์ตามตำแหน่งทันที</h3>
      <p>เมื่อบันทึก ระบบจะเปิดใช้สิทธิ์ตามตำแหน่งสำหรับพนักงานคนนี้ทันที และลบสิทธิ์รายบุคคลเดิม</p>
      <p className="font-medium">ข้อมูลเดิมที่ต้องตรวจสอบ</p>
      <p>
        {ROLE_LABELS[preview.role] ?? preview.role}
        {preview.proposedCompanies.length > 0 &&
          ` · ${preview.proposedCompanies.map((work) => WORK_NAMES[work]).join(' · ')}`}
        {preview.branchId &&
          ` · ${branches.find(({ id }) => id === preview.branchId)?.name ?? 'สาขาเดิมไม่พร้อมใช้'}`}
      </p>
      <ul className="list-disc space-y-1 pl-5">
        <li>การตั้งค่ากลับรายการสินทรัพย์ · {reverse}</li>
        <li>
          สิทธิ์รายการบัญชีรายรับ–รายจ่าย ·{' '}
          {overrideLabels(accounting_permissions, ACCOUNTING_PERMISSION_LABELS)}
        </li>
        <li>
          สิทธิ์อนุมัติรับชำระ ·{' '}
          {overrideLabels(payment_approval_permissions, PAYMENT_APPROVAL_PERMISSION_LABELS)}
        </li>
      </ul>
      {preview.warnings.length > 0 && (
        <ul className="list-disc space-y-1 pl-5">
          {preview.warnings.map((warning) => (
            <li key={warning}>
              {warning
                .replace('accounting_permissions', 'สิทธิ์รายการบัญชีรายรับ–รายจ่าย')
                .replace('payment_approval_permissions', 'สิทธิ์อนุมัติรับชำระ')}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
