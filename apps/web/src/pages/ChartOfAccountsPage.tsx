import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

type AccountGroup = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

type CompanyCode = 'SHOP' | 'FINANCE';

interface ChartOfAccount {
  id: string;
  code: string;
  nameTh: string;
  nameEn?: string | null;
  accountGroup: AccountGroup;
  parentCode?: string | null;
  level: number;
  isActive: boolean;
  allowedCompanies: CompanyCode[];
  peakAccountCode?: string | null;
  peakAccountId?: string | null;
}

const GROUP_LABELS: Record<AccountGroup, string> = {
  ASSET: 'สินทรัพย์',
  LIABILITY: 'หนี้สิน',
  EQUITY: 'ส่วนของเจ้าของ',
  REVENUE: 'รายได้',
  EXPENSE: 'ค่าใช้จ่าย',
};

const GROUP_COLORS: Record<AccountGroup, string> = {
  ASSET: 'bg-emerald-100 text-emerald-700',
  LIABILITY: 'bg-orange-100 text-orange-700',
  EQUITY: 'bg-violet-100 text-violet-700',
  REVENUE: 'bg-sky-100 text-sky-700',
  EXPENSE: 'bg-rose-100 text-rose-700',
};

interface FormState {
  code: string;
  nameTh: string;
  nameEn: string;
  accountGroup: AccountGroup;
  parentCode: string;
  level: number;
  isActive: boolean;
  allowedCompanies: CompanyCode[];
  peakAccountCode: string;
  peakAccountId: string;
}

const emptyForm: FormState = {
  code: '',
  nameTh: '',
  nameEn: '',
  accountGroup: 'ASSET',
  parentCode: '',
  level: 3,
  isActive: true,
  allowedCompanies: [],
  peakAccountCode: '',
  peakAccountId: '',
};

export default function ChartOfAccountsPage() {
  const queryClient = useQueryClient();
  const [groupFilter, setGroupFilter] = useState<AccountGroup | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ChartOfAccount | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: string; label: string }>({ open: false, id: '', label: '' });

  const { data: accounts = [], isLoading, isError, error, refetch } = useQuery<ChartOfAccount[]>({
    queryKey: ['chart-of-accounts'],
    queryFn: async () => {
      const { data } = await api.get('/chart-of-accounts');
      return data;
    },
  });

  const filtered = useMemo(() => {
    return accounts.filter((a) => {
      if (groupFilter !== 'ALL' && a.accountGroup !== groupFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          a.code.toLowerCase().includes(q) ||
          a.nameTh.toLowerCase().includes(q) ||
          (a.nameEn || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [accounts, groupFilter, search]);

  const grouped = useMemo(() => {
    const map = new Map<AccountGroup, ChartOfAccount[]>();
    for (const a of filtered) {
      if (!map.has(a.accountGroup)) map.set(a.accountGroup, []);
      map.get(a.accountGroup)!.push(a);
    }
    return map;
  }, [filtered]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        nameEn: form.nameEn || undefined,
        parentCode: form.parentCode || undefined,
        peakAccountCode: form.peakAccountCode || undefined,
        peakAccountId: form.peakAccountId || undefined,
      };
      const { data } = await api.post('/chart-of-accounts', payload);
      return data;
    },
    onSuccess: () => {
      toast.success('เพิ่มบัญชีสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      closeForm();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const payload = {
        nameTh: form.nameTh,
        nameEn: form.nameEn || undefined,
        accountGroup: form.accountGroup,
        parentCode: form.parentCode || undefined,
        level: form.level,
        isActive: form.isActive,
        allowedCompanies: form.allowedCompanies,
        peakAccountCode: form.peakAccountCode || undefined,
        peakAccountId: form.peakAccountId || undefined,
      };
      const { data } = await api.patch(`/chart-of-accounts/${editing.id}`, payload);
      return data;
    },
    onSuccess: () => {
      toast.success('แก้ไขบัญชีสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      closeForm();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/chart-of-accounts/${id}`);
    },
    onSuccess: () => {
      toast.success('ลบบัญชีแล้ว');
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  function openEdit(a: ChartOfAccount) {
    setEditing(a);
    setForm({
      code: a.code,
      nameTh: a.nameTh,
      nameEn: a.nameEn || '',
      accountGroup: a.accountGroup,
      parentCode: a.parentCode || '',
      level: a.level,
      isActive: a.isActive,
      allowedCompanies: a.allowedCompanies || [],
      peakAccountCode: a.peakAccountCode || '',
      peakAccountId: a.peakAccountId || '',
    });
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditing(null);
    setForm(emptyForm);
  }

  function handleSubmit() {
    if (!form.code.trim() || !form.nameTh.trim()) {
      toast.error('กรุณากรอกรหัสและชื่อบัญชี');
      return;
    }
    if (editing) updateMutation.mutate();
    else createMutation.mutate();
  }

  const inputClass = 'w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 outline-hidden';

  return (
    <div>
      <PageHeader
        title="ผังบัญชี"
        subtitle="จัดการรหัสบัญชี (Chart of Accounts) สำหรับระบบบัญชี"
        action={
          <button
            onClick={openCreate}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 shadow-sm"
          >
            + เพิ่มบัญชี
          </button>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="text"
          placeholder="ค้นหารหัสหรือชื่อบัญชี..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${inputClass} max-w-xs`}
        />
        <div className="flex gap-2 flex-wrap">
          <FilterChip active={groupFilter === 'ALL'} onClick={() => setGroupFilter('ALL')}>ทั้งหมด</FilterChip>
          {(Object.keys(GROUP_LABELS) as AccountGroup[]).map((g) => (
            <FilterChip key={g} active={groupFilter === g} onClick={() => setGroupFilter(g)}>
              {GROUP_LABELS[g]}
            </FilterChip>
          ))}
        </div>
      </div>

      {/* List */}
      <QueryBoundary
        isLoading={isLoading && accounts.length === 0}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดผังบัญชีได้"
      >
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">ไม่พบบัญชี</div>
      ) : (
        <div className="space-y-6">
          {(Object.keys(GROUP_LABELS) as AccountGroup[]).map((g) => {
            const list = grouped.get(g);
            if (!list || list.length === 0) return null;
            return (
              <div key={g} className="rounded-xl border border-border bg-card overflow-hidden">
                <div className={`px-4 py-2.5 border-b border-border ${GROUP_COLORS[g]} font-semibold text-sm`}>
                  {GROUP_LABELS[g]} ({list.length})
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium w-32">รหัส</th>
                      <th className="text-left px-4 py-2 font-medium">ชื่อบัญชี (ไทย)</th>
                      <th className="text-left px-4 py-2 font-medium">ชื่อบัญชี (อังกฤษ)</th>
                      <th className="text-left px-4 py-2 font-medium w-24">บัญชีแม่</th>
                      <th className="text-left px-4 py-2 font-medium w-20">ระดับ</th>
                      <th className="text-left px-4 py-2 font-medium w-24">สถานะ</th>
                      <th className="text-right px-4 py-2 font-medium w-32">การกระทำ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((a) => (
                      <tr key={a.id} className="border-t border-border hover:bg-muted/30">
                        <td className="px-4 py-2 font-mono font-medium">{a.code}</td>
                        <td className="px-4 py-2">{a.nameTh}</td>
                        <td className="px-4 py-2 text-muted-foreground">{a.nameEn || '-'}</td>
                        <td className="px-4 py-2 font-mono text-muted-foreground">{a.parentCode || '-'}</td>
                        <td className="px-4 py-2">{a.level}</td>
                        <td className="px-4 py-2">
                          {a.isActive ? (
                            <span className="text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">ใช้งาน</span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">ปิด</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right space-x-2">
                          <button
                            onClick={() => openEdit(a)}
                            className="text-xs px-2 py-1 text-primary hover:underline"
                          >
                            แก้ไข
                          </button>
                          <button
                            onClick={() => setDeleteConfirm({ open: true, id: a.id, label: `${a.code} ${a.nameTh}` })}
                            className="text-xs px-2 py-1 text-destructive hover:underline"
                          >
                            ลบ
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
      </QueryBoundary>

      {/* Form overlay */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-start justify-center pt-8 pb-8">
          <div className="w-full max-w-xl bg-background rounded-xl shadow-2xl overflow-y-auto max-h-[calc(100vh-4rem)]">
            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs border-b px-6 py-4 flex items-center justify-between">
              <button onClick={closeForm} className="text-sm text-muted-foreground hover:text-foreground">← กลับ</button>
              <h2 className="text-lg font-semibold">{editing ? 'แก้ไขบัญชี' : 'เพิ่มบัญชีใหม่'}</h2>
              <div className="w-12" />
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1.5">รหัสบัญชี <span className="text-destructive">*</span></label>
                  <input
                    type="text"
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    className={inputClass}
                    placeholder="เช่น 11-1101"
                    disabled={!!editing}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5">หมวดบัญชี <span className="text-destructive">*</span></label>
                  <select
                    value={form.accountGroup}
                    onChange={(e) => setForm({ ...form, accountGroup: e.target.value as AccountGroup })}
                    className={inputClass}
                  >
                    {(Object.keys(GROUP_LABELS) as AccountGroup[]).map((g) => (
                      <option key={g} value={g}>{GROUP_LABELS[g]}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5">ชื่อบัญชี (ไทย) <span className="text-destructive">*</span></label>
                <input
                  type="text"
                  value={form.nameTh}
                  onChange={(e) => setForm({ ...form, nameTh: e.target.value })}
                  className={inputClass}
                  placeholder="เช่น เงินสด - เงินสดย่อย"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5">ชื่อบัญชี (อังกฤษ)</label>
                <input
                  type="text"
                  value={form.nameEn}
                  onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
                  className={inputClass}
                  placeholder="เช่น Petty Cash"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1.5">รหัสบัญชีแม่ (ถ้ามี)</label>
                  <input
                    type="text"
                    value={form.parentCode}
                    onChange={(e) => setForm({ ...form, parentCode: e.target.value })}
                    className={inputClass}
                    placeholder="เช่น 11-1100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5">ระดับ (1=กลุ่ม, 3=รายละเอียด)</label>
                  <select
                    value={form.level}
                    onChange={(e) => setForm({ ...form, level: Number(e.target.value) })}
                    className={inputClass}
                  >
                    <option value={1}>1 - กลุ่มหลัก</option>
                    <option value={2}>2 - กลุ่มย่อย</option>
                    <option value={3}>3 - รายละเอียด</option>
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                />
                ใช้งาน
              </label>

              {/* ── การใช้งานข้ามบริษัท (Multi-Entity) ── */}
              <div className="border-t pt-4 mt-2">
                <label className="block text-xs font-medium mb-2">อนุญาตให้บริษัทใช้งาน</label>
                <div className="flex gap-4">
                  {(['SHOP', 'FINANCE'] as CompanyCode[]).map((c) => (
                    <label key={c} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.allowedCompanies.includes(c)}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...form.allowedCompanies, c]
                            : form.allowedCompanies.filter((x) => x !== c);
                          setForm({ ...form, allowedCompanies: next });
                        }}
                      />
                      {c === 'SHOP' ? 'BESTCHOICE SHOP' : 'BESTCHOICE FINANCE'}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  ไม่เลือกเลย = ใช้ได้ทุกบริษัท
                </p>
              </div>

              {/* ── การ sync กับ PEAK ── */}
              <div className="border-t pt-4 mt-2">
                <label className="block text-xs font-medium mb-2 text-muted-foreground">
                  การเชื่อมต่อกับ PEAK (ระบบบัญชีภายนอก)
                </label>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium mb-1.5">รหัสบัญชี PEAK</label>
                    <input
                      type="text"
                      value={form.peakAccountCode}
                      onChange={(e) => setForm({ ...form, peakAccountCode: e.target.value })}
                      className={inputClass}
                      placeholder="เช่น 11-1101"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1.5">PEAK Account ID</label>
                    <input
                      type="text"
                      value={form.peakAccountId}
                      onChange={(e) => setForm({ ...form, peakAccountId: e.target.value })}
                      className={inputClass}
                      placeholder="UUID จาก PEAK API"
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="sticky bottom-0 bg-background/95 backdrop-blur-xs border-t px-6 py-4 flex justify-end gap-3">
              <button onClick={closeForm} className="px-6 py-2.5 text-sm border border-input rounded-lg hover:bg-muted">ยกเลิก</button>
              <button
                onClick={handleSubmit}
                disabled={createMutation.isPending || updateMutation.isPending}
                className="px-6 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-semibold"
              >
                {createMutation.isPending || updateMutation.isPending ? 'กำลังบันทึก...' : editing ? 'บันทึกการแก้ไข' : 'เพิ่มบัญชี'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteConfirm.open}
        onOpenChange={(open) => setDeleteConfirm((prev) => ({ ...prev, open }))}
        description={`ลบบัญชี ${deleteConfirm.label}?`}
        variant="destructive"
        onConfirm={() => deleteMutation.mutate(deleteConfirm.id)}
      />
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
        active ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-input hover:bg-muted'
      }`}
    >
      {children}
    </button>
  );
}
