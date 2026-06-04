import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { employeeKeys, employeesApi, type EmploymentType } from '@/lib/api/employees';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const TYPES: EmploymentType[] = ['MONTHLY', 'DAILY', 'CONTRACT'];
const TYPE_LABEL: Record<EmploymentType, string> = {
  MONTHLY: 'รายเดือน',
  DAILY: 'รายวัน',
  CONTRACT: 'สัญญาจ้าง',
};

export default function EditEmployeeDialog({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const open = id !== null;
  const [confirmDel, setConfirmDel] = useState(false);
  const [form, setForm] = useState({
    position: '',
    employmentType: 'MONTHLY' as EmploymentType,
    baseSalary: '',
    ssoEligible: true,
    bankName: '',
    bankAccountNo: '',
    resignedDate: '',
  });

  const detail = useQuery({
    queryKey: employeeKeys.detail(id ?? ''),
    queryFn: () => employeesApi.detail(id!),
    enabled: open,
  });

  useEffect(() => {
    const e = detail.data;
    if (e)
      setForm({
        position: e.position ?? '',
        employmentType: e.employmentType,
        baseSalary: e.baseSalary ?? '',
        ssoEligible: e.ssoEligible,
        bankName: e.bankName ?? '',
        bankAccountNo: e.bankAccountNo ?? '',
        resignedDate: e.resignedDate ? e.resignedDate.slice(0, 10) : '',
      });
  }, [detail.data]);

  const save = useMutation({
    mutationFn: () =>
      employeesApi.update(id!, {
        position: form.position.trim() || undefined,
        employmentType: form.employmentType,
        baseSalary: form.baseSalary ? parseFloat(form.baseSalary) : undefined,
        ssoEligible: form.ssoEligible,
        bankName: form.bankName.trim() || undefined,
        bankAccountNo: form.bankAccountNo.trim() || undefined,
        resignedDate: form.resignedDate ? new Date(form.resignedDate).toISOString() : undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: employeeKeys.all });
      toast.success('บันทึกข้อมูลพนักงานแล้ว');
      onClose();
    },
    onError: () => toast.error('บันทึกไม่สำเร็จ'),
  });

  const del = useMutation({
    mutationFn: () => employeesApi.remove(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: employeeKeys.all });
      toast.success('นำพนักงานออกจากระบบจ่ายแล้ว');
      setConfirmDel(false);
      onClose();
    },
    onError: () => toast.error('ลบไม่สำเร็จ'),
  });

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) onClose();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="leading-snug">
              แก้ไขพนักงาน{detail.data ? ` — ${detail.data.user.name}` : ''}
            </DialogTitle>
          </DialogHeader>
          {detail.isLoading ? (
            <p className="text-sm text-muted-foreground py-4 leading-snug">กำลังโหลด...</p>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">รหัสพนักงาน</span>
                  <div>{detail.data?.user.employeeId || '—'}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">เลขบัตร</span>
                  <div>{detail.data?.user.nationalId || '—'}</div>
                </div>
              </div>
              <div>
                <Label>ตำแหน่ง</Label>
                <Input
                  value={form.position}
                  onChange={(e) => setForm({ ...form, position: e.target.value })}
                />
              </div>
              <div>
                <Label>ประเภทการจ้าง</Label>
                <select
                  value={form.employmentType}
                  onChange={(e) =>
                    setForm({ ...form, employmentType: e.target.value as EmploymentType })
                  }
                  className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background"
                >
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>ฐานเงินเดือน</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.baseSalary}
                    onChange={(e) => setForm({ ...form, baseSalary: e.target.value })}
                  />
                </div>
                <div>
                  <Label>วันที่ลาออก</Label>
                  <Input
                    type="date"
                    value={form.resignedDate}
                    onChange={(e) => setForm({ ...form, resignedDate: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>ธนาคาร</Label>
                  <Input
                    value={form.bankName}
                    onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                  />
                </div>
                <div>
                  <Label>เลขบัญชี</Label>
                  <Input
                    value={form.bankAccountNo}
                    onChange={(e) => setForm({ ...form, bankAccountNo: e.target.value })}
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm leading-snug">
                <input
                  type="checkbox"
                  checked={form.ssoEligible}
                  onChange={(e) => setForm({ ...form, ssoEligible: e.target.checked })}
                />
                เข้าประกันสังคม
              </label>
            </div>
          )}
          <DialogFooter className="justify-between">
            <Button
              variant="outline"
              className="text-destructive"
              onClick={() => setConfirmDel(true)}
            >
              นำออก
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>
                ยกเลิก
              </Button>
              <Button disabled={save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmDel}
        onOpenChange={setConfirmDel}
        title="นำพนักงานออกจากระบบจ่าย"
        description={
          detail.data
            ? `นำ ${detail.data.user.name} ออกจากทะเบียนพนักงาน payroll? (ประวัติ payroll เดิมยังอยู่)`
            : ''
        }
        confirmLabel="นำออก"
        variant="destructive"
        loading={del.isPending}
        onConfirm={() => del.mutate()}
      />
    </>
  );
}
