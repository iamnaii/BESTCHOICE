import { useMemo, useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useUiFlags } from '@/hooks/useUiFlags';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import QueryBoundary from '@/components/QueryBoundary';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ChevronLeft } from 'lucide-react';
import { usersApi, userKeys, type EmploymentType } from '@/lib/api/users';
import { roleLabels, inputClass, labelClass } from './types';
import PersonalFields, { type PersonalForm } from './components/PersonalFields';

const EMPLOYMENT: { value: EmploymentType; label: string }[] = [
  { value: 'MONTHLY', label: 'รายเดือน' },
  { value: 'DAILY', label: 'รายวัน' },
  { value: 'CONTRACT', label: 'สัญญาจ้าง' },
];

const emptyPersonal: PersonalForm = {
  name: '', nickname: '', employeeId: '', startDate: '', nationalId: '',
  birthDate: '', phone: '', lineId: '', address: '', avatarUrl: '',
};
const emptyHr = {
  enabled: false, position: '', employmentType: 'MONTHLY' as EmploymentType,
  baseSalary: '', ssoEligible: true, bankName: '', bankAccountNo: '', resignedDate: '',
};

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const qc = useQueryClient();
  useDocumentTitle(isNew ? 'เพิ่มผู้ใช้' : 'รายละเอียดผู้ใช้');
  const { viewerRoleEnabled } = useUiFlags();

  const [tab, setTab] = useState('account');
  const [account, setAccount] = useState({ email: '', password: '', role: 'SALES', branchId: '', isActive: true });
  const [personal, setPersonal] = useState<PersonalForm>(emptyPersonal);
  const [hr, setHr] = useState(emptyHr);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get('/branches')).data,
  });

  const detail = useQuery({
    queryKey: userKeys.detail(id ?? ''),
    queryFn: () => usersApi.detail(id!),
    enabled: !isNew && !!id,
  });

  useEffect(() => {
    const u = detail.data;
    if (!u) return;
    setAccount({ email: u.email, password: '', role: u.role, branchId: u.branchId ?? '', isActive: u.isActive });
    setPersonal({
      name: u.name, nickname: u.nickname ?? '', employeeId: u.employeeId ?? '',
      startDate: u.startDate ? u.startDate.slice(0, 10) : '', nationalId: u.nationalId ?? '',
      birthDate: u.birthDate ? u.birthDate.slice(0, 10) : '', phone: u.phone ?? '',
      lineId: u.lineId ?? '', address: u.address ?? '', avatarUrl: u.avatarUrl ?? '',
    });
    const e = u.employeeProfile;
    setHr({
      enabled: !!e, position: e?.position ?? '', employmentType: e?.employmentType ?? 'MONTHLY',
      baseSalary: e?.baseSalary ?? '', ssoEligible: e?.ssoEligible ?? true,
      bankName: e?.bankName ?? '', bankAccountNo: e?.bankAccountNo ?? '',
      resignedDate: e?.resignedDate ? e.resignedDate.slice(0, 10) : '',
    });
  }, [detail.data]);

  const availableRoles = useMemo(
    () => Object.entries(roleLabels).filter(([k]) => k !== 'VIEWER' || viewerRoleEnabled || account.role === 'VIEWER'),
    [viewerRoleEnabled, account.role],
  );

  function buildBody() {
    const body: Record<string, unknown> = {
      name: personal.name,
      role: account.role,
      branchId: account.branchId || null,
      isActive: account.isActive,
      employeeId: personal.employeeId || null,
      nickname: personal.nickname || null,
      phone: personal.phone || null,
      lineId: personal.lineId || null,
      address: personal.address || null,
      avatarUrl: personal.avatarUrl || null,
      startDate: personal.startDate || null,
      nationalId: personal.nationalId || null,
      birthDate: personal.birthDate || null,
    };
    if (account.password) body.password = account.password;
    if (isNew) { body.email = account.email; body.password = account.password; }
    if (hr.enabled) {
      body.employee = {
        position: hr.position.trim() || undefined,
        employmentType: hr.employmentType,
        baseSalary: hr.baseSalary ? parseFloat(hr.baseSalary) : undefined,
        ssoEligible: hr.ssoEligible,
        bankName: hr.bankName.trim() || undefined,
        bankAccountNo: hr.bankAccountNo.trim() || undefined,
        resignedDate: hr.resignedDate ? new Date(hr.resignedDate).toISOString() : null,
      };
    }
    return body;
  }

  const save = useMutation({
    mutationFn: () => (isNew ? usersApi.create(buildBody()) : usersApi.saveProfile(id!, buildBody())),
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success(isNew ? 'เพิ่มผู้ใช้สำเร็จ' : 'บันทึกสำเร็จ');
      navigate(`/users/${saved.id}`, { replace: true });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const removeFromPayroll = useMutation({
    mutationFn: () => api.delete(`/employees/${detail.data?.employeeProfile?.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: userKeys.detail(id ?? '') });
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('นำพนักงานออกจากระบบจ่ายแล้ว');
      setConfirmRemove(false);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const u = detail.data;
  const titleName = isNew ? 'เพิ่มผู้ใช้ใหม่' : u?.name ?? '';

  return (
    <QueryBoundary isLoading={!isNew && detail.isLoading} isError={detail.isError} error={detail.error} onRetry={detail.refetch} errorTitle="ไม่สามารถโหลดข้อมูลผู้ใช้ได้">
      <div className="pb-24">
        <button onClick={() => navigate('/users')} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5 mb-4">
          <ChevronLeft className="size-4" /> กลับไปรายการผู้ใช้
        </button>

        <div className="flex items-center gap-4 mb-5">
          <div className="size-14 rounded-full bg-primary/10 text-primary grid place-items-center text-xl font-bold">
            {(titleName || '?').charAt(0)}
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground leading-snug">
              {titleName} {personal.nickname && <span className="text-sm font-normal text-muted-foreground">({personal.nickname})</span>}
            </h1>
            {!isNew && (
              <div className="flex items-center gap-2 flex-wrap mt-1">
                {personal.employeeId && <span className="text-sm text-muted-foreground">{personal.employeeId}</span>}
                <Badge variant={account.isActive ? 'primary' : 'secondary'} appearance="light" size="sm">
                  {account.isActive ? 'ใช้งาน' : 'ปิดใช้งาน'}
                </Badge>
                {hr.enabled && (
                  <Badge variant={hr.resignedDate ? 'secondary' : 'primary'} appearance="light" size="sm">
                    {hr.resignedDate ? 'ลาออก' : 'เป็นพนักงาน'}
                  </Badge>
                )}
              </div>
            )}
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-5">
            <TabsTrigger value="account">บัญชี / สิทธิ์</TabsTrigger>
            <TabsTrigger value="personal">ข้อมูลบุคคล</TabsTrigger>
            <TabsTrigger value="hr">HR / เงินเดือน</TabsTrigger>
          </TabsList>

          <TabsContent value="account">
            <div className="bg-card rounded-xl border border-border/50 shadow-sm p-6 grid md:grid-cols-2 gap-5">
              <div>
                <label className={labelClass}>อีเมล (เข้าสู่ระบบ) {isNew && '*'}</label>
                <input className={inputClass} type="email" value={account.email} disabled={!isNew} required={isNew}
                  onChange={(e) => setAccount({ ...account, email: e.target.value })} />
                {!isNew && <p className="text-[11px] text-muted-foreground mt-1">แก้ไม่ได้หลังสร้างบัญชี</p>}
              </div>
              <div>
                <label className={labelClass}>{isNew ? 'รหัสผ่าน *' : 'รหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)'}</label>
                <input className={inputClass} type="password" minLength={6} required={isNew}
                  value={account.password} onChange={(e) => setAccount({ ...account, password: e.target.value })} />
              </div>
              <div>
                <label className={labelClass}>บทบาท (สิทธิ์ระบบ) *</label>
                <select className={inputClass} value={account.role} onChange={(e) => setAccount({ ...account, role: e.target.value })}>
                  {availableRoles.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>สาขา</label>
                <select className={inputClass} value={account.branchId} onChange={(e) => setAccount({ ...account, branchId: e.target.value })}>
                  <option value="">ไม่ระบุ (ทุกสาขา)</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              {!isNew && (
                <label className="md:col-span-2 flex items-center justify-between rounded-lg border border-border p-3">
                  <span>
                    <span className="block text-sm font-medium text-foreground">สถานะการใช้งาน</span>
                    <span className="block text-[11px] text-muted-foreground">ปิดใช้งาน = ล็อกอินไม่ได้ + เพิกถอน session ทันที</span>
                  </span>
                  <input type="checkbox" className="size-5 accent-emerald-600" checked={account.isActive}
                    onChange={(e) => setAccount({ ...account, isActive: e.target.checked })} />
                </label>
              )}
            </div>
          </TabsContent>

          <TabsContent value="personal">
            <div className="bg-card rounded-xl border border-border/50 shadow-sm p-6">
              <PersonalFields
                form={personal}
                setForm={(k, v) => setPersonal((p) => ({ ...p, [k]: v }))}
                setMany={(patch) => setPersonal((p) => ({ ...p, ...patch }))}
              />
            </div>
          </TabsContent>

          <TabsContent value="hr">
            <div className="bg-card rounded-xl border border-border/50 shadow-sm p-6">
              {!hr.enabled ? (
                <div className="text-center py-10 border border-dashed border-border rounded-xl">
                  <div className="font-medium text-foreground leading-snug">ยังไม่ได้ตั้งเป็นพนักงาน</div>
                  <p className="text-sm text-muted-foreground mt-1 mb-4">ผู้ใช้คนนี้ยังไม่มีข้อมูล HR / เงินเดือน</p>
                  <Button onClick={() => setHr({ ...hr, enabled: true })}>+ เพิ่มข้อมูล HR / เงินเดือน</Button>
                </div>
              ) : (
                <div className="grid md:grid-cols-2 gap-5">
                  <div><label className={labelClass}>ตำแหน่งงาน</label>
                    <input className={inputClass} value={hr.position} onChange={(e) => setHr({ ...hr, position: e.target.value })} placeholder="เช่น พนักงานขาย" /></div>
                  <div><label className={labelClass}>ประเภทการจ้าง</label>
                    <select className={inputClass} value={hr.employmentType} onChange={(e) => setHr({ ...hr, employmentType: e.target.value as EmploymentType })}>
                      {EMPLOYMENT.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select></div>
                  <div><label className={labelClass}>ฐานเงินเดือน (บาท)</label>
                    <input className={inputClass} type="number" step="0.01" value={hr.baseSalary} onChange={(e) => setHr({ ...hr, baseSalary: e.target.value })} placeholder="0.00" /></div>
                  <div><label className={labelClass}>วันที่ลาออก</label>
                    <input className={inputClass} type="date" value={hr.resignedDate} onChange={(e) => setHr({ ...hr, resignedDate: e.target.value })} /></div>
                  <div><label className={labelClass}>ธนาคาร</label>
                    <input className={inputClass} value={hr.bankName} onChange={(e) => setHr({ ...hr, bankName: e.target.value })} /></div>
                  <div><label className={labelClass}>เลขบัญชี</label>
                    <input className={inputClass} value={hr.bankAccountNo} onChange={(e) => setHr({ ...hr, bankAccountNo: e.target.value })} /></div>
                  <label className="md:col-span-2 flex items-center gap-2 text-sm rounded-lg border border-border p-3">
                    <input type="checkbox" className="size-4 accent-emerald-600" checked={hr.ssoEligible} onChange={(e) => setHr({ ...hr, ssoEligible: e.target.checked })} />
                    เข้าประกันสังคม (หัก 5% / นายจ้างสมทบ 5%)
                  </label>
                  {!isNew && detail.data?.employeeProfile && (
                    <div className="md:col-span-2 pt-2 border-t border-border">
                      <button type="button" onClick={() => setConfirmRemove(true)} className="text-sm text-destructive hover:underline">
                        นำออกจากระบบจ่าย (เก็บประวัติ payroll เดิม)
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Sticky save bar — left offset matches sidebar expanded width (264px) */}
      <div className="fixed bottom-0 inset-x-0 md:left-[264px] bg-background/95 backdrop-blur border-t border-border px-6 py-3 flex items-center justify-end gap-3 z-40">
        <span className="text-xs text-muted-foreground mr-auto hidden sm:block">บันทึกครั้งเดียว → อัปเดต บัญชี + บุคคล + HR พร้อมกัน</span>
        <Button variant="outline" onClick={() => navigate('/users')}>ยกเลิก</Button>
        <Button disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'กำลังบันทึก...' : 'บันทึก'}</Button>
      </div>

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="นำพนักงานออกจากระบบจ่าย"
        description={`นำ ${u?.name ?? ''} ออกจากทะเบียนพนักงาน payroll? (ประวัติ payroll เดิมยังอยู่)`}
        confirmLabel="นำออก"
        variant="destructive"
        loading={removeFromPayroll.isPending}
        onConfirm={() => removeFromPayroll.mutate()}
      />
    </QueryBoundary>
  );
}
