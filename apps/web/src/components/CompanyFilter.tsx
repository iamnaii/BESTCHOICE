import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

interface Company {
  id: string;
  nameTh: string;
  companyCode: string;
}

interface CompanyFilterProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

const ALLOWED_ROLES = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'];

export default function CompanyFilter({ value, onChange, className }: CompanyFilterProps) {
  const { user } = useAuth();

  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ['companies'],
    queryFn: async () => (await api.get('/companies')).data,
    enabled: !!user && ALLOWED_ROLES.includes(user.role),
  });

  if (!user || !ALLOWED_ROLES.includes(user.role)) return null;

  return (
    <div className={cn(className)}>
      <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
        นิติบุคคล
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none min-w-[150px]"
      >
        <option value="">ทั้งหมด</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nameTh} ({c.companyCode})
          </option>
        ))}
      </select>
    </div>
  );
}
