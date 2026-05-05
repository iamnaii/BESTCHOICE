import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Badge } from '@/components/ui/badge';

// removed in A.4 — single FINANCE chart, no companyId / multi-entity filter

interface ChartOfAccount {
  id: string;
  code: string;
  name: string;                 // Thai name (was nameTh + nameEn in old schema)
  type: string;                 // สินทรัพย์ | สินทรัพย์ (Contra) | หนี้สิน | ทุน | รายได้ | ค่าใช้จ่าย
  normalBalance: string;        // Dr | Cr | Dr/Cr
  category?: string | null;
  vatApplicable: boolean;
  notes?: string | null;
  status: string;               // ใช้งาน | ไม่ใช้งาน
}

// Filter types — UI labels map to type field values
type TypeFilter = 'ALL' | 'สินทรัพย์' | 'หนี้สิน' | 'ทุน' | 'รายได้' | 'ค่าใช้จ่าย';

const TYPE_FILTER_LABELS: { value: TypeFilter; label: string }[] = [
  { value: 'ALL', label: 'ทั้งหมด' },
  { value: 'สินทรัพย์', label: 'สินทรัพย์' },
  { value: 'หนี้สิน', label: 'หนี้สิน' },
  { value: 'ทุน', label: 'ส่วนของเจ้าของ' },
  { value: 'รายได้', label: 'รายได้' },
  { value: 'ค่าใช้จ่าย', label: 'ค่าใช้จ่าย' },
];

// Type select options for the form
const TYPE_OPTIONS = [
  'สินทรัพย์',
  'สินทรัพย์ (Contra)',
  'หนี้สิน',
  'ทุน',
  'รายได้',
  'ค่าใช้จ่าย',
];

// Section headers by 2-digit code prefix (matching CSV structure)
const CODE_PREFIX_LABELS: Record<string, string> = {
  '11': 'สินทรัพย์หมุนเวียน',
  '12': 'สินทรัพย์ไม่หมุนเวียน',
  '21': 'หนี้สินหมุนเวียน',
  '22': 'หนี้สินไม่หมุนเวียน',
  '31': 'ทุนเรือนหุ้น / ส่วนของเจ้าของ',
  '32': 'กำไรสะสม',
  '33': 'กำไรประจำปี',
  '39': 'บัญชีปิดงบ (Closing Accounts)',
  '41': 'รายได้จากการขาย',
  '42': 'รายได้อื่น',
  '51': 'ต้นทุนขาย',
  '52': 'ค่าใช้จ่ายในการขาย',
  '53': 'ค่าใช้จ่ายในการบริหาร',
  '54': 'ค่าใช้จ่ายทางการเงิน',
  '55': 'ค่าใช้จ่ายอื่น',
};

// Derive section label from code — fallback to raw prefix
function getSectionLabel(prefix: string): string {
  return CODE_PREFIX_LABELS[prefix] ?? `หมวด ${prefix}`;
}

// Extract 2-digit prefix from code like "11-1101" → "11"
function codePrefix(code: string): string {
  const dash = code.indexOf('-');
  if (dash >= 2) return code.slice(0, 2);
  return code.slice(0, 2);
}

interface FormState {
  code: string;
  name: string;
  type: string;
  normalBalance: string;
  category: string;
  vatApplicable: boolean;
  notes: string;
  status: string;
}

const emptyForm: FormState = {
  code: '',
  name: '',
  type: 'สินทรัพย์',
  normalBalance: 'Dr',
  category: '',
  vatApplicable: false,
  notes: '',
  status: 'ใช้งาน',
};

export default function ChartOfAccountsPage() {
  const queryClient = useQueryClient();
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ChartOfAccount | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: string; label: string }>({
    open: false,
    id: '',
    label: '',
  });

  const {
    data: accounts = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<ChartOfAccount[]>({
    queryKey: ['chart-of-accounts'],
    queryFn: async () => {
      const { data } = await api.get('/chart-of-accounts');
      return data;
    },
  });

  // Client-side filter: type + search
  const filtered = useMemo(() => {
    return accounts.filter((a) => {
      // Type filter — "สินทรัพย์" matches both "สินทรัพย์" and "สินทรัพย์ (Contra)"
      if (typeFilter !== 'ALL' && !a.type.startsWith(typeFilter)) return false;
      if (search) {
        const q = search.toLowerCase();
        return a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q);
      }
      return true;
    });
  }, [accounts, typeFilter, search]);

  // Group by 2-digit code prefix, preserving sort order (accounts are already sorted by code asc)
  const sections = useMemo(() => {
    const map = new Map<string, ChartOfAccount[]>();
    for (const a of filtered) {
      const prefix = codePrefix(a.code);
      if (!map.has(prefix)) map.set(prefix, []);
      map.get(prefix)!.push(a);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        code: form.code,
        name: form.name,
        type: form.type,
        normalBalance: form.normalBalance,
        category: form.category || undefined,
        vatApplicable: form.vatApplicable,
        notes: form.notes || undefined,
        status: form.status,
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
        name: form.name,
        type: form.type,
        normalBalance: form.normalBalance,
        category: form.category || undefined,
        vatApplicable: form.vatApplicable,
        notes: form.notes || undefined,
        status: form.status,
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
      name: a.name,
      type: a.type,
      normalBalance: a.normalBalance,
      category: a.category ?? '',
      vatApplicable: a.vatApplicable,
      notes: a.notes ?? '',
      status: a.status,
    });
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditing(null);
    setForm(emptyForm);
  }

  function handleSubmit() {
    if (!form.code.trim() || !form.name.trim()) {
      toast.error('กรุณากรอกรหัสและชื่อบัญชี');
      return;
    }
    if (editing) updateMutation.mutate();
    else createMutation.mutate();
  }

  const inputClass =
    'w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 outline-hidden bg-background text-foreground';

  return (
    <div>
      <PageHeader
        title="ผังบัญชี"
        subtitle="จัดการรหัสบัญชี (Chart of Accounts) — BESTCHOICE FINANCE"
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
          aria-label="ค้นหาบัญชี"
        />
        <div className="flex gap-2 flex-wrap">
          {TYPE_FILTER_LABELS.map(({ value, label }) => (
            <FilterChip key={value} active={typeFilter === value} onClick={() => setTypeFilter(value)}>
              {label}
            </FilterChip>
          ))}
        </div>
        <span className="text-xs text-muted-foreground leading-snug">
          {filtered.length} รายการ
        </span>
      </div>

      {/* Account list grouped by code prefix */}
      <QueryBoundary
        isLoading={isLoading && accounts.length === 0}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดผังบัญชีได้"
      >
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground leading-snug">ไม่พบบัญชี</div>
        ) : (
          <div className="space-y-4">
            {sections.map(([prefix, list]) => (
              <div key={prefix} className="rounded-xl border border-border bg-card overflow-hidden">
                {/* Section header */}
                <div className="px-4 py-2.5 border-b border-border bg-muted/40 flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-muted-foreground">{prefix}</span>
                  <span className="font-semibold text-sm leading-snug">{getSectionLabel(prefix)}</span>
                  <span className="text-muted-foreground font-normal text-xs">({list.length})</span>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium w-28">รหัส</th>
                      <th className="text-left px-4 py-2 font-medium">ชื่อบัญชี</th>
                      <th className="text-left px-4 py-2 font-medium w-44">ประเภท</th>
                      <th className="text-left px-4 py-2 font-medium w-20">ยอดปกติ</th>
                      <th className="text-left px-4 py-2 font-medium w-20">สถานะ</th>
                      <th className="text-right px-4 py-2 font-medium w-32">การกระทำ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((a) => {
                      const isContra = a.type.includes('Contra');
                      return (
                        <tr key={a.id} className="border-t border-border hover:bg-muted/30">
                          <td className="px-4 py-2 font-mono font-medium text-foreground">{a.code}</td>
                          <td className="px-4 py-2 leading-snug">
                            <span className="text-foreground">{a.name}</span>
                            {a.category && (
                              <span className="ml-2 text-xs text-muted-foreground">{a.category}</span>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-muted-foreground leading-snug">{a.type}</span>
                              {isContra && (
                                <Badge variant="warning" appearance="light" size="sm">
                                  Contra
                                </Badge>
                              )}
                              {a.vatApplicable && (
                                <Badge variant="info" appearance="light" size="sm">
                                  VAT
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{a.normalBalance}</td>
                          <td className="px-4 py-2">
                            {a.status === 'ใช้งาน' ? (
                              <Badge variant="success" appearance="light" size="sm">ใช้งาน</Badge>
                            ) : (
                              <Badge variant="secondary" size="sm">{a.status}</Badge>
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
                              onClick={() =>
                                setDeleteConfirm({ open: true, id: a.id, label: `${a.code} ${a.name}` })
                              }
                              className="text-xs px-2 py-1 text-destructive hover:underline"
                            >
                              ลบ
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </QueryBoundary>

      {/* Add / Edit form overlay */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-start justify-center pt-8 pb-8">
          <div className="w-full max-w-xl bg-background rounded-xl shadow-2xl overflow-y-auto max-h-[calc(100vh-4rem)]">
            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs border-b border-border px-6 py-4 flex items-center justify-between">
              <button onClick={closeForm} className="text-sm text-muted-foreground hover:text-foreground">
                ← กลับ
              </button>
              <h2 className="text-lg font-semibold leading-snug">
                {editing ? 'แก้ไขบัญชี' : 'เพิ่มบัญชีใหม่'}
              </h2>
              <div className="w-12" />
            </div>
            <div className="p-6 space-y-4">
              {/* Code + Type */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1.5 leading-snug">
                    รหัสบัญชี <span className="text-destructive">*</span>
                  </label>
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
                  <label className="block text-xs font-medium mb-1.5 leading-snug">
                    ประเภทบัญชี <span className="text-destructive">*</span>
                  </label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                    className={inputClass}
                    aria-label="ประเภทบัญชี"
                  >
                    {TYPE_OPTIONS.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Name */}
              <div>
                <label className="block text-xs font-medium mb-1.5 leading-snug">
                  ชื่อบัญชี (ภาษาไทย) <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className={inputClass}
                  placeholder="เช่น เงินสด"
                />
              </div>

              {/* Normal Balance + Category */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1.5 leading-snug">ยอดปกติ</label>
                  <select
                    value={form.normalBalance}
                    onChange={(e) => setForm({ ...form, normalBalance: e.target.value })}
                    className={inputClass}
                    aria-label="ยอดปกติ"
                  >
                    <option value="Dr">Dr (เดบิต)</option>
                    <option value="Cr">Cr (เครดิต)</option>
                    <option value="Dr/Cr">Dr/Cr (ทั้งสองด้าน)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5 leading-snug">หมวดหมู่ (ถ้ามี)</label>
                  <input
                    type="text"
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className={inputClass}
                    placeholder="เช่น เงินสด, ลูกหนี้, VAT"
                  />
                </div>
              </div>

              {/* VAT applicable */}
              <label className="flex items-center gap-2 text-sm leading-snug cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.vatApplicable}
                  onChange={(e) => setForm({ ...form, vatApplicable: e.target.checked })}
                  className="rounded"
                />
                มี VAT (vatApplicable)
              </label>

              {/* Notes */}
              <div>
                <label className="block text-xs font-medium mb-1.5 leading-snug">หมายเหตุ</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className={`${inputClass} resize-none`}
                  rows={3}
                  placeholder="หมายเหตุเพิ่มเติม (ถ้ามี)"
                />
              </div>

              {/* Status */}
              <div>
                <label className="block text-xs font-medium mb-1.5 leading-snug">สถานะ</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className={inputClass}
                  aria-label="สถานะ"
                >
                  <option value="ใช้งาน">ใช้งาน</option>
                  <option value="ไม่ใช้งาน">ไม่ใช้งาน</option>
                </select>
              </div>
            </div>

            <div className="sticky bottom-0 bg-background/95 backdrop-blur-xs border-t border-border px-6 py-4 flex justify-end gap-3">
              <button
                onClick={closeForm}
                className="px-6 py-2.5 text-sm border border-input rounded-lg hover:bg-muted"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleSubmit}
                disabled={createMutation.isPending || updateMutation.isPending}
                className="px-6 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-semibold"
              >
                {createMutation.isPending || updateMutation.isPending
                  ? 'กำลังบันทึก...'
                  : editing
                  ? 'บันทึกการแก้ไข'
                  : 'เพิ่มบัญชี'}
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

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-sm rounded-lg border transition-colors leading-snug ${
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-background border-input hover:bg-muted text-foreground'
      }`}
    >
      {children}
    </button>
  );
}
