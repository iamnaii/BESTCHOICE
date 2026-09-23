import { baht, type Summary } from './after-sales';

interface SummaryStripProps {
  summary: Summary;
  /** OWNER/FINANCE_MANAGER/ACCOUNTANT เห็นตัวเลขค่าซ่อม — SALES ไม่เห็น (API ส่ง null มาให้แล้ว
   * แต่หน้าเว็บยังต้องตัดสินใจเองว่าจะสลับไปโชว์เมตริกอื่นแทนที่ไม่ใช่เงิน) */
  showMoney: boolean;
}

function Cell({
  label,
  value,
  valueClassName = '',
  sub,
}: {
  label: string;
  value: string | number;
  valueClassName?: string;
  sub?: string;
}) {
  return (
    <div className="space-y-0.5 px-4 py-3.5 leading-snug">
      <div className={`text-2xl font-bold tabular-nums ${valueClassName}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export default function SummaryStrip({ summary, showMoney }: SummaryStripProps) {
  const repairCostTotal = (summary.repairCostShop ?? 0) + (summary.repairCostCustomer ?? 0);

  return (
    <div className="grid grid-cols-2 divide-x divide-y divide-border overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-5 sm:divide-y-0">
      <Cell
        label="เคสเปิดอยู่"
        value={summary.open}
        sub={`ซ่อม ${summary.openRepair} · เปลี่ยนเครื่อง ${summary.openExchange}`}
      />
      <Cell
        label="ค้างนาน"
        value={summary.stale}
        valueClassName="text-warning-strong"
        sub="เกินกรอบเวลาของขั้นตอนนั้น"
      />
      <Cell label="รออนุมัติ" value={summary.awaitingApproval} sub="รอผจก. / เจ้าของตัดสิน" />
      {showMoney && summary.repairCostShop != null ? (
        <Cell
          label="เดือนนี้ ค่าซ่อม"
          value={`${baht(repairCostTotal)} ฿`}
          sub={`ร้านจ่าย ${baht(summary.repairCostShop ?? 0)} · ลูกค้าจ่าย ${baht(summary.repairCostCustomer ?? 0)} · เคลมศูนย์ ${summary.supplierClaims} ใบ`}
        />
      ) : (
        <Cell
          label="เคลมศูนย์เดือนนี้"
          value={summary.supplierClaims}
          sub="ใบเคลมที่ปิดแล้วในเดือนนี้"
        />
      )}
      <Cell
        label="เปลี่ยนเครื่อง"
        value={summary.exchanges > 0 ? summary.exchanges : '—'}
        sub="อยู่ระหว่างพัฒนา (PR ถัดไป)"
      />
    </div>
  );
}
