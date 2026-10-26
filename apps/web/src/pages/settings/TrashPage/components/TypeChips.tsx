import type { TrashTypeInfo } from '@/hooks/useTrash';

interface Props {
  types: TrashTypeInfo[];
  value: string;
  onChange: (type: string) => void;
}

const CHIP = 'inline-flex min-h-11 lg:min-h-9 items-center gap-2 rounded-full border px-3 text-sm transition-colors';
const COUNT = 'inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums';

/** chips ประเภท — โชว์เฉพาะประเภทที่มีของ (count > 0) + "ทั้งหมด" */
export default function TypeChips({ types, value, onChange }: Props) {
  const visible = types.filter((t) => t.count > 0);
  const total = visible.reduce((sum, t) => sum + t.count, 0);
  const chip = (key: string, label: string, count: number, hint?: string) => {
    const active = value === key;
    return (
      <button
        key={key}
        type="button"
        role="tab"
        aria-selected={active}
        data-ui-control="button"
        onClick={() => onChange(key)}
        className={`${CHIP} ${active ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background text-foreground hover:bg-muted'}`}
      >
        <span>{label}</span>
        <span className={`${COUNT} ${active ? 'bg-primary-foreground/20' : 'bg-muted'}`}>{count}</span>
        {hint && <span className="text-xs opacity-75">{hint}</span>}
      </button>
    );
  };
  return (
    <div role="tablist" aria-label="ประเภทของที่ถูกลบ" className="flex flex-wrap gap-2">
      {chip('', 'ทั้งหมด', total)}
      {visible.map((t) => chip(t.type, t.label, t.count, t.restorable ? undefined : '· กู้ผ่านทางอื่น'))}
    </div>
  );
}
