import { customerCreditStatusMap } from '@/lib/status-badges';
import { SOURCE_LABELS } from '@/pages/CustomersPage/components/sourceLabels';
import { formatDateShort } from '@/utils/formatters';
import type { CustomerDetail } from '../types';
import { customerKind } from './customerKind';

export type KpiTone = 'default' | 'primary' | 'success' | 'destructive';
export interface KpiTile {
  key: string;
  label: string;
  value: string;
  sub: string;
  tone: KpiTone;
}

const baht = (n: number) => `${n.toLocaleString('th-TH', { maximumFractionDigits: 2 })} ฿`;
const dateOrDash = (iso: string | null | undefined) => (iso ? formatDateShort(iso) : '—');

function purchaseTile(c: CustomerDetail): KpiTile {
  const p = c.purchase;
  const installment = p?.installmentTotal ?? 0;
  const cash = p?.cashCount ?? 0;
  const external = p?.externalFinanceCount ?? 0;
  const parts = [
    installment ? `ผ่อน ${installment}` : '',
    cash ? `เงินสด ${cash}` : '',
    external ? `ไฟแนนซ์นอก ${external}` : '',
  ].filter(Boolean);
  return { key: 'purchase', label: 'การซื้อ', value: `${installment + cash + external} รายการ`, sub: parts.join(' · '), tone: 'default' };
}

function warrantyTile(c: CustomerDetail): KpiTile {
  const w = c.warranty;
  const prefix = w?.source === 'SHOP' ? 'ร้าน ' : w?.source === 'CENTER' ? 'ศูนย์ ' : '';
  return {
    key: 'warranty',
    label: 'ประกันถึง',
    value: w?.endDate ? `${prefix}${formatDateShort(w.endDate)}` : '—',
    sub: c.latestPurchase?.productLabel ?? '',
    tone: 'default',
  };
}

function loyaltyTile(balance: number | null): KpiTile {
  const value = balance ?? 0;
  return { key: 'loyalty', label: 'แต้มสะสม', value: value.toLocaleString('th-TH'), sub: '', tone: value > 0 ? 'primary' : 'default' };
}

export function kpiTiles(c: CustomerDetail, loyaltyBalance: number | null): KpiTile[] {
  const kind = customerKind(c);

  if (kind === 'INSTALLMENT') {
    const overdueCount = c.openContracts.reduce((sum, k) => sum + k.overdueInstallments, 0);
    const overdueAmount = c.openContracts.reduce((sum, k) => sum + k.overdueAmount, 0);
    const next = c.openContracts
      .filter((k) => k.nextDueDate)
      .sort((a, b) => (a.nextDueDate! < b.nextDueDate! ? -1 : 1))[0];
    return [
      purchaseTile(c),
      {
        key: 'outstanding',
        label: 'คงค้าง',
        // ตัวเลขเดียวกับคอลัมน์ "คงค้าง" ของหน้ารายชื่อ (installmentBalance) — ห้ามรวมเองจาก openContracts
        value: baht(c.installmentBalance?.outstanding ?? 0),
        sub: overdueCount > 0 ? `ค้างชำระ ${overdueCount} งวด · ${baht(overdueAmount)}` : 'ไม่มีงวดค้าง',
        tone: overdueCount > 0 ? 'destructive' : 'default',
      },
      {
        key: 'nextDue',
        label: 'งวดถัดไป',
        value: dateOrDash(next?.nextDueDate),
        sub: next && next.nextAmountDue !== null ? `${baht(next.nextAmountDue)} · ${next.contractNumber}` : '',
        tone: 'default',
      },
      warrantyTile(c),
      loyaltyTile(loyaltyBalance),
    ];
  }

  if (kind === 'CASH') {
    const salesTotal = (c.sales ?? []).reduce((sum, s) => sum + Number(s.netAmount), 0);
    return [
      purchaseTile(c),
      { key: 'salesTotal', label: 'ยอดซื้อรวม', value: baht(salesTotal), sub: '', tone: 'default' },
      { key: 'latest', label: 'ซื้อล่าสุด', value: dateOrDash(c.latestPurchase?.at), sub: c.latestPurchase?.productLabel ?? '', tone: 'default' },
      warrantyTile(c),
      loyaltyTile(loyaltyBalance),
    ];
  }

  const credit = customerCreditStatusMap[c.creditCheckStatus] ?? customerCreditStatusMap.NONE;
  return [
    { key: 'source', label: 'ที่มา', value: SOURCE_LABELS[c.source] ?? c.source, sub: c.chatPlaceholder ? 'ยังไม่มีเบอร์' : '', tone: 'default' },
    { key: 'lastContact', label: 'ติดต่อล่าสุด', value: dateOrDash(c.lastContactAt), sub: '', tone: 'default' },
    { key: 'owner', label: 'ผู้ดูแล', value: c.assignedTo?.name ?? 'ยังไม่มีผู้ดูแล', sub: '', tone: 'default' },
    {
      key: 'credit',
      label: 'เครดิต',
      value: credit.label,
      sub: '',
      tone: c.creditCheckStatus === 'FULL_CHECK_PASSED' ? 'success' : c.creditCheckStatus === 'REJECTED' ? 'destructive' : 'default',
    },
  ];
}
