# Employee Master — PR-B (Frontend Master Page) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the `/employees` master page — OWNER/ACCOUNTANT can list, search, **provision** (turn an existing User into a payroll employee), **edit** payroll fields, and soft-delete employee profiles.

**Architecture:** Web-only (apps/web). Talks to PR-A's `employees` API. All tests mock the API module (vitest), so this PR builds + tests independently of PR-A's branch; at deploy, PR-A must be live first (its endpoints back this UI). New `employeesApi` client mirrors `apps/web/src/lib/api/contacts.ts`. Page mirrors `CustomersPage.tsx` (DataTable + search). Dialogs mirror `CreateContactModal.tsx` (useMutation + toast + invalidateQueries).

**Tech Stack:** React + TS + Vite + Tailwind + shadcn/ui + @tanstack/react-query + sonner. Tests: vitest (`npm --prefix apps/web run test -- <file>`).

**Spec:** docs/superpowers/specs/2026-06-04-employee-master-design.md §3.1. Branch: `feat/employee-master-ui` (off main).

**RBAC (frontend):** page + menu visible to OWNER + ACCOUNTANT only. Backend `@Roles` is the real gate; the UI just hides what they can't use. Pattern: `const canManage = ['OWNER','ACCOUNTANT'].includes(user?.role ?? '')`.

**API contract (from PR-A — match exactly):**
- `GET /employees?search=&isActive=&page=&limit=` → `{ data: EmployeeRow[], total, page, limit }`; `EmployeeRow` includes `{ id, position, employmentType, baseSalary, ssoEligible, ..., resignedDate, user: { id, name, nickname, employeeId, nationalId (MASKED), startDate, branchId, isActive } }`
- `GET /employees/:id` → same shape but `user.nationalId` is FULL
- `GET /employees/provisionable?search=` → `{ userId, employeeId, name, nickname }[]`
- `POST /employees` body `{ userId, position?, employmentType?, baseSalary?, ssoEligible?, bankName?, bankAccountNo?, taxIdOverride?, note? }`
- `PATCH /employees/:id` body = any of the above (no userId) + `resignedDate?`
- `DELETE /employees/:id`

---

## File Structure
- Create: `apps/web/src/lib/api/employees.ts`
- Create: `apps/web/src/pages/EmployeesPage.tsx`
- Create: `apps/web/src/components/employees/ProvisionEmployeeDialog.tsx`
- Create: `apps/web/src/components/employees/EditEmployeeDialog.tsx`
- Create: `apps/web/src/pages/__tests__/EmployeesPage.test.tsx`
- Modify: `apps/web/src/App.tsx` — lazy route `/employees`
- Modify: `apps/web/src/config/menu.ts` — "พนักงาน" item in OWNER + ACCOUNTANT sidebars

---

## Task 1: API client `employees.ts`

**Files:** Create `apps/web/src/lib/api/employees.ts`

- [ ] **Step 1: Write it** (mirror `lib/api/contacts.ts`)

```typescript
import api from '@/lib/api';

export type EmploymentType = 'MONTHLY' | 'DAILY' | 'CONTRACT';

export interface EmployeeUser {
  id: string;
  name: string;
  nickname: string | null;
  employeeId: string | null;
  nationalId: string | null; // masked in list, full in detail
  startDate: string | null;
  branchId: string | null;
  isActive: boolean;
}

export interface Employee {
  id: string;
  userId: string;
  position: string | null;
  employmentType: EmploymentType;
  baseSalary: string | null; // Prisma Decimal serialises to string
  ssoEligible: boolean;
  bankName: string | null;
  bankAccountNo: string | null;
  taxIdOverride: string | null;
  note: string | null;
  resignedDate: string | null;
  user: EmployeeUser;
}

export interface EmployeeListResult {
  data: Employee[];
  total: number;
  page: number;
  limit: number;
}

export interface ProvisionableUser {
  userId: string;
  employeeId: string | null;
  name: string;
  nickname: string | null;
}

export interface ProvisionEmployeeInput {
  userId: string;
  position?: string;
  employmentType?: EmploymentType;
  baseSalary?: number;
  ssoEligible?: boolean;
  bankName?: string;
  bankAccountNo?: string;
  taxIdOverride?: string;
  note?: string;
}

export type UpdateEmployeeInput = Partial<Omit<ProvisionEmployeeInput, 'userId'>> & {
  resignedDate?: string | null;
};

export const employeeKeys = {
  all: ['employees'] as const,
  list: (params: Record<string, unknown>) => [...employeeKeys.all, 'list', params] as const,
  detail: (id: string) => [...employeeKeys.all, 'detail', id] as const,
  provisionable: (search: string) => [...employeeKeys.all, 'provisionable', search] as const,
};

export const employeesApi = {
  list: (params: { search?: string; isActive?: boolean; page?: number; limit?: number }) => {
    const query: Record<string, unknown> = { page: params.page ?? 1, limit: params.limit ?? 50 };
    if (params.search) query.search = params.search;
    if (params.isActive !== undefined) query.isActive = String(params.isActive);
    return api.get<EmployeeListResult>('/employees', { params: query }).then((r) => r.data);
  },
  detail: (id: string) => api.get<Employee>(`/employees/${id}`).then((r) => r.data),
  provisionable: (search?: string) =>
    api
      .get<ProvisionableUser[]>('/employees/provisionable', { params: search ? { search } : {} })
      .then((r) => r.data),
  provision: (input: ProvisionEmployeeInput) =>
    api.post<Employee>('/employees', input).then((r) => r.data),
  update: (id: string, input: UpdateEmployeeInput) =>
    api.patch<Employee>(`/employees/${id}`, input).then((r) => r.data),
  remove: (id: string) => api.delete(`/employees/${id}`).then((r) => r.data),
};
```

- [ ] **Step 2: Typecheck** — `./tools/check-types.sh web` → OK.
- [ ] **Step 3: Commit** — `git add apps/web/src/lib/api/employees.ts && git commit -m "feat(employees-ui): employeesApi client + types + query keys"`

---

## Task 2: `EmployeesPage` list + route + menu

**Files:** Create `apps/web/src/pages/EmployeesPage.tsx`; Modify `App.tsx`, `config/menu.ts`

- [ ] **Step 1: Create `EmployeesPage.tsx`** (mirror CustomersPage: useDocumentTitle, useAuth, useDebounce, useQuery, DataTable, QueryBoundary, PageHeader). The two dialogs are added in Tasks 3-4; import them now and wire the open state.

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UserPlus, Users } from 'lucide-react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useDebounce } from '@/hooks/useDebounce';
import { useAuth } from '@/contexts/AuthContext';
import QueryBoundary from '@/components/QueryBoundary';
import DataTable, { type Column } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { employeeKeys, employeesApi, type Employee } from '@/lib/api/employees';
import ProvisionEmployeeDialog from '@/components/employees/ProvisionEmployeeDialog';
import EditEmployeeDialog from '@/components/employees/EditEmployeeDialog';

const EMPLOYMENT_LABELS: Record<string, string> = {
  MONTHLY: 'รายเดือน',
  DAILY: 'รายวัน',
  CONTRACT: 'สัญญาจ้าง',
};

export default function EmployeesPage() {
  useDocumentTitle('พนักงาน');
  const { user } = useAuth();
  const canManage = ['OWNER', 'ACCOUNTANT'].includes(user?.role ?? '');
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search);
  const [page, setPage] = useState(1);
  const [provisionOpen, setProvisionOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: employeeKeys.list({ search: debounced || undefined, page }),
    queryFn: () => employeesApi.list({ search: debounced || undefined, page }),
  });

  const columns: Column<Employee>[] = [
    { key: 'employeeId', label: 'รหัส', render: (e) => e.user.employeeId || '—' },
    {
      key: 'name',
      label: 'ชื่อ',
      render: (e) => (
        <div className="leading-snug">
          <div className="text-foreground">{e.user.name}</div>
          {e.user.nickname && <div className="text-xs text-muted-foreground">{e.user.nickname}</div>}
        </div>
      ),
    },
    { key: 'position', label: 'ตำแหน่ง', render: (e) => e.position || '—' },
    { key: 'employmentType', label: 'ประเภทจ้าง', render: (e) => EMPLOYMENT_LABELS[e.employmentType] ?? e.employmentType },
    { key: 'nationalId', label: 'เลขบัตร', render: (e) => e.user.nationalId || '—' },
    {
      key: 'status',
      label: 'สถานะ',
      render: (e) =>
        e.resignedDate ? (
          <Badge variant="secondary" appearance="light" size="sm">ลาออก</Badge>
        ) : (
          <Badge variant="primary" appearance="light" size="sm">ทำงาน</Badge>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground leading-snug flex items-center gap-2">
          <Users className="size-5" /> พนักงาน
        </h1>
        {canManage && (
          <Button onClick={() => setProvisionOpen(true)}>
            <UserPlus className="size-4" /> เพิ่มพนักงาน
          </Button>
        )}
      </div>

      <Input
        value={search}
        onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        placeholder="ค้นหาด้วยชื่อ / ชื่อเล่น / รหัสพนักงาน"
        className="max-w-sm"
      />

      <QueryBoundary
        isLoading={isLoading && !data}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดรายชื่อพนักงานได้"
      >
        <DataTable
          columns={columns}
          data={data?.data ?? []}
          isLoading={isLoading}
          emptyMessage="ไม่พบพนักงาน"
          onRowClick={canManage ? (e) => setEditId(e.id) : undefined}
          pagination={
            data
              ? { page: data.page, totalPages: Math.max(1, Math.ceil(data.total / data.limit)), total: data.total, onPageChange: setPage }
              : undefined
          }
        />
      </QueryBoundary>

      {canManage && (
        <>
          <ProvisionEmployeeDialog open={provisionOpen} onOpenChange={setProvisionOpen} />
          <EditEmployeeDialog id={editId} onClose={() => setEditId(null)} />
        </>
      )}
    </div>
  );
}
```

> If `DataTable`'s `pagination.totalPages` is supplied by the API instead of derived, adjust. The PR-A list returns `{total, page, limit}` (no totalPages) — derive it as shown.

- [ ] **Step 2: Add the route in `App.tsx`** — add the lazy import near the others and a route under the authenticated `MainLayout` block (mirror the `/customers` route):

```tsx
const EmployeesPage = lazy(() => import('@/pages/EmployeesPage'));
// ...within the MainLayout-protected <Route> group:
<Route path="/employees" element={<EmployeesPage />} />
```
(Read App.tsx to match the EXACT route nesting used for `/customers` — wrap in the same Suspense/element shape.)

- [ ] **Step 3: Add the menu item** in `apps/web/src/config/menu.ts` — add to BOTH `OWNER_CONFIG.sidebar` and `ACCOUNTANT_CONFIG.sidebar`, inside their existing "ข้อมูลหลัก" (master data) section's `items` array (the one that already has `สมุดผู้ติดต่อ → /contacts`):

```typescript
{ label: 'พนักงาน', path: '/employees', icon: Users },
```
Ensure `Users` is imported from `lucide-react` at the top of menu.ts (add if missing). Do NOT add to SALES/BRANCH_MANAGER/FINANCE_MANAGER/VIEWER configs.

- [ ] **Step 4: Typecheck** — `./tools/check-types.sh web` → OK. (Dialogs are imported but created in Tasks 3-4; if typecheck fails on missing imports, do Tasks 3-4 before typechecking — or stub the two dialog files first with minimal exports, then flesh out.)

> Practical ordering: create minimal stub files for the two dialogs (default export returning null) in this task so the page typechecks, then implement them in Tasks 3-4.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(employees-ui): EmployeesPage list + route + OWNER/ACCOUNTANT menu"`

---

## Task 3: `ProvisionEmployeeDialog`

**Files:** Create `apps/web/src/components/employees/ProvisionEmployeeDialog.tsx`

Pick a provisionable User (searchable), fill payroll fields, POST. Mirror `CreateContactModal` (useMutation + toast + invalidateQueries) + a debounced `provisionable` search list.

- [ ] **Step 1: Implement**

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Search } from 'lucide-react';
import { useDebounce } from '@/hooks/useDebounce';
import {
  employeeKeys, employeesApi,
  type EmploymentType, type ProvisionableUser,
} from '@/lib/api/employees';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const TYPES: { value: EmploymentType; label: string }[] = [
  { value: 'MONTHLY', label: 'รายเดือน' },
  { value: 'DAILY', label: 'รายวัน' },
  { value: 'CONTRACT', label: 'สัญญาจ้าง' },
];

export default function ProvisionEmployeeDialog({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search);
  const [picked, setPicked] = useState<ProvisionableUser | null>(null);
  const [position, setPosition] = useState('');
  const [employmentType, setEmploymentType] = useState<EmploymentType>('MONTHLY');
  const [baseSalary, setBaseSalary] = useState('');
  const [ssoEligible, setSsoEligible] = useState(true);

  const candidates = useQuery({
    queryKey: employeeKeys.provisionable(debounced),
    queryFn: () => employeesApi.provisionable(debounced || undefined),
    enabled: open && !picked,
  });

  function reset() {
    setSearch(''); setPicked(null); setPosition(''); setEmploymentType('MONTHLY');
    setBaseSalary(''); setSsoEligible(true);
  }

  const mutation = useMutation({
    mutationFn: () =>
      employeesApi.provision({
        userId: picked!.userId,
        position: position.trim() || undefined,
        employmentType,
        baseSalary: baseSalary ? parseFloat(baseSalary) : undefined,
        ssoEligible,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: employeeKeys.all });
      toast.success('เพิ่มพนักงานแล้ว');
      reset();
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'เพิ่มพนักงานไม่สำเร็จ');
    },
  });

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="leading-snug">เพิ่มพนักงาน</DialogTitle>
        </DialogHeader>

        {!picked ? (
          <div className="flex flex-col gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหาผู้ใช้ที่จะตั้งเป็นพนักงาน" className="pl-9" autoFocus />
            </div>
            <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto">
              {candidates.isLoading ? (
                <p className="text-sm text-muted-foreground py-2 leading-snug">กำลังค้นหา...</p>
              ) : (candidates.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground py-2 leading-snug">ไม่พบผู้ใช้ที่ยังไม่เป็นพนักงาน</p>
              ) : (
                (candidates.data ?? []).map((u) => (
                  <button key={u.userId} type="button" onClick={() => setPicked(u)}
                    className="flex items-center gap-2 rounded-md border border-border p-2.5 text-left hover:bg-accent transition-colors">
                    <span className="text-sm font-medium text-foreground leading-snug">{u.name}</span>
                    {u.nickname && <span className="text-xs text-muted-foreground">({u.nickname})</span>}
                    {u.employeeId && <span className="text-xs text-muted-foreground ml-auto">{u.employeeId}</span>}
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="rounded-md bg-muted px-3 py-2 text-sm leading-snug">
              ตั้ง <span className="font-medium">{picked.name}</span> เป็นพนักงาน{' '}
              <button type="button" className="text-primary hover:underline" onClick={() => setPicked(null)}>เปลี่ยน</button>
            </div>
            <div>
              <Label>ตำแหน่ง</Label>
              <Input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="เช่น พนักงานขาย" />
            </div>
            <div>
              <Label>ประเภทการจ้าง</Label>
              <select value={employmentType} onChange={(e) => setEmploymentType(e.target.value as EmploymentType)}
                className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background">
                {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <Label>ฐานเงินเดือน</Label>
              <Input type="number" step="0.01" value={baseSalary}
                onChange={(e) => setBaseSalary(e.target.value)} placeholder="0.00" />
            </div>
            <label className="flex items-center gap-2 text-sm leading-snug">
              <input type="checkbox" checked={ssoEligible} onChange={(e) => setSsoEligible(e.target.checked)} />
              เข้าประกันสังคม
            </label>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>ยกเลิก</Button>
          <Button disabled={!picked || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck** `./tools/check-types.sh web` → OK.
- [ ] **Step 3: Commit** — `git add -A && git commit -m "feat(employees-ui): ProvisionEmployeeDialog (pick user + payroll fields)"`

---

## Task 4: `EditEmployeeDialog`

**Files:** Create `apps/web/src/components/employees/EditEmployeeDialog.tsx`

Fetch detail (full nationalId, read-only) when `id` set; edit payroll fields + `resignedDate`; PATCH; soft-delete (DELETE) with confirm.

- [ ] **Step 1: Implement**

```tsx
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { employeeKeys, employeesApi, type EmploymentType } from '@/lib/api/employees';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const TYPES: EmploymentType[] = ['MONTHLY', 'DAILY', 'CONTRACT'];
const TYPE_LABEL: Record<EmploymentType, string> = { MONTHLY: 'รายเดือน', DAILY: 'รายวัน', CONTRACT: 'สัญญาจ้าง' };

export default function EditEmployeeDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const open = id !== null;
  const [confirmDel, setConfirmDel] = useState(false);
  const [form, setForm] = useState({ position: '', employmentType: 'MONTHLY' as EmploymentType, baseSalary: '', ssoEligible: true, bankName: '', bankAccountNo: '', resignedDate: '' });

  const detail = useQuery({
    queryKey: employeeKeys.detail(id ?? ''),
    queryFn: () => employeesApi.detail(id!),
    enabled: open,
  });

  useEffect(() => {
    const e = detail.data;
    if (e) setForm({
      position: e.position ?? '', employmentType: e.employmentType,
      baseSalary: e.baseSalary ?? '', ssoEligible: e.ssoEligible,
      bankName: e.bankName ?? '', bankAccountNo: e.bankAccountNo ?? '',
      resignedDate: e.resignedDate ? e.resignedDate.slice(0, 10) : '',
    });
  }, [detail.data]);

  const save = useMutation({
    mutationFn: () => employeesApi.update(id!, {
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
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
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
                <div><span className="text-muted-foreground">รหัสพนักงาน</span><div>{detail.data?.user.employeeId || '—'}</div></div>
                <div><span className="text-muted-foreground">เลขบัตร</span><div>{detail.data?.user.nationalId || '—'}</div></div>
              </div>
              <div><Label>ตำแหน่ง</Label><Input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} /></div>
              <div><Label>ประเภทการจ้าง</Label>
                <select value={form.employmentType} onChange={(e) => setForm({ ...form, employmentType: e.target.value as EmploymentType })}
                  className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background">
                  {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>ฐานเงินเดือน</Label><Input type="number" step="0.01" value={form.baseSalary} onChange={(e) => setForm({ ...form, baseSalary: e.target.value })} /></div>
                <div><Label>วันที่ลาออก</Label><Input type="date" value={form.resignedDate} onChange={(e) => setForm({ ...form, resignedDate: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>ธนาคาร</Label><Input value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} /></div>
                <div><Label>เลขบัญชี</Label><Input value={form.bankAccountNo} onChange={(e) => setForm({ ...form, bankAccountNo: e.target.value })} /></div>
              </div>
              <label className="flex items-center gap-2 text-sm leading-snug">
                <input type="checkbox" checked={form.ssoEligible} onChange={(e) => setForm({ ...form, ssoEligible: e.target.checked })} />
                เข้าประกันสังคม
              </label>
            </div>
          )}
          <DialogFooter className="justify-between">
            <Button variant="outline" className="text-destructive" onClick={() => setConfirmDel(true)}>นำออก</Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>ยกเลิก</Button>
              <Button disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'กำลังบันทึก...' : 'บันทึก'}</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmDel}
        onOpenChange={setConfirmDel}
        title="นำพนักงานออกจากระบบจ่าย"
        description={detail.data ? `นำ ${detail.data.user.name} ออกจากทะเบียนพนักงาน payroll? (ประวัติ payroll เดิมยังอยู่)` : ''}
        confirmLabel="นำออก"
        variant="destructive"
        loading={del.isPending}
        onConfirm={() => del.mutate()}
      />
    </>
  );
}
```

- [ ] **Step 2: Typecheck** → OK. **Commit** — `git add -A && git commit -m "feat(employees-ui): EditEmployeeDialog (edit payroll fields + soft-delete)"`

---

## Task 5: Tests

**Files:** Create `apps/web/src/pages/__tests__/EmployeesPage.test.tsx`

- [ ] **Step 1: Write tests** (mock `@/lib/api/employees` + `useAuth`; render with QueryClientProvider + MemoryRouter, mirror ContactDetailPage.test.tsx)

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import EmployeesPage from '../EmployeesPage';
import { useAuth } from '@/contexts/AuthContext';

vi.mock('@/lib/api/employees', () => ({
  employeeKeys: {
    all: ['employees'],
    list: (p: unknown) => ['employees', 'list', p],
    detail: (id: string) => ['employees', 'detail', id],
    provisionable: (s: string) => ['employees', 'provisionable', s],
  },
  employeesApi: { list: vi.fn(), detail: vi.fn(), provisionable: vi.fn(), provision: vi.fn(), update: vi.fn(), remove: vi.fn() },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: vi.fn() }));

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><EmployeesPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EmployeesPage', () => {
  it('renders the employee list rows', async () => {
    (useAuth as any).mockReturnValue({ user: { role: 'ACCOUNTANT' } });
    const { employeesApi } = await import('@/lib/api/employees');
    (employeesApi.list as any).mockResolvedValue({
      data: [{ id: 'e1', userId: 'u1', position: 'ช่าง', employmentType: 'MONTHLY', baseSalary: '15000',
        ssoEligible: true, bankName: null, bankAccountNo: null, taxIdOverride: null, note: null, resignedDate: null,
        user: { id: 'u1', name: 'สมชาย', nickname: 'ชาย', employeeId: 'EMP-001', nationalId: '•••••••••0001', startDate: null, branchId: null, isActive: true } }],
      total: 1, page: 1, limit: 50,
    });
    wrap();
    await waitFor(() => expect(screen.getByText('สมชาย')).toBeInTheDocument());
    expect(screen.getByText('ช่าง')).toBeInTheDocument();
    expect(screen.getByText('•••••••••0001')).toBeInTheDocument();
    // manage button visible for ACCOUNTANT
    expect(screen.getByRole('button', { name: /เพิ่มพนักงาน/ })).toBeInTheDocument();
  });

  it('hides the manage button for SALES', async () => {
    (useAuth as any).mockReturnValue({ user: { role: 'SALES' } });
    const { employeesApi } = await import('@/lib/api/employees');
    (employeesApi.list as any).mockResolvedValue({ data: [], total: 0, page: 1, limit: 50 });
    wrap();
    await waitFor(() => expect(screen.getByText('ไม่พบพนักงาน')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /เพิ่มพนักงาน/ })).not.toBeInTheDocument();
  });

  it('opens provision dialog and lists provisionable users', async () => {
    (useAuth as any).mockReturnValue({ user: { role: 'OWNER' } });
    const { employeesApi } = await import('@/lib/api/employees');
    (employeesApi.list as any).mockResolvedValue({ data: [], total: 0, page: 1, limit: 50 });
    (employeesApi.provisionable as any).mockResolvedValue([{ userId: 'u9', employeeId: 'EMP-009', name: 'ใหม่ มาก', nickname: null }]);
    const user = userEvent.setup();
    wrap();
    await waitFor(() => expect(screen.getByRole('button', { name: /เพิ่มพนักงาน/ })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /เพิ่มพนักงาน/ }));
    await waitFor(() => expect(screen.getByText('ใหม่ มาก')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run** — `npm --prefix apps/web run test -- src/pages/__tests__/EmployeesPage.test.tsx` → all pass. Fix any selector mismatches.
- [ ] **Step 3: Commit** — `git add -A && git commit -m "test(employees-ui): EmployeesPage list + RBAC + provision dialog"`

---

## Task 6: Full verify + PR

- [ ] **Step 1:** `npm --prefix apps/web run test -- src/pages/__tests__/EmployeesPage.test.tsx` → green
- [ ] **Step 2:** `./tools/check-types.sh web` → OK
- [ ] **Step 3:** Push + PR (controller does this after review):
```bash
git push -u origin feat/employee-master-ui
gh pr create --base main --head feat/employee-master-ui \
  --title "feat(employees): Employee Master page /employees (PR-B)" \
  --body "PR-B of Employee Master: /employees page (list+search), provision (pick a User → create profile), edit payroll fields + soft-delete. OWNER/ACCOUNTANT only. Web-only; tests mock the employees API. Depends at DEPLOY time on PR-A (#1151) endpoints being live. Tests green; web tsc OK."
```

---

## Self-Review checklist
- **Spec §3.1 coverage:** list (search, columns รหัส/ชื่อ/ตำแหน่ง/ประเภท/เลขบัตร/สถานะ) ✅; provision from existing User ✅; edit payroll fields + resignedDate ✅; soft-delete ✅; nationalId masked in list, full in edit-detail ✅; OWNER/ACCOUNTANT gating (page button + menu) ✅; route + menu ✅.
- **Deferred (correct):** EmployeeCombobox + payroll wiring = PR-C; bank pre-fill = PR-C.
- **Type consistency:** `employeesApi`/`employeeKeys` names match across page + dialogs + tests; `Employee`/`ProvisionableUser` shapes match PR-A's API.
- **Verify at execution:** exact `App.tsx` route nesting (mirror /customers); `DataTable` import is default vs named (check `components/ui/DataTable.tsx` export — plan assumes `default` + named `Column`); `Label` component path; `ConfirmDialog` prop names (mirror its use in ContactDetailPage). Fix by reading the referenced files.
