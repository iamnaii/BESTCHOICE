import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Info, UserCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';

interface EligibleUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface CustodianInfo {
  companyId: string;
  companyCode: string | null;
  custodianRole: 'OWNER' | 'BRANCH_MANAGER' | 'ACCOUNTANT';
  custodian: EligibleUser | null;
}

/**
 * D1.1.5.5 — Petty Cash custodian picker. Lives on the /settings#users
 * tab (OWNER-only). Reads the configured custodian role + currently
 * assigned user, and the eligible-user pool filtered by that role.
 *
 * Selecting a user (or "ยกเลิกผู้ดูแล") immediately PUTs to
 * `/settings/petty-cash/custodian` and toasts on success/failure.
 *
 * UI mirrors the MakerCheckerToggle pattern: Card + status text +
 * `<Info>` callout + native shadcn Select.
 */
export function PettyCashCustodianCard() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>('__none__');

  const custodianQuery = useQuery<CustodianInfo | null>({
    queryKey: ['settings', 'petty-cash-custodian'],
    queryFn: async () => {
      const { data } = await api.get<CustodianInfo | null>('/settings/petty-cash/custodian');
      return data;
    },
  });

  const eligibleQuery = useQuery<EligibleUser[]>({
    queryKey: ['settings', 'petty-cash-eligible-custodians'],
    queryFn: async () => {
      const { data } = await api.get<EligibleUser[]>('/settings/petty-cash/eligible-custodians');
      return data;
    },
  });

  // Sync local Select state with the server-side custodian. Using
  // sentinel `__none__` so the Select can render a non-empty default value
  // (Radix Select disallows empty-string item value).
  useEffect(() => {
    if (custodianQuery.data) {
      setSelectedId(custodianQuery.data.custodian?.id ?? '__none__');
    }
  }, [custodianQuery.data]);

  const mutation = useMutation({
    mutationFn: async (userId: string | null) => {
      await api.put('/settings/petty-cash/custodian', {
        companyId: custodianQuery.data?.companyId,
        userId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'petty-cash-custodian'] });
      toast.success('บันทึกผู้ดูแลเงินสดย่อยสำเร็จ');
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const onSubmit = () => {
    const nextUserId = selectedId === '__none__' ? null : selectedId;
    mutation.mutate(nextUserId);
  };

  const role = custodianQuery.data?.custodianRole ?? 'ACCOUNTANT';
  const eligible = eligibleQuery.data ?? [];
  const current = custodianQuery.data?.custodian ?? null;
  const isDirty = (current?.id ?? '__none__') !== selectedId;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserCircle2 className="size-4" />
          ผู้ดูแลเงินสดย่อย (Petty Cash Custodian)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <Select value={selectedId} onValueChange={setSelectedId} disabled={mutation.isPending}>
            <SelectTrigger className="sm:w-80">
              <SelectValue placeholder="-- ยังไม่ได้กำหนด --" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— ยกเลิกผู้ดูแล —</SelectItem>
              {eligible.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                  <span className="text-muted-foreground"> · {u.email}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={!isDirty || mutation.isPending}
            size="sm"
          >
            {mutation.isPending ? 'กำลังบันทึก…' : 'บันทึก'}
          </Button>
        </div>

        {current && (
          <p className="text-xs text-muted-foreground">
            ปัจจุบัน: <span className="font-medium text-foreground">{current.name}</span> ({current.role})
          </p>
        )}

        <div className="flex items-start gap-2 rounded-md bg-muted p-3">
          <Info className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
          <div className="text-xs text-muted-foreground space-y-1">
            <p>
              บทบาทที่อนุญาต: <span className="font-medium">{role}</span> (เปลี่ยนได้ที่
              SystemConfig.<code>petty_cash_custodian_role</code>)
            </p>
            <p>
              ผู้ดูแลเงินสดย่อยคือผู้รับผิดชอบลิ้นชักเงินสดในสาขา/ส่วนกลาง — ใช้แสดงในใบเบิก Petty Cash
              และบันทึกใน AuditLog เมื่อมีการเบิกชดเชย
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
