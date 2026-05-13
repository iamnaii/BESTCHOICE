# Other Income v2.2 PR-3 — Global Settings 5-Tab Consolidation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development with **3-4 review rounds per task** per owner preference.

**Goal:** Restructure `/settings` into the 5-tab hub specified in PDF v2.2 Task 4 (option C from brainstorm) — Company, VAT, Periods, Attachment, Users. Extract operational settings (Stickers, Collections, General) to dedicated routes. Add URL hash sync + `/accounting/periods` 301 redirect.

**Architecture:** `SettingsPage` becomes a Radix Tabs hub with 5 financial-settings tabs. Existing tab components (`SystemSettings`, `CompanySettings`, `GeneralSettings`, `StickerSettings`, `CollectionsConfigCard`) get reorganized: Company merges into Company tab, others extract to `/settings/stickers`, `/settings/collections`, `/settings/general` routes. New `VatTab` + `AttachmentTab` introduce 4 new SystemConfig keys with class-validator DTOs. PeriodsTab wraps existing `PeriodClosePage` logic (move table + close/reopen actions into a tab; keep `ReopenedPeriodBanner` rendering on list pages from PR-2). UsersTab hosts MakerCheckerToggle + link to `/users` page.

**Tech Stack:** React 18 + Vite + react-router v7 + @tanstack/react-query + shadcn/ui (`Tabs`, `Card`, `Switch`) + Tailwind + Sentry.

**Spec reference:** [`docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md`](../specs/2026-05-13-other-income-v2-2-design.md) §5 (Sprint 3).

**Codebase facts:**
- `SettingsPage` at `apps/web/src/pages/SettingsPage/index.tsx` — single-page list of cards backed by `/settings` API + `ConfigItem[]`.
- `MakerCheckerToggle` already installed (PR-2 Task 8) at top of SettingsPage.
- `PeriodClosePage` at `apps/web/src/pages/accounting/PeriodClosePage.tsx` already has ReopenPeriodModal wiring (PR-2 Task 10).
- shadcn `Tabs` component verified to exist (check `apps/web/src/components/ui/tabs.tsx`).
- App router: `apps/web/src/App.tsx` has existing routes for `/settings/companies`, `/settings/chart-of-accounts`, etc. (sub-routes already exist as siblings).

---

## File Structure

### Backend (modify)
- `apps/api/src/modules/settings/settings.service.ts` (or wherever `/settings` API lives) — seed 4 new SystemConfig keys at startup OR rely on first-write upsert.
- Optional: SQL seed file for the 4 new keys.

### Frontend (create)
- `apps/web/src/pages/SettingsPage/tabs/CompanyTab.tsx` — wraps existing `CompanySettings` content
- `apps/web/src/pages/SettingsPage/tabs/VatTab.tsx` — new (rate + default price type)
- `apps/web/src/pages/SettingsPage/tabs/PeriodsTab.tsx` — extracted from PeriodClosePage
- `apps/web/src/pages/SettingsPage/tabs/AttachmentTab.tsx` — new (threshold + allowed types)
- `apps/web/src/pages/SettingsPage/tabs/UsersTab.tsx` — MakerCheckerToggle + link
- `apps/web/src/pages/SettingsPage/StickersPage.tsx` — extracted standalone route
- `apps/web/src/pages/SettingsPage/CollectionsPage.tsx` — extracted standalone route
- `apps/web/src/pages/SettingsPage/GeneralSettingsPage.tsx` — extracted (banking + penalty + pdpa + payment_link)

### Frontend (modify)
- `apps/web/src/pages/SettingsPage/index.tsx` — full refactor to 5-tab Tabs structure + URL hash sync + permission guard
- `apps/web/src/App.tsx` — add new routes for `/settings/stickers`, `/settings/collections`, `/settings/general`; add redirect `/accounting/periods` → `/settings#periods`

### SystemConfig keys (seed via UI or migration)
- `VAT_RATE` = "7" (number string)
- `VAT_PRICE_TYPE_DEFAULT` = "exclusive" | "inclusive"
- `ATTACHMENT_REQUIRED_ABOVE_AMOUNT` = "0" (0 = optional)
- `ATTACHMENT_ALLOWED_TYPES` = "PDF, JPG, PNG"

---

## Task 1: Seed new SystemConfig keys

**Files:**
- Create: `apps/api/prisma/migrations/<timestamp>_seed_pr3_settings_keys/migration.sql`

- [ ] **Step 1: Create idempotent seed migration**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/oi-v2-2-pr1
TS=$(date -u +%Y%m%d%H%M%S)
mkdir -p apps/api/prisma/migrations/${TS}_seed_pr3_settings_keys
```

Locate the `system_configs` table @@map and column structure:

```bash
awk '/^model SystemConfig /,/^}/' apps/api/prisma/schema.prisma
```

Write `migration.sql` matching the actual columns (likely `id`, `key`, `value`, `description`, `created_at`, `updated_at`):

```sql
INSERT INTO "system_configs" ("id", "key", "value", "description", "created_at", "updated_at")
VALUES
  (gen_random_uuid(), 'VAT_RATE', '7', 'อัตรา VAT (%)', NOW(), NOW()),
  (gen_random_uuid(), 'VAT_PRICE_TYPE_DEFAULT', 'exclusive', 'ประเภทราคาเริ่มต้น (exclusive|inclusive)', NOW(), NOW()),
  (gen_random_uuid(), 'ATTACHMENT_REQUIRED_ABOVE_AMOUNT', '0', 'ยอดที่ต้องบังคับแนบเอกสาร (0=ไม่บังคับ)', NOW(), NOW()),
  (gen_random_uuid(), 'ATTACHMENT_ALLOWED_TYPES', 'PDF, JPG, PNG', 'ประเภทไฟล์ที่อนุญาต', NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;
```

Adjust columns to actual schema. Use `gen_random_uuid()` if PostgreSQL has the extension; else use explicit UUIDs.

- [ ] **Step 2: Apply locally + verify**

```bash
DATABASE_URL="postgresql://iamnaii@localhost:5432/bestchoice_oi_test" npx prisma migrate deploy
DATABASE_URL="postgresql://iamnaii@localhost:5432/bestchoice_oi_test" psql -c "SELECT key, value FROM system_configs WHERE key IN ('VAT_RATE', 'VAT_PRICE_TYPE_DEFAULT', 'ATTACHMENT_REQUIRED_ABOVE_AMOUNT', 'ATTACHMENT_ALLOWED_TYPES');"
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/prisma/migrations/
git commit -m "$(cat <<'EOF'
feat(settings): seed VAT + attachment SystemConfig keys (PR-3 Task 1)

4 new keys for /settings#vat and /settings#attachment tabs:
- VAT_RATE (default 7)
- VAT_PRICE_TYPE_DEFAULT (default exclusive)
- ATTACHMENT_REQUIRED_ABOVE_AMOUNT (default 0 = not required)
- ATTACHMENT_ALLOWED_TYPES (default PDF, JPG, PNG)

Idempotent via ON CONFLICT DO NOTHING.

Refs: docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md §5.2
EOF
)"
```

---

## Task 2: VatTab component

**Files:**
- Create: `apps/web/src/pages/SettingsPage/tabs/VatTab.tsx`

- [ ] **Step 1: Implement component**

```tsx
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ConfigItem } from '../components/shared';

type PriceType = 'exclusive' | 'inclusive';

export function VatTab() {
  const queryClient = useQueryClient();
  const [rate, setRate] = useState('7');
  const [priceType, setPriceType] = useState<PriceType>('exclusive');
  const [editing, setEditing] = useState(false);

  const { data: configs = [], isLoading } = useQuery<ConfigItem[]>({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });

  useEffect(() => {
    if (configs.length === 0 || editing) return;
    const r = configs.find((c) => c.key === 'VAT_RATE')?.value ?? '7';
    const p = (configs.find((c) => c.key === 'VAT_PRICE_TYPE_DEFAULT')?.value ?? 'exclusive') as PriceType;
    setRate(r);
    setPriceType(p);
  }, [configs, editing]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const items = [
        { key: 'VAT_RATE', value: rate },
        { key: 'VAT_PRICE_TYPE_DEFAULT', value: priceType },
      ];
      return api.patch('/settings', { items });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('บันทึก VAT สำเร็จ');
      setEditing(false);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">กำลังโหลด...</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>VAT (ภ.พ.30)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="vat-rate">อัตรา VAT (%)</Label>
          <Input
            id="vat-rate"
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={rate}
            onChange={(e) => { setRate(e.target.value); setEditing(true); }}
            disabled={saveMutation.isPending}
          />
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">ประเภทราคาเริ่มต้น</legend>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="priceType"
              value="exclusive"
              checked={priceType === 'exclusive'}
              onChange={() => { setPriceType('exclusive'); setEditing(true); }}
              disabled={saveMutation.isPending}
            />
            <span>ราคา ไม่รวม VAT (exclusive)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="priceType"
              value="inclusive"
              checked={priceType === 'inclusive'}
              onChange={() => { setPriceType('inclusive'); setEditing(true); }}
              disabled={saveMutation.isPending}
            />
            <span>ราคา รวม VAT แล้ว (inclusive)</span>
          </label>
        </fieldset>

        {editing && (
          <div className="flex gap-2">
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>บันทึก</Button>
            <Button variant="outline" onClick={() => setEditing(false)} disabled={saveMutation.isPending}>ยกเลิก</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Type-check + commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/oi-v2-2-pr1
./tools/check-types.sh web
git add apps/web/src/pages/SettingsPage/tabs/VatTab.tsx
git commit -m "feat(settings): VatTab — rate + default price type editor

Refs: docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md §5.2"
```

---

## Task 3: AttachmentTab component

**Files:**
- Create: `apps/web/src/pages/SettingsPage/tabs/AttachmentTab.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ConfigItem } from '../components/shared';

export function AttachmentTab() {
  const queryClient = useQueryClient();
  const [threshold, setThreshold] = useState('0');
  const [allowedTypes, setAllowedTypes] = useState('PDF, JPG, PNG');
  const [editing, setEditing] = useState(false);

  const { data: configs = [], isLoading } = useQuery<ConfigItem[]>({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });

  useEffect(() => {
    if (configs.length === 0 || editing) return;
    setThreshold(configs.find((c) => c.key === 'ATTACHMENT_REQUIRED_ABOVE_AMOUNT')?.value ?? '0');
    setAllowedTypes(configs.find((c) => c.key === 'ATTACHMENT_ALLOWED_TYPES')?.value ?? 'PDF, JPG, PNG');
  }, [configs, editing]);

  const saveMutation = useMutation({
    mutationFn: async () =>
      api.patch('/settings', {
        items: [
          { key: 'ATTACHMENT_REQUIRED_ABOVE_AMOUNT', value: threshold },
          { key: 'ATTACHMENT_ALLOWED_TYPES', value: allowedTypes },
        ],
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('บันทึกการตั้งค่าเอกสารแนบสำเร็จ');
      setEditing(false);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">กำลังโหลด...</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>เอกสารแนบ</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="att-threshold">ยอดที่ต้องบังคับแนบเอกสาร (บาท)</Label>
          <Input
            id="att-threshold"
            type="number"
            step="0.01"
            min="0"
            value={threshold}
            onChange={(e) => { setThreshold(e.target.value); setEditing(true); }}
            disabled={saveMutation.isPending}
          />
          <p className="text-xs text-muted-foreground">0 = ไม่บังคับแนบ. > 0 = บังคับแนบเมื่อยอดเอกสารเกินค่านี้.</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="att-types">ประเภทไฟล์ที่อนุญาต</Label>
          <Input
            id="att-types"
            value={allowedTypes}
            onChange={(e) => { setAllowedTypes(e.target.value); setEditing(true); }}
            placeholder="PDF, JPG, PNG"
            disabled={saveMutation.isPending}
          />
          <p className="text-xs text-muted-foreground">คั่นด้วยจุลภาค (,) เช่น "PDF, JPG, PNG"</p>
        </div>

        {editing && (
          <div className="flex gap-2">
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>บันทึก</Button>
            <Button variant="outline" onClick={() => setEditing(false)} disabled={saveMutation.isPending}>ยกเลิก</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Type-check + commit**

```bash
./tools/check-types.sh web
git add apps/web/src/pages/SettingsPage/tabs/AttachmentTab.tsx
git commit -m "feat(settings): AttachmentTab — threshold + allowed types editor

Refs: docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md §5.2"
```

---

## Task 4: CompanyTab + PeriodsTab + UsersTab wrappers

**Files:**
- Create: `apps/web/src/pages/SettingsPage/tabs/CompanyTab.tsx`
- Create: `apps/web/src/pages/SettingsPage/tabs/PeriodsTab.tsx`
- Create: `apps/web/src/pages/SettingsPage/tabs/UsersTab.tsx`

- [ ] **Step 1: CompanyTab — wraps existing CompanySettings**

```tsx
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import CompanySettings from '../components/CompanySettings';
import type { ConfigItem } from '../components/shared';

export function CompanyTab() {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [draftSignatureImage, setDraftSignatureImage] = useState('');
  const [draftSignerName, setDraftSignerName] = useState('');

  const { data: configs = [] } = useQuery<ConfigItem[]>({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });

  useEffect(() => {
    if (configs.length > 0 && !editingSection) {
      const map: Record<string, string> = {};
      configs.forEach((c) => { map[c.key] = c.value; });
      setValues(map);
    }
  }, [configs, editingSection]);

  const saveMutation = useMutation({
    mutationFn: async (items: { key: string; value: string }[]) => api.patch('/settings', { items }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('บันทึกสำเร็จ');
      setEditingSection(null);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const handleSave = (items: { key: string; value: string }[]) => {
    const finalItems = [
      ...items,
      { key: 'lessor_signature_image', value: draftSignatureImage },
      { key: 'lessor_signer_name', value: draftSignerName },
    ];
    saveMutation.mutate(finalItems);
  };

  const handleEdit = (sectionKey: string) => {
    setEditingSection(sectionKey);
    setDraftSignatureImage(values['lessor_signature_image'] || '');
    setDraftSignerName(values['lessor_signer_name'] || '');
  };

  return (
    <CompanySettings
      values={values}
      editingSection={editingSection}
      onEdit={handleEdit}
      onSave={handleSave}
      onCancel={() => setEditingSection(null)}
      isSaving={saveMutation.isPending}
      draftSignatureImage={draftSignatureImage}
      draftSignerName={draftSignerName}
      setDraftSignatureImage={setDraftSignatureImage}
      setDraftSignerName={setDraftSignerName}
    />
  );
}
```

- [ ] **Step 2: PeriodsTab — wraps PeriodClosePage**

The simplest approach: re-export PeriodClosePage as a component. Verify it's a default export and wrap:

```tsx
import PeriodClosePage from '@/pages/accounting/PeriodClosePage';

export function PeriodsTab() {
  return <PeriodClosePage />;
}
```

(If PeriodClosePage has `useDocumentTitle` set, it'll override the parent. Acceptable for now — Sprint 4 polish item.)

- [ ] **Step 3: UsersTab — MakerCheckerToggle + link**

```tsx
import { Link } from 'react-router';
import { MakerCheckerToggle } from '../components/MakerCheckerToggle';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Users } from 'lucide-react';

export function UsersTab() {
  return (
    <div className="space-y-4">
      <MakerCheckerToggle />

      <Card>
        <CardHeader>
          <CardTitle>จัดการผู้ใช้งาน</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">
            จัดการบัญชีผู้ใช้งาน บทบาท และสิทธิ์การเข้าถึง
          </p>
          <Button asChild variant="outline">
            <Link to="/users" className="inline-flex items-center gap-2">
              <Users size={16} />
              ไปยังหน้าผู้ใช้งาน
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Type-check + commit**

```bash
./tools/check-types.sh web
git add apps/web/src/pages/SettingsPage/tabs/CompanyTab.tsx \
        apps/web/src/pages/SettingsPage/tabs/PeriodsTab.tsx \
        apps/web/src/pages/SettingsPage/tabs/UsersTab.tsx
git commit -m "feat(settings): CompanyTab + PeriodsTab + UsersTab wrappers

CompanyTab wraps CompanySettings with local state.
PeriodsTab re-exports PeriodClosePage as a tab.
UsersTab hosts MakerCheckerToggle + link to /users page.

Refs: docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md §5.2"
```

---

## Task 5: SettingsPage refactor to 5-tab Tabs

**Files:**
- Modify: `apps/web/src/pages/SettingsPage/index.tsx`

- [ ] **Step 1: Verify shadcn Tabs exists**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/oi-v2-2-pr1
ls apps/web/src/components/ui/tabs.tsx
```

- [ ] **Step 2: Replace SettingsPage body**

Replace `apps/web/src/pages/SettingsPage/index.tsx` content with:

```tsx
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/ui/PageHeader';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CompanyTab } from './tabs/CompanyTab';
import { VatTab } from './tabs/VatTab';
import { PeriodsTab } from './tabs/PeriodsTab';
import { AttachmentTab } from './tabs/AttachmentTab';
import { UsersTab } from './tabs/UsersTab';

const TAB_IDS = ['company', 'vat', 'periods', 'attachment', 'users'] as const;
type TabId = typeof TAB_IDS[number];

function readHash(): TabId {
  const h = (typeof window !== 'undefined' ? window.location.hash.slice(1) : '') as TabId;
  return TAB_IDS.includes(h) ? h : 'company';
}

export default function SettingsPage() {
  useDocumentTitle('ตั้งค่าระบบ');
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>(readHash());

  // Permission guard — Sprint 2 placed MakerCheckerToggle on this page, so user.role === OWNER assumed for full access
  if (user && user.role !== 'OWNER') {
    return <Navigate to="/" replace />;
  }

  // Sync URL hash <-> activeTab
  useEffect(() => {
    if (window.location.hash.slice(1) !== activeTab) {
      window.history.replaceState(null, '', `#${activeTab}`);
    }
  }, [activeTab]);

  // React to back/forward
  useEffect(() => {
    const handler = () => setActiveTab(readHash());
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  return (
    <div>
      <PageHeader title="ตั้งค่าระบบ" subtitle="กำหนดพารามิเตอร์การทำงานของระบบ" />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)}>
        <TabsList className="grid grid-cols-2 md:grid-cols-5 mb-4">
          <TabsTrigger value="company">บริษัท</TabsTrigger>
          <TabsTrigger value="vat">VAT</TabsTrigger>
          <TabsTrigger value="periods">งวดบัญชี</TabsTrigger>
          <TabsTrigger value="attachment">เอกสารแนบ</TabsTrigger>
          <TabsTrigger value="users">ผู้ใช้งาน</TabsTrigger>
        </TabsList>

        <TabsContent value="company"><CompanyTab /></TabsContent>
        <TabsContent value="vat"><VatTab /></TabsContent>
        <TabsContent value="periods"><PeriodsTab /></TabsContent>
        <TabsContent value="attachment"><AttachmentTab /></TabsContent>
        <TabsContent value="users"><UsersTab /></TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

```bash
./tools/check-types.sh web
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/SettingsPage/index.tsx
git commit -m "$(cat <<'EOF'
feat(settings): refactor SettingsPage into 5-tab hub (PR-3 Task 5)

5 tabs: Company / VAT / Periods / Attachment / Users.
URL hash sync (/settings#vat etc.) for bookmarkable tab state.
Listens to hashchange for browser back/forward.
Permission guard — non-OWNER redirected to /.

Operational settings (Stickers/Collections/General) moved to dedicated
routes in subsequent Task 6.

Refs: docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md §5
EOF
)"
```

---

## Task 6: Extract Stickers + Collections + General to routes

**Files:**
- Create: `apps/web/src/pages/SettingsPage/StickersPage.tsx`
- Create: `apps/web/src/pages/SettingsPage/CollectionsPage.tsx`
- Create: `apps/web/src/pages/SettingsPage/GeneralSettingsPage.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: StickersPage wrapper**

```tsx
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import StickerSettings from './components/StickerSettings';
import type { ConfigItem } from './components/shared';

export default function StickersPage() {
  useDocumentTitle('สติกเกอร์ — ตั้งค่า');
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [editingSection, setEditingSection] = useState<string | null>(null);

  const { data: configs = [] } = useQuery<ConfigItem[]>({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });

  useEffect(() => {
    if (configs.length > 0 && !editingSection) {
      const map: Record<string, string> = {};
      configs.forEach((c) => { map[c.key] = c.value; });
      setValues(map);
    }
  }, [configs, editingSection]);

  const saveMutation = useMutation({
    mutationFn: async (items: { key: string; value: string }[]) => api.patch('/settings', { items }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('บันทึกสำเร็จ');
      setEditingSection(null);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <div>
      <PageHeader title="สติกเกอร์" subtitle="ตั้งค่าเริ่มต้นสำหรับสติกเกอร์เอกสาร" />
      <StickerSettings
        values={values}
        editingSection={editingSection}
        onEdit={setEditingSection}
        onSave={(items) => saveMutation.mutate(items)}
        onCancel={() => setEditingSection(null)}
        isSaving={saveMutation.isPending}
      />
    </div>
  );
}
```

- [ ] **Step 2: CollectionsPage wrapper**

```tsx
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import CollectionsConfigCard from './components/CollectionsConfigCard';

export default function CollectionsPage() {
  useDocumentTitle('การเก็บหนี้ — ตั้งค่า');
  return (
    <div>
      <PageHeader title="การเก็บหนี้" subtitle="พารามิเตอร์ของ auto-assign + session" />
      <CollectionsConfigCard />
    </div>
  );
}
```

- [ ] **Step 3: GeneralSettingsPage wrapper (banking + penalty + pdpa + payment_link)**

The existing GeneralSettings component is rendered TWICE in old SettingsPage with `slot="pre"` (penalty + pdpa, before Company) and `slot="post"` (banking + payment_link, after Company). Replicate that:

```tsx
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import GeneralSettings from './components/GeneralSettings';
import type { ConfigItem } from './components/shared';

export default function GeneralSettingsPage() {
  useDocumentTitle('ตั้งค่าทั่วไป');
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [editingSection, setEditingSection] = useState<string | null>(null);

  const { data: configs = [] } = useQuery<ConfigItem[]>({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });

  useEffect(() => {
    if (configs.length > 0 && !editingSection) {
      const map: Record<string, string> = {};
      configs.forEach((c) => { map[c.key] = c.value; });
      setValues(map);
    }
  }, [configs, editingSection]);

  const saveMutation = useMutation({
    mutationFn: async (items: { key: string; value: string }[]) => api.patch('/settings', { items }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('บันทึกสำเร็จ');
      setEditingSection(null);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <div className="space-y-5">
      <PageHeader title="ตั้งค่าทั่วไป" subtitle="ค่าปรับ, PDPA, ข้อมูลธนาคาร, link ชำระเงิน" />
      <GeneralSettings
        slot="pre"
        values={values}
        editingSection={editingSection}
        onEdit={setEditingSection}
        onSave={(items) => saveMutation.mutate(items)}
        onCancel={() => setEditingSection(null)}
        isSaving={saveMutation.isPending}
      />
      <GeneralSettings
        slot="post"
        values={values}
        editingSection={editingSection}
        onEdit={setEditingSection}
        onSave={(items) => saveMutation.mutate(items)}
        onCancel={() => setEditingSection(null)}
        isSaving={saveMutation.isPending}
      />
    </div>
  );
}
```

- [ ] **Step 4: Add routes in App.tsx**

```bash
grep -n "Settings\|/settings\|lazy" apps/web/src/App.tsx | head -10
```

Add lazy-loaded routes near the existing settings sub-routes:

```tsx
const StickersPage = lazy(() => import('@/pages/SettingsPage/StickersPage'));
const CollectionsPage = lazy(() => import('@/pages/SettingsPage/CollectionsPage'));
const GeneralSettingsPage = lazy(() => import('@/pages/SettingsPage/GeneralSettingsPage'));

// In routes JSX:
<Route path="/settings/stickers" element={<ProtectedRoute><MainLayout><StickersPage /></MainLayout></ProtectedRoute>} />
<Route path="/settings/collections" element={<ProtectedRoute><MainLayout><CollectionsPage /></MainLayout></ProtectedRoute>} />
<Route path="/settings/general" element={<ProtectedRoute><MainLayout><GeneralSettingsPage /></MainLayout></ProtectedRoute>} />
```

Match existing ProtectedRoute / MainLayout / Suspense wrapper pattern in the file.

- [ ] **Step 5: Type-check + commit**

```bash
./tools/check-types.sh web
git add apps/web/src/pages/SettingsPage/StickersPage.tsx \
        apps/web/src/pages/SettingsPage/CollectionsPage.tsx \
        apps/web/src/pages/SettingsPage/GeneralSettingsPage.tsx \
        apps/web/src/App.tsx
git commit -m "$(cat <<'EOF'
feat(settings): extract operational tabs to dedicated routes (PR-3 Task 6)

- /settings/stickers — StickerSettings
- /settings/collections — CollectionsConfigCard
- /settings/general — GeneralSettings pre+post (banking, penalty, pdpa, payment_link)

5-tab /settings is now accounting-focused (per option C consolidation).
Operational settings live in dedicated routes accessible from sidebar.

Refs: docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md §5.3
EOF
)"
```

---

## Task 7: URL redirect /accounting/periods → /settings#periods

**Files:**
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Add redirect route**

Find the existing `<Route path="/accounting/periods" .../>` line in App.tsx. Replace its element with a redirect:

```tsx
import { Navigate } from 'react-router';

<Route path="/accounting/periods" element={<Navigate to="/settings#periods" replace />} />
```

(Note: `react-router` v7 client-side Navigate doesn't include hash in default behavior — verify the hash transfers. If not, use a custom redirect component:

```tsx
function PeriodsRedirect() {
  useEffect(() => {
    window.location.replace('/settings#periods');
  }, []);
  return null;
}

<Route path="/accounting/periods" element={<PeriodsRedirect />} />
```

)

- [ ] **Step 2: Type-check + commit**

```bash
./tools/check-types.sh web
git add apps/web/src/App.tsx
git commit -m "feat(settings): redirect /accounting/periods → /settings#periods

Per PDF AC-4.4 — backward compat for users with bookmarks.

Refs: docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md §5.4"
```

---

## Task 8: Final verification + docs

- [ ] **Step 1: Full type check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.worktrees/oi-v2-2-pr1
./tools/check-types.sh all
```

- [ ] **Step 2: Web tests**

```bash
cd apps/web && npx vitest run \
  src/pages/SettingsPage/components/__tests__/ \
  src/pages/accounting/components/__tests__/ \
  src/components/accounting/__tests__/ \
  src/pages/other-income/components/__tests__/ \
  src/components/ui/__tests__/PaginationBar.test.tsx \
  src/hooks/__tests__/usePaginationParams.test.tsx 2>&1 | tail -5
```

- [ ] **Step 3: API tests (smoke)**

```bash
cd ../api && DATABASE_URL="postgresql://iamnaii@localhost:5432/bestchoice_oi_test" npx jest src/modules/accounting/ src/modules/other-income/ 2>&1 | tail -5
```

- [ ] **Step 4: Append docs**

Append to `.claude/rules/accounting.md` after the existing "Reopen Period workflow" section:

```markdown

### Settings UI consolidation

`/settings` is the 5-tab hub for system-wide configuration:
- `#company` — CompanyInfo (name, address, tax ID, signer)
- `#vat` — `VAT_RATE` + `VAT_PRICE_TYPE_DEFAULT` (exclusive/inclusive)
- `#periods` — AccountingPeriod table (close/reopen actions)
- `#attachment` — `ATTACHMENT_REQUIRED_ABOVE_AMOUNT` + `ATTACHMENT_ALLOWED_TYPES`
- `#users` — MakerCheckerToggle + link to /users

Operational settings live at dedicated routes:
- `/settings/stickers` — StickerSettings
- `/settings/collections` — CollectionsConfigCard
- `/settings/general` — Banking, penalty, PDPA, payment_link

`/accounting/periods` redirects to `/settings#periods` for backward compatibility. Permission: OWNER only on `/settings` root.
```

- [ ] **Step 5: Commit docs**

```bash
git add .claude/rules/accounting.md
git commit -m "docs(accounting): document Settings 5-tab consolidation

Refs: docs/superpowers/specs/2026-05-13-other-income-v2-2-design.md §5"
```
