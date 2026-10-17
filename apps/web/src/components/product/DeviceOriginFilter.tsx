import { NativeSelect } from '@/components/ui/native-select';
import { formControlClass } from '@/components/ui/form-styles';
import { cn } from '@/lib/utils';

export function DeviceOriginFilter({ value, onChange, id, className, wrapperClassName }: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  className?: string;
  wrapperClassName?: string;
}) {
  return <NativeSelect wrapperClassName={cn('mb-3 w-full sm:w-auto', wrapperClassName)} id={id} aria-label="เครื่องไทย / เครื่องนอก" value={value} onChange={e => onChange(e.target.value)} className={cn(formControlClass, className)}>
    <option value="">ไทย/นอกทั้งหมด</option><option value="THAI">เครื่องไทย</option><option value="IMPORTED">เครื่องนอก</option><option value="UNKNOWN">ยังไม่ระบุ</option>
  </NativeSelect>;
}
