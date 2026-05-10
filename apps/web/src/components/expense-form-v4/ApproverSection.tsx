import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

interface Props {
  approvedById: string;
  onChange: (id: string) => void;
}

interface UserRow {
  id: string;
  name: string;
  role: string;
}

export function ApproverSection({ approvedById, onChange }: Props) {
  const { user } = useAuth();
  const { data: approvers } = useQuery<UserRow[]>({
    queryKey: ['users', 'approvers'],
    queryFn: async () => (await api.get('/users?roles=OWNER,FINANCE_MANAGER,ACCOUNTANT')).data,
    staleTime: 60_000,
  });

  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <label className="block text-xs font-medium mb-1">ผู้บันทึก</label>
        <input
          type="text"
          value={user ? `${user.name} (${user.role})` : ''}
          readOnly
          className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-muted/50"
        />
      </div>
      <div>
        <label className="block text-xs font-medium mb-1">ผู้อนุมัติ</label>
        <select
          value={approvedById}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background"
        >
          <option value="">— เลือก —</option>
          {approvers?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.role})
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
