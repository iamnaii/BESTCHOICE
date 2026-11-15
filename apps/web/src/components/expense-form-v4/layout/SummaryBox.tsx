interface Props {
  /** ค่าที่จัดรูปแล้ว — component นี้ไม่คำนวณและไม่จัดรูปตัวเลข */
  rows: { label: string; value: string }[];
  total: { label: string; value: string };
}

export function SummaryBox({ rows, total }: Props) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-8 gap-y-4">
      <dl className="grid grid-cols-[auto_auto] gap-x-8 gap-y-1.5 text-sm leading-snug">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="text-right tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex w-full items-baseline justify-between gap-4 rounded-lg bg-primary px-5 py-4 text-primary-foreground sm:w-80">
        <span className="text-sm font-medium leading-snug">{total.label}</span>
        <span className="text-2xl font-bold leading-snug tabular-nums">{total.value}</span>
      </div>
    </div>
  );
}
