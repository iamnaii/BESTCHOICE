# P4-SP3: ตั้งค่าเอกสาร 8 doc types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace 8 separate ComingSoonPage routes for doc-config sub-types with a single tabbed UI on `/settings/document-config` page.

**Architecture:** Extend the existing `DocumentConfigPage` (D1.1.2.x SystemConfig backend) to support per-doc-type config via Tabs UI. Each tab edits 1 row in SystemConfig with key `doc_config:<type>`. URL query `?tab=<type>` deep-links from menu items.

**Tech Stack:** React 18 + TypeScript + @tanstack/react-query + shadcn/ui Tabs

---

## File Structure

**Frontend:**
- Modify: `apps/web/src/pages/DocumentConfigPage.tsx` (rewrite as Tabs-based)
- Modify: `apps/web/src/App.tsx` — remove 8 ComingSoonPage routes for sub-paths

**Backend:**
- Modify: `apps/api/src/modules/system-config/system-config.service.ts` — accept new doc-type keys
- Modify: `apps/api/src/modules/system-config/system-config.service.spec.ts`

**Config:**
- Modify: `apps/web/src/config/menu.ts` — sub-items keep paths but all open same page via tab deep-link

---

## Task 1: Backend — SystemConfig key whitelist extension

**Files:**
- Modify: `apps/api/src/modules/system-config/system-config.service.ts`
- Modify: `apps/api/src/modules/system-config/system-config.service.spec.ts`

- [ ] **Step 1.1: Locate the key whitelist constant**

```bash
grep -n "ALLOWED_KEYS\|VALID_KEYS\|whitelist\|doc_config" apps/api/src/modules/system-config/system-config.service.ts | head -10
```

- [ ] **Step 1.2: Add 8 new keys**

Add to the existing key whitelist (likely an array or Set):

```typescript
'doc_config:deposit-receipt',
'doc_config:receipt',
'doc_config:credit-note',
'doc_config:purchase-order',
'doc_config:expense-doc',
'doc_config:credit-note-received',
'doc_config:payment-summary',
'doc_config:asset-purchase',
```

- [ ] **Step 1.3: Add test ensuring keys are accepted**

```typescript
describe('SystemConfig — doc-type keys', () => {
  it.each([
    'doc_config:deposit-receipt',
    'doc_config:receipt',
    'doc_config:credit-note',
    'doc_config:purchase-order',
    'doc_config:expense-doc',
    'doc_config:credit-note-received',
    'doc_config:payment-summary',
    'doc_config:asset-purchase',
  ])('accepts key %s', async (key) => {
    const cfg = { prefix: 'DR', resetCycle: 'monthly', startNumber: 1 };
    await expect(service.set(key, JSON.stringify(cfg))).resolves.toBeDefined();
  });
});
```

- [ ] **Step 1.4: Run + commit**

```bash
cd apps/api && npx jest system-config.service.spec
git commit -am "feat(p4-sp3): whitelist 8 new doc-config keys in SystemConfig"
```

---

## Task 2: Frontend — Rewrite DocumentConfigPage with Tabs

**Files:**
- Modify: `apps/web/src/pages/DocumentConfigPage.tsx`

- [ ] **Step 2.1: Replace page body**

```tsx
// apps/web/src/pages/DocumentConfigPage.tsx
import { useSearchParams } from 'react-router';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import PageHeader from '@/components/ui/PageHeader';
import { FileText } from 'lucide-react';
import DocTypeConfigForm from '@/pages/settings/DocTypeConfigForm';

const TAB_CONFIG: { key: string; label: string; type: 'revenue' | 'expense' }[] = [
  { key: 'numbering', label: 'เลขที่/รูปแบบทั่วไป', type: 'revenue' },
  // รายรับ
  { key: 'deposit-receipt', label: 'ใบรับเงินมัดจำ', type: 'revenue' },
  { key: 'receipt', label: 'ใบเสร็จรับเงิน', type: 'revenue' },
  { key: 'credit-note', label: 'ใบลดหนี้', type: 'revenue' },
  // รายจ่าย
  { key: 'purchase-order', label: 'ใบสั่งซื้อ (PO)', type: 'expense' },
  { key: 'expense-doc', label: 'ค่าใช้จ่าย', type: 'expense' },
  { key: 'credit-note-received', label: 'รับใบลดหนี้', type: 'expense' },
  { key: 'payment-summary', label: 'ใบรวมจ่าย', type: 'expense' },
  { key: 'asset-purchase', label: 'ซื้อสินทรัพย์', type: 'expense' },
];

export default function DocumentConfigPage() {
  const [params, setParams] = useSearchParams();
  const activeTab = params.get('tab') ?? 'numbering';

  return (
    <div className="space-y-6">
      <PageHeader title="ตั้งค่าเอกสาร" icon={FileText} />
      <Tabs value={activeTab} onValueChange={(v) => setParams({ tab: v })}>
        <TabsList className="flex-wrap h-auto">
          {TAB_CONFIG.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>
          ))}
        </TabsList>
        {TAB_CONFIG.map((t) => (
          <TabsContent key={t.key} value={t.key}>
            <DocTypeConfigForm typeKey={t.key} label={t.label} category={t.type} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 2.2: Commit (form component next)**

```bash
git add apps/web/src/pages/DocumentConfigPage.tsx
git commit -m "feat(p4-sp3): DocumentConfigPage — tabbed shell for 9 doc types"
```

---

## Task 3: Frontend — DocTypeConfigForm component

**Files:**
- Create: `apps/web/src/pages/settings/DocTypeConfigForm.tsx`

- [ ] **Step 3.1: Create reusable form**

```tsx
// apps/web/src/pages/settings/DocTypeConfigForm.tsx
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Save } from 'lucide-react';
import { toast } from 'sonner';

interface DocTypeConfig {
  prefix: string;
  pattern: 'PREFIX-YYYYMMDD-NNNN' | 'PREFIX-YYMM-NNNN' | 'PREFIX-YYYY-NNNN';
  resetCycle: 'daily' | 'monthly' | 'yearly' | 'never';
  startNumber: number;
  footerNote?: string;
  requiresApproval: boolean;
  approverRoles: string[];
  attachmentRequired: boolean;
}

const DEFAULT: DocTypeConfig = { prefix: '', pattern: 'PREFIX-YYYYMMDD-NNNN', resetCycle: 'monthly', startNumber: 1, footerNote: '', requiresApproval: false, approverRoles: [], attachmentRequired: false };

interface Props { typeKey: string; label: string; category: 'revenue' | 'expense' }

export default function DocTypeConfigForm({ typeKey, label }: Props) {
  const qc = useQueryClient();
  const cfgKey = typeKey === 'numbering' ? 'doc_number_format' : `doc_config:${typeKey}`;
  const query = useQuery({
    queryKey: ['system-config', cfgKey],
    queryFn: () => api.get<{ value: string | null }>(`/system-config?key=${cfgKey}`).then((r) => r.data),
  });
  const [draft, setDraft] = useState<DocTypeConfig>(DEFAULT);

  useEffect(() => {
    if (query.data?.value) {
      try { setDraft({ ...DEFAULT, ...JSON.parse(query.data.value) }); }
      catch { setDraft(DEFAULT); }
    }
  }, [query.data]);

  const save = useMutation({
    mutationFn: () => api.put('/system-config', { key: cfgKey, value: JSON.stringify(draft) }),
    onSuccess: () => { toast.success(`บันทึก ${label} สำเร็จ`); qc.invalidateQueries({ queryKey: ['system-config', cfgKey] }); },
    onError: () => toast.error('บันทึกล้มเหลว'),
  });

  return (
    <QueryBoundary query={query}>
      {() => (
        <Card>
          <CardHeader><h3 className="font-semibold">ตั้งค่า: {label}</h3></CardHeader>
          <CardContent className="grid md:grid-cols-2 gap-4">
            <Field label="คำนำหน้าเลขที่"><input className="w-full border rounded p-2 bg-card font-mono" value={draft.prefix} onChange={(e) => setDraft({ ...draft, prefix: e.target.value })} placeholder="เช่น RC, INV, DR..." /></Field>
            <Field label="รูปแบบเลขรัน">
              <select className="w-full border rounded p-2 bg-card" value={draft.pattern} onChange={(e) => setDraft({ ...draft, pattern: e.target.value as DocTypeConfig['pattern'] })}>
                <option value="PREFIX-YYYYMMDD-NNNN">PREFIX-YYYYMMDD-NNNN</option>
                <option value="PREFIX-YYMM-NNNN">PREFIX-YYMM-NNNN</option>
                <option value="PREFIX-YYYY-NNNN">PREFIX-YYYY-NNNN</option>
              </select>
            </Field>
            <Field label="รอบรีเซ็ตเลข">
              <select className="w-full border rounded p-2 bg-card" value={draft.resetCycle} onChange={(e) => setDraft({ ...draft, resetCycle: e.target.value as DocTypeConfig['resetCycle'] })}>
                <option value="daily">รายวัน</option>
                <option value="monthly">รายเดือน</option>
                <option value="yearly">รายปี</option>
                <option value="never">ไม่รีเซ็ต</option>
              </select>
            </Field>
            <Field label="เลขเริ่มต้น"><input type="number" className="w-full border rounded p-2 bg-card font-mono" value={draft.startNumber} onChange={(e) => setDraft({ ...draft, startNumber: parseInt(e.target.value, 10) || 1 })} /></Field>
            <Field label="ข้อความท้ายเอกสาร" className="md:col-span-2"><textarea className="w-full border rounded p-2 bg-card text-sm" rows={2} value={draft.footerNote ?? ''} onChange={(e) => setDraft({ ...draft, footerNote: e.target.value })} placeholder="เช่น เงื่อนไขการชำระ, หมายเลขบัญชี..." /></Field>
            <Field label="ต้องอนุมัติก่อนบันทึก"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.requiresApproval} onChange={(e) => setDraft({ ...draft, requiresApproval: e.target.checked })} />เปิดใช้</label></Field>
            <Field label="ต้องแนบเอกสาร"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.attachmentRequired} onChange={(e) => setDraft({ ...draft, attachmentRequired: e.target.checked })} />เปิดใช้</label></Field>
            <div className="md:col-span-2 flex justify-end pt-2 border-t">
              <Button onClick={() => save.mutate()} disabled={save.isPending}><Save className="size-4 mr-1.5" />บันทึก</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </QueryBoundary>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={className}><label className="text-sm font-medium block mb-1.5">{label}</label>{children}</div>;
}
```

- [ ] **Step 3.2: Commit**

```bash
git add apps/web/src/pages/settings/DocTypeConfigForm.tsx
git commit -m "feat(p4-sp3): DocTypeConfigForm — reusable config form per doc type"
```

---

## Task 4: Remove 8 ComingSoonPage routes from App.tsx

**Files:**
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 4.1: Remove the 8 doc-config sub-routes added in PR #1026**

Delete the 8 `<Route path="/settings/document-config/...">` blocks. They're not needed — the menu items deep-link via `?tab=` instead.

- [ ] **Step 4.2: Update menu.ts — point sub-items to deep-links**

Change each sub-item in `owner-doc-config.items[].children`:

```ts
// Before
{ label: 'ใบรับเงินมัดจำ', path: '/settings/document-config/deposit-receipt', icon: Receipt, placeholder: { ... } },

// After
{ label: 'ใบรับเงินมัดจำ', path: '/settings/document-config?tab=deposit-receipt', icon: Receipt },
```

Repeat for all 8 sub-items. Remove all `placeholder` markers in this section.

- [ ] **Step 4.3: Verify + commit**

```bash
cd apps/web && npx tsc --noEmit
git commit -am "feat(p4-sp3): wire doc-config sub-items to tab deep-links"
```

---

## Task 5: Smoke test

**Files:**
- Create: `apps/web/src/pages/__tests__/DocumentConfigPage.test.tsx`

- [ ] **Step 5.1: Write smoke test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import DocumentConfigPage from '../DocumentConfigPage';

vi.mock('@/lib/api', () => ({ default: { get: vi.fn().mockResolvedValue({ data: { value: null } }), put: vi.fn() } }));

describe('DocumentConfigPage', () => {
  it('renders 9 tabs', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><MemoryRouter><DocumentConfigPage /></MemoryRouter></QueryClientProvider>);
    expect(screen.getByText('เลขที่/รูปแบบทั่วไป')).toBeInTheDocument();
    expect(screen.getByText('ใบรับเงินมัดจำ')).toBeInTheDocument();
    expect(screen.getByText('ใบเสร็จรับเงิน')).toBeInTheDocument();
    expect(screen.getByText('ใบลดหนี้')).toBeInTheDocument();
    expect(screen.getByText('ใบสั่งซื้อ (PO)')).toBeInTheDocument();
    expect(screen.getByText('ค่าใช้จ่าย')).toBeInTheDocument();
    expect(screen.getByText('รับใบลดหนี้')).toBeInTheDocument();
    expect(screen.getByText('ใบรวมจ่าย')).toBeInTheDocument();
    expect(screen.getByText('ซื้อสินทรัพย์')).toBeInTheDocument();
  });
});
```

- [ ] **Step 5.2: Run + commit**

```bash
cd apps/web && npx vitest run src/pages/__tests__/DocumentConfigPage.test.tsx
git add apps/web/src/pages/__tests__/DocumentConfigPage.test.tsx
git commit -m "test(p4-sp3): DocumentConfigPage 9-tab smoke test"
```

---

## Task 6: Final verification + version bump

- [ ] **Step 6.1: TS + lint + build + tests**

```bash
cd apps/web && npx tsc --noEmit && npm run lint && npm run build && npx vitest run
cd apps/api && npx tsc --noEmit && npx jest system-config
```

- [ ] **Step 6.2: Bump version + PR**

`apps/web/package.json`: bump patch by 1.

```bash
git commit -am "chore: bump web for P4-SP3 deploy"
gh pr create --base main --title "feat(p4-sp3): ตั้งค่าเอกสาร 8 doc types (tabbed UI)"
```

---

## Acceptance Criteria

- [ ] `/settings/document-config` renders 9 tabs (1 numbering + 8 doc types)
- [ ] URL `?tab=<type>` opens the matching tab on load
- [ ] All 8 menu sub-items navigate to the same page with the correct tab active
- [ ] Each tab saves to SystemConfig key `doc_config:<type>` (or `doc_number_format` for first tab)
- [ ] No `ComingSoonPage` route remains for the 8 sub-paths
- [ ] No `placeholder` marker remains on the 8 menu sub-items
- [ ] TypeScript: 0 errors · ESLint: 0 errors · Build: success
- [ ] Vitest: pass · Jest API: pass
- [ ] Web version bumped

---

## Dependencies

**Depends on:** Existing SystemConfig backend (D1.1.2.x) + DocumentConfigPage stub.
**Provides:** Nothing — pure UI work, no downstream consumers.

## Estimated Effort

2-3 days. 6 tasks. Tab UI is fast once `DocTypeConfigForm` is reusable.
