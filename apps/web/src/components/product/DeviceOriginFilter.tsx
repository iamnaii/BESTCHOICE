import { cn } from '@/lib/utils';

export function DeviceOriginFilter({ value, onChange, id, className }: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  className?: string;
}) {
  return <select id={id} aria-label="เครื่องไทย / เครื่องนอก" value={value} onChange={e => onChange(e.target.value)} className={cn('mb-3 rounded-lg border border-input bg-background px-3 py-2 text-sm', className)}>
    <option value="">ไทย/นอกทั้งหมด</option><option value="THAI">เครื่องไทย</option><option value="IMPORTED">เครื่องนอก</option><option value="UNKNOWN">ยังไม่ระบุ</option>
  </select>;
}
