import { ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { DocType } from '../types';

type MenuKey = 'EXPENSE' | 'VENDOR_SETTLEMENT' | 'PAYROLL' | 'CREDIT_NOTE' | 'PETTY_CASH_REIMBURSEMENT';

const ITEMS: { key: MenuKey; label: string }[] = [
  { key: 'EXPENSE', label: 'บันทึกค่าใช้จ่าย' },
  { key: 'VENDOR_SETTLEMENT', label: 'จ่ายชำระเจ้าหนี้' },
  { key: 'PAYROLL', label: 'เงินเดือน' },
  { key: 'CREDIT_NOTE', label: 'ใบลดหนี้' },
  { key: 'PETTY_CASH_REIMBURSEMENT', label: 'เงินสดย่อย' },
];

const menuKeyOf = (t: DocType): MenuKey =>
  t === 'EXPENSE_SAMEDAY' || t === 'EXPENSE_ACCRUAL' ? 'EXPENSE' : t;

export const docTypeLabel = (t: DocType): string =>
  ITEMS.find((item) => item.key === menuKeyOf(t))!.label;

interface Props {
  value: DocType;
  onChange: (t: DocType) => void;
  /** false = ไม่มีรายการ "เงินสดย่อย" (flag ปิด) */
  pettyCashEnabled?: boolean;
  /** false = ไม่มีรายการ "เงินเดือน" (ผู้จัดการสาขา — คำตัดสินเจ้าของ 2026-10-28) */
  payrollEnabled?: boolean;
  /** โหมดแก้ไขใบเงินเดือน — แสดงชื่ออย่างเดียว */
  locked?: boolean;
}

const titleClass = 'text-xl font-semibold leading-snug text-primary sm:text-2xl';

export function DocTypeMenu({ value, onChange, pettyCashEnabled = true, payrollEnabled = true, locked = false }: Props) {
  const current = menuKeyOf(value);
  if (locked) return <h1 className={titleClass}>{docTypeLabel(value)}</h1>;

  const items = ITEMS.filter(
    (item) =>
      (pettyCashEnabled || item.key !== 'PETTY_CASH_REIMBURSEMENT') && (payrollEnabled || item.key !== 'PAYROLL'),
  );
  const pick = (key: MenuKey) => {
    if (key === current) return;
    // "จ่ายทันที/ตั้งหนี้" เลือกในส่วนชำระเงิน — มาจากประเภทอื่นเริ่มที่จ่ายทันทีเหมือนกดชิปเดิม
    onChange(key === 'EXPENSE' ? 'EXPENSE_SAMEDAY' : key);
  };

  return (
    <h1 className="m-0">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`เปลี่ยนประเภทเอกสาร: ${docTypeLabel(value)}`}
            className="flex min-h-11 items-center gap-2 rounded-md text-left"
          >
            <span className={titleClass}>{docTypeLabel(value)}</span>
            <ChevronDown className="size-5 shrink-0 text-primary" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-64">
          {/* radio item: จุดหน้ารายการ + aria-checked บอกประเภทที่เลือกอยู่ */}
          <DropdownMenuRadioGroup value={current} onValueChange={(key) => pick(key as MenuKey)}>
            {items.map((item) => (
              <DropdownMenuRadioItem key={item.key} value={item.key} className="min-h-11 text-sm leading-snug">
                {item.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </h1>
  );
}
