import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ROLE_LABELS } from '@/constants/user-roles';
import { useAuth } from '@/contexts/AuthContext';
import api, { getErrorMessage } from '@/lib/api';
import {
  PAYMENT_APPROVAL_PERMISSIONS,
  PAYMENT_APPROVAL_PERMISSION_LABELS,
  type PaymentApprovalPermission,
} from '@/lib/payment-approval-permissions';

interface ApprovalUser {
  id: string;
  name: string;
  role: string;
  permissions: PaymentApprovalPermission[];
}

interface ApprovalSettings { users: ApprovalUser[] }

const QUERY_KEY = ['settings', 'payment-approval-permissions'];

export function PaymentApprovalPermissionsCard() {
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<ApprovalUser[] | null>(null);
  const settings = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => (await api.get<ApprovalSettings>('/payments/approval-settings')).data,
    enabled: isOwner,
  });
  const save = useMutation({
    mutationFn: async (users: ApprovalUser[]) => (await api.put<ApprovalSettings>(
      '/payments/approval-settings',
      { users: users.map(({ id, permissions }) => ({ userId: id, permissions })) },
    )).data,
    onSuccess: (data) => {
      queryClient.setQueryData(QUERY_KEY, data);
      queryClient.invalidateQueries({ queryKey: ['payment-approval-permissions', 'me'] });
      queryClient.invalidateQueries({ queryKey: ['payment-approval-requests'] });
      setPending(null);
      toast.success('บันทึกสิทธิ์อนุมัติรับชำระแล้ว');
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
  const users = pending ?? settings.data?.users ?? [];

  const togglePermission = (userId: string, permission: PaymentApprovalPermission, checked: boolean) => {
    setPending(users.map((row) => row.id !== userId ? row : {
      ...row,
      permissions: PAYMENT_APPROVAL_PERMISSIONS.filter((key) => key === permission ? checked : row.permissions.includes(key)),
    }));
  };

  if (!isOwner) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 leading-snug">
          <ShieldCheck size={18} className="text-info" aria-hidden />
          สิทธิ์อนุมัติรับชำระ
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          รับชำระตามปกติไม่ต้องอนุมัติ กำหนดผู้มีสิทธิ์อนุมัติข้อยกเว้นแต่ละประเภทเป็นรายคน
          ผู้ขอและผู้อนุมัติต้องเป็นคนละคน ยกเว้น OWNER ที่ต้องระบุเหตุผลเมื่ออนุมัติรายการตนเอง
        </p>
        {settings.isPending && <p className="text-sm text-muted-foreground" role="status">กำลังโหลดสิทธิ์…</p>}
        {settings.isError && (
          <div className="space-y-2" role="alert">
            <p className="text-sm text-destructive">{getErrorMessage(settings.error)}</p>
            <Button variant="outline" onClick={() => settings.refetch()}>ลองใหม่</Button>
          </div>
        )}
        {settings.data && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th scope="col" className="min-w-44 p-3 text-left font-medium">ผู้ใช้</th>
                  {PAYMENT_APPROVAL_PERMISSIONS.map((permission) => (
                    <th key={permission} scope="col" className="min-w-28 p-3 text-center font-medium">
                      {PAYMENT_APPROVAL_PERMISSION_LABELS[permission]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((row) => (
                  <tr key={row.id} className="border-t">
                    <th scope="row" className="p-3 text-left font-normal">
                      <p className="font-medium">{row.name}</p>
                      <p className="text-xs text-muted-foreground">{ROLE_LABELS[row.role] ?? row.role}</p>
                    </th>
                    {PAYMENT_APPROVAL_PERMISSIONS.map((permission) => (
                      <td key={permission} className="p-3 text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-primary disabled:cursor-not-allowed"
                          aria-label={`${row.name}: ${PAYMENT_APPROVAL_PERMISSION_LABELS[permission]}`}
                          checked={row.role === 'OWNER' || row.permissions.includes(permission)}
                          disabled={row.role === 'OWNER' || save.isPending}
                          onChange={(event) => togglePermission(row.id, permission, event.target.checked)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">OWNER มีสิทธิ์ทุกประเภทเสมอ สิทธิ์ที่บันทึกมีผลในการอนุมัติครั้งถัดไป</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={!pending || save.isPending} onClick={() => setPending(null)}>ยกเลิกการแก้ไข</Button>
          <Button disabled={!pending || save.isPending || settings.isError} onClick={() => save.mutate(users)}>
            {save.isPending ? 'กำลังบันทึก…' : 'บันทึกสิทธิ์'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
