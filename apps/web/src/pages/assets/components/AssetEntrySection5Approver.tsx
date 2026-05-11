import { useFormContext } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertTriangle,
  Info,
  ChevronRight,
  UserPlus,
  UserCheck,
  BookOpen,
} from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import type { AssetEntryFormValues } from '../schema';
import { AssetSectionHeader } from './AssetSectionHeader';

interface User {
  id: string;
  name: string;
  role: string;
}

const APPROVER_ROLES = ['OWNER', 'FINANCE_MANAGER'];

export function AssetEntrySection5Approver() {
  const { register, setValue, watch } = useFormContext<AssetEntryFormValues>();
  const { user: currentUser } = useAuth();
  const approverId = watch('approverId');

  const usersQuery = useQuery({
    queryKey: ['users', { canApproveAsset: true }],
    queryFn: async () => {
      // /users now returns paginated `{ data, total, page, limit }` — must unwrap.
      // Fallback to bare array for backward-compat.
      const res = await api.get('/users', {
        params: { roles: APPROVER_ROLES.join(','), limit: 200 },
      });
      const list: User[] =
        res.data?.data ?? (Array.isArray(res.data) ? (res.data as User[]) : []);
      return list.filter((u) => APPROVER_ROLES.includes(u.role));
    },
  });

  const sodWarning = approverId && currentUser && approverId === currentUser.id;
  const approverName =
    approverId && usersQuery.data?.find((u) => u.id === approverId)?.name;
  const approverDisplay = approverName ?? currentUser?.name ?? '—';

  return (
    <Card>
      <AssetSectionHeader
        number={5}
        title="ผู้รับผิดชอบเอกสาร & การอนุมัติ"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ResponsibilityChip
              icon={<UserPlus className="size-3.5" />}
              label="ผู้บันทึก"
              name={currentUser?.name ?? '-'}
            />
            <ChevronRight className="size-3.5 text-muted-foreground" />
            <ResponsibilityChip
              icon={<UserCheck className="size-3.5" />}
              label="ผู้อนุมัติ"
              name={approverDisplay}
              tone="warning"
            />
            <ChevronRight className="size-3.5 text-muted-foreground" />
            <ResponsibilityChip
              icon={<BookOpen className="size-3.5" />}
              label="ผู้บันทึกบัญชี"
              name={currentUser?.name ?? '-'}
              tone="success"
            />
          </div>
        }
      />
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>ผู้อนุมัติ</Label>
            <Select
              value={approverId ?? 'NONE'}
              onValueChange={(v) => setValue('approverId', v === 'NONE' ? undefined : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="(ผู้ POST จะระบุตอน POST)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">— ไม่ระบุล่วงหน้า —</SelectItem>
                {usersQuery.data?.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name} ({u.role})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              default = ผู้บันทึกเอง (สามารถเลือกผู้อนุมัติอื่นได้)
            </p>
            {sodWarning && (
              <div className="flex items-center gap-2 mt-2 p-2 bg-warning/10 border border-warning/20 rounded">
                <AlertTriangle className="h-4 w-4 text-warning" />
                <p className="text-sm text-foreground">
                  คุณกำลังกำหนดให้ตัวเองเป็นผู้อนุมัติ (Segregation of Duties warning)
                </p>
              </div>
            )}
          </div>
          <div>
            <Label>หมายเหตุเพิ่มเติม</Label>
            <Textarea
              {...register('note')}
              rows={3}
              placeholder="เหตุผลในการซื้อ / ข้อสังเกตเพิ่มเติม..."
            />
          </div>
        </div>
        <div className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/5 p-3 text-sm">
          <Info className="size-4 text-info shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-foreground">
              หลักการอนุมัติ (เดียวแบบเงินค่าใช้จ่าย):
            </span>{' '}
            <span className="text-foreground/90">
              ผู้บันทึกที่มี <code className="font-mono text-xs">can_post</code>{' '}
              สามารถบันทึก &amp; POST เอกสารได้ทันที
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface ChipProps {
  icon: React.ReactNode;
  label: string;
  name: string;
  tone?: 'default' | 'warning' | 'success';
}

function ResponsibilityChip({ icon, label, name, tone = 'default' }: ChipProps) {
  const toneClasses =
    tone === 'warning'
      ? 'border-warning/30 bg-warning/5 text-warning'
      : tone === 'success'
        ? 'border-success/30 bg-success/5 text-success'
        : 'border-border bg-muted/40 text-foreground';
  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${toneClasses}`}
    >
      <span>{icon}</span>
      <div className="leading-tight">
        <div className="text-[10px] uppercase tracking-wider opacity-80">{label}</div>
        <div className="font-semibold text-inherit">{name}</div>
      </div>
    </div>
  );
}
