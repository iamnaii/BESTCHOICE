interface Props {
  expected: number;
  received: number | null | undefined;
}

/**
 * Read-only comparison: shows ตรง / ขาด / เกิน between expected and received.
 * The AdjustmentTable (separate component) handles the data entry for the diff.
 */
export function PaymentCompareCard({ expected, received }: Props) {
  if (received === null || received === undefined) {
    return (
      <div className="rounded-lg border-2 border-dashed p-3 text-center text-xs text-muted-foreground">
        กรอก &quot;จำนวนเงินที่ได้รับจริง&quot; เพื่อตรวจเปรียบเทียบกับยอดสุทธิ
      </div>
    );
  }
  const diff = +(received - expected).toFixed(2);
  let tone: 'success' | 'info' | 'warning';
  let label: string;
  if (Math.abs(diff) < 0.01) {
    tone = 'success';
    label = 'ตรงพอดี';
  } else if (diff > 0) {
    tone = 'info';
    label = `รับเกิน ${diff.toFixed(2)} ฿`;
  } else {
    tone = 'warning';
    label = `ขาด ${Math.abs(diff).toFixed(2)} ฿`;
  }
  const colorMap = {
    success: 'border-green-500 bg-green-500/10 text-green-700',
    info: 'border-blue-500 bg-blue-500/10 text-blue-700',
    warning: 'border-orange-500 bg-orange-500/10 text-orange-700',
  };
  return (
    <div className={`rounded-lg border-2 p-3 ${colorMap[tone]}`}>
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div>
          <p className="opacity-70">ยอดสุทธิ</p>
          <p className="font-mono font-bold">{expected.toFixed(2)}</p>
        </div>
        <div className="border-x">
          <p className="opacity-70">ได้รับจริง</p>
          <p className="font-mono font-bold">{received.toFixed(2)}</p>
        </div>
        <div>
          <p className="opacity-70">สถานะ</p>
          <p className="font-bold">{label}</p>
        </div>
      </div>
    </div>
  );
}
