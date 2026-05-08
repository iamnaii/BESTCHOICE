import { useFormContext } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import type { AssetEntryFormValues } from '../schema';

interface User {
  id: string;
  name: string;
  role: string;
}

export function AssetEntrySection5Approver() {
  const { register, setValue, watch } = useFormContext<AssetEntryFormValues>();
  const { user: currentUser } = useAuth();
  const approverId = watch('approverId');

  const usersQuery = useQuery({
    queryKey: ['users', { canApproveAsset: true }],
    queryFn: async () => {
      // Fetch users with OWNER or FINANCE_MANAGER role
      const { data } = await api.get<User[]>('/users', {
        params: { roles: ['OWNER', 'FINANCE_MANAGER'].join(',') },
      });
      return data;
    },
  });

  const sodWarning = approverId && currentUser && approverId === currentUser.id;

  return (
    <Card>
      <CardHeader>
        <CardTitle>5. ผู้รับผิดชอบ + อนุมัติ</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>ผู้สร้าง</Label>
          <div className="mt-1">
            <Badge variant="outline">{currentUser?.name ?? '-'}</Badge>
          </div>
        </div>
        <div>
          <Label>ผู้อนุมัติ (ผู้ POST)</Label>
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
          {sodWarning && (
            <div className="flex items-center gap-2 mt-2 p-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 rounded">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <p className="text-sm text-amber-800 dark:text-amber-200">
                คุณกำลังกำหนดให้ตัวเองเป็นผู้อนุมัติ (Segregation of Duties warning)
              </p>
            </div>
          )}
        </div>
        <div>
          <Label>หมายเหตุ</Label>
          <Textarea {...register('note')} rows={3} />
        </div>
      </CardContent>
    </Card>
  );
}
