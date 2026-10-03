import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';

interface MonthlyPeriodSelectProps {
  year: number;
  month: number;
  onYearChange: (year: number) => void;
  onMonthChange: (month: number) => void;
}

export function MonthlyPeriodSelect({
  year,
  month,
  onYearChange,
  onMonthChange,
}: MonthlyPeriodSelectProps) {
  return (
    <>
      <Select value={String(year)} onValueChange={(v) => onYearChange(parseInt(v, 10))}>
        <SelectTrigger className="w-[110px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {[year - 2, year - 1, year, year + 1].map((y) => (
            <SelectItem key={y} value={String(y)}>
              {y + 543}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={String(month)} onValueChange={(v) => onMonthChange(parseInt(v, 10))}>
        <SelectTrigger className="w-[130px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Array.from({ length: 12 }, (_, i) => (
            <SelectItem key={i} value={String(i + 1)}>
              เดือน {i + 1}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
