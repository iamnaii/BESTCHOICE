# Other Income Module v2.1 → v2.2 — Design

**Date:** 2026-05-13
**Source:** `other-income-dev-tasks-v2-2.pdf` (12/5/2569, BESTCHOICE FINANCE)
**Scope:** 5 tasks across 3 sprints, ~3 weeks
**Strategy:** Implement ตาม PDF เป๊ะ ทั้ง 5 ข้อ — Sprint 1: Task 1+5 → Sprint 2: Task 2+3 → Sprint 3: Task 4

---

## 1. Context & Codebase State

PDF v2.2 ระบุ 5 tasks แต่ codebase ปัจจุบันมี infrastructure บางส่วนพร้อมแล้ว สำรวจไว้:

| PDF Task | สถานะปัจจุบัน | งานที่ต้องทำ |
|---|---|---|
| 1. Override JV V1/V2/V5 + Audit | `OtherIncome.is_overridden` field มี + `ValidationService` V1-V14 มี | UI override toggle + DTO รับ override lines + audit JV_OVERRIDDEN + ✏ marker |
| 2. Maker-Checker Toggle UI | SystemConfig key + endpoint + test suite ครบ | UI toggle + confirmation dialog + CONFIG_CHANGED audit |
| 3. Reopen Period Workflow | Model fields + reopenPeriod service + PeriodClosePage UI มี | Reason modal + banner + PERIOD_REOPENED enum |
| 4. Global Settings 5 Tabs | SettingsPage มี + sub-routes แยก | Restructure เป็น 5 tabs + extract routes + 301 redirect |
| 5. Pagination ทุก list page | OtherIncome/Expense/AuditLog paginate แล้ว (offset) | Shared PaginationBar + URL params + size selector |

User เลือก **option C** สำหรับ Task 4 (PDF interpretation ตรงตัว): `/settings` เป็น 5-tab hub แบบ accounting-focused — Stickers/Collections/General ย้ายไป route แยก

User เลือก **option A** สำหรับ sprint order: ตาม PDF Sprint Plan เป๊ะ (1→5→2→3→4)

---

## 2. Technical Decisions

ตัดสินใจล่วงหน้าเพื่อไม่บล็อก implementation:

| Decision | Choice | Rationale |
|---|---|---|
| Override JV audit storage | JSON ใน `AuditLog.metadata` | AuditLog append-only ตาม `.claude/rules/database.md` — ไม่เพิ่ม column |
| Maker-Checker SystemConfig key | `OTHER_INCOME_MAKER_CHECKER_ENABLED` (เดิม) | test suite + endpoint มีอยู่แล้ว — ไม่ rename |
| Period auto-close 48h (Task 3 optional) | **Skip** | เสี่ยง close งวดเปิดอยู่ระหว่าง user ทำงาน |
| Pagination URL params | `?page=3&size=50` | bookmarkable per PDF spec |
| Cache invalidation | react-query `invalidateQueries` | ไม่ใช้ WebSocket — overkill |
| Visual marker (✏) ใน List | render conditional on `doc.isOverridden` | ไม่ต้อง schema change (field มีอยู่) |

---

## 3. Sprint 1 (Week 1) — Task 1 + Task 5

### 3.1 Task 1 — Override JV with V1/V2/V5 Validation

**Backend changes:**

**File:** `apps/api/src/modules/other-income/dto/post-other-income.dto.ts`

เพิ่ม optional field สำหรับ override:
```ts
@IsOptional()
@ValidateNested({ each: true })
@Type(() => OverrideJournalLineDto)
overrideJournalLines?: OverrideJournalLineDto[];

// New nested DTO
class OverrideJournalLineDto {
  @IsString() accountCode: string;
  @IsDecimal() @IsOptional() debitAmount?: string;
  @IsDecimal() @IsOptional() creditAmount?: string;
  @IsString() @IsOptional() lineNote?: string;
}
```

**File:** `apps/api/src/modules/other-income/services/journal-override.service.ts` (ใหม่)

```ts
@Injectable()
export class JournalOverrideService {
  validateOverride(lines: JournalLineInput[]): void {
    // V2 — at least 2 lines
    if (lines.length < 2) {
      throw new BadRequestException({ rule: 'V2', message: 'ต้องมีอย่างน้อย 2 บรรทัด' });
    }

    // V5 — Dr XOR Cr per line
    for (const line of lines) {
      const dr = new Decimal(line.debitAmount || 0);
      const cr = new Decimal(line.creditAmount || 0);
      const hasDr = dr.gt(0);
      const hasCr = cr.gt(0);
      if (hasDr && hasCr) {
        throw new BadRequestException({
          rule: 'V5',
          message: `บรรทัด ${line.accountCode} มีทั้ง Dr และ Cr`,
        });
      }
      if (!hasDr && !hasCr) {
        throw new BadRequestException({
          rule: 'V5',
          message: `บรรทัด ${line.accountCode} ไม่มีทั้ง Dr และ Cr`,
        });
      }
    }

    // V1 — balanced (tolerance 0.01)
    const drTotal = lines.reduce((acc, l) => acc.plus(l.debitAmount || 0), new Decimal(0));
    const crTotal = lines.reduce((acc, l) => acc.plus(l.creditAmount || 0), new Decimal(0));
    if (drTotal.minus(crTotal).abs().gt(0.01)) {
      throw new BadRequestException({
        rule: 'V1',
        message: `Dr (${drTotal}) ≠ Cr (${crTotal}) — ผลต่าง ${drTotal.minus(crTotal)}`,
      });
    }
  }

  computeDiffSummary(original: JournalLine[], modified: JournalLine[]): string {
    // Diff line-by-line by accountCode
    // Returns Thai string เช่น:
    // "แก้ Cr 42-1102 จาก 1,000.00 → 1,500.00; เพิ่มบรรทัด Dr 11-1101 100.00; ลบบรรทัด Cr 11-2105 70.00"
  }
}
```

**File:** `apps/api/src/modules/other-income/maker-checker.service.ts` (มีอยู่ — extend)

ใน `post()` flow — ถ้า `overrideJournalLines` present:
1. Validate via `JournalOverrideService.validateOverride(lines)`
2. Compute auto-generated JE = `journalAutoService.generate(doc)` (for diff baseline)
3. Use override lines as the canonical JE for journal entry
4. Set `OtherIncome.isOverridden = true`
5. Write audit:
```ts
await this.auditService.log({
  action: 'JV_OVERRIDDEN',
  entity: 'other_income',
  entityId: doc.id,
  metadata: {
    original_jv: autoLines,
    modified_jv: overrideJournalLines,
    diff_summary: this.journalOverrideService.computeDiffSummary(autoLines, overrideJournalLines),
  },
  userId: actor.id,
  ipAddress,
});
```

**File:** `apps/api/prisma/schema.prisma` — เพิ่มใน AuditAction enum
```prisma
enum AuditAction {
  // existing...
  JV_OVERRIDDEN
  CONFIG_CHANGED      // for Task 2
  PERIOD_REOPENED     // for Task 3
  PERIOD_CLOSED       // for Task 3
}
```

**Frontend changes:**

**File:** `apps/web/src/pages/other-income/OtherIncomeEntryPage.tsx` (เช็คชื่อจริงตอน implement)

เพิ่ม override mode state + UI:
```tsx
const [overrideMode, setOverrideMode] = useState(false);
const [manualLines, setManualLines] = useState<JournalLine[]>([]);
const [originalLines, setOriginalLines] = useState<JournalLine[]>([]);
const [overrideAcknowledged, setOverrideAcknowledged] = useState(false);

// Auto lines computed from current form state
const autoLines = useMemo(() => generateAutoJournal(doc), [doc]);

// Live validation
const overrideErrors = useMemo(() => {
  if (!overrideMode) return [];
  return validateOverrideLines(manualLines); // V1/V2/V5 client-side
}, [overrideMode, manualLines]);

// On toggle ON
const handleEnableOverride = () => {
  setShowConfirmDialog(true);
};
const handleConfirmOverride = () => {
  setOriginalLines([...autoLines]);
  setManualLines([...autoLines]);
  setOverrideMode(true);
  setShowConfirmDialog(false);
};

// On submit
const postPayload = overrideMode
  ? { ...doc, overrideJournalLines: manualLines }
  : doc;
```

**Component:** `apps/web/src/pages/other-income/components/OverrideConfirmDialog.tsx` (ใหม่)
- Title: "⚠ คุณกำลังจะแก้ไข Auto Journal ด้วยตนเอง"
- Body (per PDF):
  - "ระบบจะตรวจสอบ V1/V2/V5 ก่อน POST"
  - "การกระทำนี้จะถูกบันทึกใน Audit Log"
  - "เอกสารจะมีเครื่องหมาย ✏ Modified"
- Checkbox: "ฉันเข้าใจและรับผิดชอบความถูกต้อง" (required)
- Buttons: [ยกเลิก] [เปิดโหมดแก้ไข]

**Component:** `OtherIncomeEntryPage` — Journal Lines section
- เมื่อ `overrideMode === true`:
  - แสดง editable table (account picker, dr/cr inputs, note)
  - ปุ่ม "เพิ่มบรรทัด" / "ลบบรรทัด"
  - ใต้ table แสดง real-time error from `overrideErrors`
  - แสดง diff visualization: original auto vs current manual (collapsible)
- ปุ่ม POST disabled ถ้า `overrideErrors.length > 0`

**File:** `apps/web/src/pages/other-income/OtherIncomeListPage.tsx`

เพิ่ม ✏ marker:
```tsx
<span className="font-mono text-xs">
  {doc.isOverridden && (
    <Tooltip content="POST ด้วย Override JV — ดู audit log">
      <span className="text-amber-600">✏</span>
    </Tooltip>
  )}
  {doc.docNo}
</span>
```

**File:** `apps/web/src/pages/other-income/OtherIncomeDetailPage.tsx` (or equivalent)

ใน audit log section — ถ้า entry มี `action === 'JV_OVERRIDDEN'` แสดง diff:
```tsx
<AuditEntry>
  <Badge>JV_OVERRIDDEN</Badge>
  <p>{actor} · {timestamp}</p>
  <DiffViewer original={meta.original_jv} modified={meta.modified_jv} />
  <p className="italic">{meta.diff_summary}</p>
</AuditEntry>
```

### 3.2 Task 5 — Pagination

**Shared component:**

**File:** `apps/web/src/components/ui/PaginationBar.tsx` (ใหม่)

```tsx
type Props = {
  total: number;
  page: number;
  size: number;
  sizeOptions?: number[]; // default [20, 50, 100]
  onPageChange: (page: number) => void;
  onSizeChange: (size: number) => void;
};

export function PaginationBar({ total, page, size, sizeOptions = [20, 50, 100], onPageChange, onSizeChange }: Props) {
  const totalPages = Math.ceil(total / size);
  const start = (page - 1) * size + 1;
  const end = Math.min(page * size, total);

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <span className="text-sm text-muted-foreground">
        แสดง {start}-{end} จาก {total.toLocaleString()} รายการ
      </span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={() => onPageChange(1)} disabled={page === 1}>« First</Button>
        <Button variant="ghost" size="sm" onClick={() => onPageChange(page - 1)} disabled={page === 1}>‹ Prev</Button>
        {/* Numeric pages — show 5 around current */}
        {numericPagesAround(page, totalPages).map((p) =>
          <Button key={p} variant={p === page ? 'default' : 'ghost'} size="sm" onClick={() => onPageChange(p)}>{p}</Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => onPageChange(page + 1)} disabled={page === totalPages}>Next ›</Button>
        <Button variant="ghost" size="sm" onClick={() => onPageChange(totalPages)} disabled={page === totalPages}>Last »</Button>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm">แสดงต่อหน้า:</span>
        <Select value={String(size)} onValueChange={(v) => onSizeChange(Number(v))}>
          {sizeOptions.map((s) => <SelectItem key={s} value={String(s)}>{s}</SelectItem>)}
        </Select>
      </div>
    </div>
  );
}
```

**URL params hook:**

**File:** `apps/web/src/hooks/usePaginationParams.ts` (ใหม่)
```ts
export function usePaginationParams(defaults: { page?: number; size?: number } = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Number(searchParams.get('page')) || defaults.page || 1;
  const size = Number(searchParams.get('size')) || defaults.size || 50;
  const setPage = (p: number) => setSearchParams((prev) => ({ ...prev.entries(), page: String(p) }));
  const setSize = (s: number) => setSearchParams((prev) => ({ ...prev.entries(), size: String(s), page: '1' })); // reset page on size change
  return { page, size, setPage, setSize };
}
```

**Pages to migrate:**

| Page | Default size | Sort | URL state migration |
|---|---|---|---|
| `OtherIncomeListPage` | 50 | `createdAt DESC` (default); `createdAt ASC` when filter=READY | local state → URL `?page=N&size=M` |
| `ExpensesPage` | 50 (PDF, เดิม 20) | `createdAt DESC` | URL params (เดิมมีบางส่วน) — refactor ให้ใช้ PaginationBar |
| `AuditLogsPage` | 100 (PDF, เดิม 25) | `eventAt DESC` | refactor ให้ใช้ PaginationBar |

**ไม่แตะ:** `OtherIncomeDailySheetPage` — date-scoped, ไม่ต้อง paginate

**Note: "เอกสารรออนุมัติ" ใน PDF table** = filter view (`status=READY`) ใน OtherIncomeListPage — ไม่ใช่ page แยก. เมื่อ filter active ใช้ sort `createdAt ASC` (เก่าก่อน) แทน default DESC

**Note: "Templates" page ใน PDF table** = ไม่มี page นี้ใน codebase ปัจจุบัน — out of scope for v2.2

**DB indexes (เช็คก่อน implement, เพิ่มถ้าไม่มี):**
```prisma
@@index([status, createdAt])  // OtherIncome
@@index([eventAt(sort: Desc)]) // AuditLog
@@index([status, createdAt])  // Expense
```

---

## 4. Sprint 2 (Week 2) — Task 2 + Task 3

### 4.1 Task 2 — Maker-Checker Toggle UI

**Backend:**

**File:** `apps/api/src/modules/system-config/system-config.controller.ts`

```ts
@Put('/maker-checker')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER')
async toggleMakerChecker(@Body() dto: { enabled: boolean }, @CurrentUser() actor: User) {
  const key = 'OTHER_INCOME_MAKER_CHECKER_ENABLED';
  const oldValue = await this.systemConfigService.get(key);
  await this.systemConfigService.set(key, String(dto.enabled));
  await this.auditService.log({
    action: 'CONFIG_CHANGED',
    entity: 'system_config',
    entityId: key,
    metadata: { config_key: key, old_value: oldValue, new_value: String(dto.enabled) },
    userId: actor.id,
    ipAddress: this.requestContext.ipAddress,
  });
  return { success: true, enabled: dto.enabled };
}

@Get('/pending-ready-count')
@Roles('OWNER')
async pendingReadyCount() {
  return { count: await this.otherIncomeService.countByStatus('READY') };
}
```

**Frontend (Sprint 2 = OLD `SettingsPage`):**

**File:** `apps/web/src/pages/SettingsPage/components/MakerCheckerToggle.tsx` (ใหม่)

```tsx
export function MakerCheckerToggle() {
  const { user } = useAuth();
  const isOwner = user.role === 'OWNER';
  const { data: status } = useQuery({ queryKey: ['system-config', 'maker-checker'], queryFn: () => api.get('/system-config/maker-checker') });
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingNext, setPendingNext] = useState<boolean | null>(null);

  const mutation = useMutation({
    mutationFn: (enabled: boolean) => api.put('/system-config/maker-checker', { enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-config'] });
      toast.success('บันทึกสำเร็จ');
    },
  });

  return (
    <Card>
      <CardHeader>ระบบ Maker-Checker (ผู้สร้าง ≠ ผู้อนุมัติ)</CardHeader>
      <CardContent>
        <Switch checked={status?.enabled} onCheckedChange={(next) => { setPendingNext(next); setShowConfirm(true); }} disabled={!isOwner} />
        {!isOwner && <p className="text-xs text-muted-foreground">เฉพาะ OWNER เท่านั้นที่เปลี่ยนได้</p>}
        <p className="text-sm mt-2">
          💡 เมื่อเปิด — เอกสารทุกฉบับต้องผ่านผู้อนุมัติก่อน POST
        </p>
      </CardContent>
      <MakerCheckerConfirmDialog
        open={showConfirm}
        nextValue={pendingNext}
        onConfirm={() => { mutation.mutate(pendingNext!); setShowConfirm(false); }}
        onCancel={() => setShowConfirm(false)}
      />
    </Card>
  );
}
```

**Component:** `MakerCheckerConfirmDialog`
- **OFF → ON**: list ผลกระทบ (เอกสารทุกฉบับต้องผ่านผู้อนุมัติ / DRAFT ต้องส่งอนุมัติ / ผู้สร้าง ≠ ผู้อนุมัติ) + checkbox required
- **ON → OFF**: list ผลกระทบ (READY auto-approve / เอกสารใหม่ POST ทันที) + call `/system-config/pending-ready-count` แสดง "จำนวนเอกสาร READY ตอนนี้: N ฉบับ" + checkbox required

ติดใน [SettingsPage/index.tsx](apps/web/src/pages/SettingsPage/index.tsx) — Sprint 3 จะ migrate ไปที่ tab "👥 ผู้ใช้งาน"

### 4.2 Task 3 — Reopen Period Workflow

**Schema:**

**File:** `apps/api/prisma/schema.prisma`
```prisma
enum AuditAction {
  // existing entries...
  PERIOD_REOPENED
  PERIOD_CLOSED
}
```
Migration: `add_period_reopened_closed_audit_actions`

**Backend:**

**File:** `apps/api/src/modules/accounting/dto/reopen-period.dto.ts` (ใหม่)
```ts
export class ReopenPeriodDto {
  @IsEnum(['WRONG_ENTRY', 'MISSED_RECORD', 'AUDITOR_REQUEST', 'OTHER'])
  reasonType: string;

  @IsString()
  @MinLength(10)
  reason: string;

  @IsBoolean()
  taxFiled: boolean;
}
```

**File:** `apps/api/src/modules/accounting/monthly-close.service.ts` (มีอยู่ — extend `reopenPeriod()`)

```ts
async reopenPeriod(period: string, dto: ReopenPeriodDto, actor: User, ipAddress?: string) {
  // existing reopen logic (set reopenedAt, reopenedById, status update) +

  await this.prisma.accountingPeriod.update({
    where: { period },
    data: {
      reopenedAt: new Date(),
      reopenedById: actor.id,
      reopenReason: `${dto.reasonType}: ${dto.reason}`, // <- เพิ่ม field
      taxFiled: dto.taxFiled, // <- เพิ่ม field
      status: 'OPEN',
    },
  });

  await this.auditService.log({
    action: 'PERIOD_REOPENED',
    entity: 'accounting_period',
    entityId: period,
    metadata: {
      reasonType: dto.reasonType,
      reason: dto.reason,
      taxFiled: dto.taxFiled,
      reopenedAt: new Date().toISOString(),
    },
    userId: actor.id,
    ipAddress,
  });
}

async closePeriod(period: string, actor: User, ipAddress?: string) {
  // existing close logic +
  await this.auditService.log({
    action: 'PERIOD_CLOSED',
    entity: 'accounting_period',
    entityId: period,
    metadata: { closedAt: new Date().toISOString() },
    userId: actor.id,
    ipAddress,
  });
}
```

**Schema additions:** `AccountingPeriod`
```prisma
model AccountingPeriod {
  // existing...
  reopenReason String?    // new
  taxFiled     Boolean?   // new
}
```
Migration: `add_reopen_reason_tax_filed_to_accounting_period`

**Frontend:**

**File:** `apps/web/src/pages/accounting/PeriodClosePage.tsx` (มีอยู่ — extend)

`ReopenPeriodModal` (ใหม่):
- Title: "⚠ คุณกำลังเปิดงวด {period} ที่ปิดไปแล้ว"
- RadioGroup (required):
  - WRONG_ENTRY: "พบเอกสารผิดต้อง reverse"
  - MISSED_RECORD: "ลืมบันทึกรายการสำคัญ"
  - AUDITOR_REQUEST: "แก้ไขตามคำขอ auditor"
  - OTHER: "อื่นๆ (ระบุ)"
- Textarea note (required, min 10 chars): "บันทึกรายละเอียด"
- RadioGroup (required): "ภ.พ.30 งวดนี้ยื่นแล้วใช่ไหม?" → ใช่ / ยังไม่ได้ยื่น
- Buttons: [ยกเลิก] [ยืนยันเปิดงวด] (disabled จนกว่ากรอกครบ)
- On submit → mutation `POST /accounting/periods/:period/reopen`

**File:** `apps/web/src/components/accounting/ReopenedPeriodBanner.tsx` (ใหม่)

```tsx
export function ReopenedPeriodBanner() {
  const { data: reopened } = useQuery({
    queryKey: ['accounting-periods', 'reopened'],
    queryFn: () => api.get('/accounting/periods/reopened'),
  });

  if (!reopened?.length) return null;

  return (
    <>
      {reopened.map((p) => (
        <Alert key={p.period} variant="warning">
          <AlertTitle>⚠ งวด {p.period} ถูกเปิดชั่วคราว</AlertTitle>
          <AlertDescription>
            <p>เปิดเมื่อ: {p.reopenedAt} โดย {p.reopenedBy.name}</p>
            <p>เหตุผล: {p.reopenReason}</p>
            {p.taxFiled && <p className="text-red-600">⚠ ภ.พ.30 ยื่นแล้ว — ต้องยื่นแก้ไขด้วย</p>}
            <Button onClick={() => closePeriod(p.period)} variant="secondary" size="sm" className="mt-2">
              🔒 ปิดงวดอีกครั้ง
            </Button>
          </AlertDescription>
        </Alert>
      ))}
    </>
  );
}
```

ติดบน:
- [`OtherIncomeListPage`](apps/web/src/pages/other-income/OtherIncomeListPage.tsx) — top of page
- [`ExpensesPage`](apps/web/src/pages/ExpensesPage.tsx) — top of page

**New endpoint:** `GET /accounting/periods/reopened` — list periods where `reopenedAt !== null && status === 'OPEN'` AND was previously CLOSED

---

## 5. Sprint 3 (Week 3) — Task 4 (Settings Consolidation)

### 5.1 New `/settings` Structure

**File:** `apps/web/src/pages/SettingsPage/index.tsx` — full refactor

```tsx
const tabs = [
  { id: 'company',    label: '🏢 บริษัท',      component: <CompanyTab /> },
  { id: 'vat',        label: '💰 VAT',         component: <VatTab /> },
  { id: 'periods',    label: '📅 งวดบัญชี',     component: <PeriodsTab /> },
  { id: 'attachment', label: '📎 เอกสารแนบ',   component: <AttachmentTab /> },
  { id: 'users',      label: '👥 ผู้ใช้งาน',    component: <UsersTab /> },
];

export default function SettingsPage() {
  const { user } = useAuth();
  if (!user.canSettings) return <Navigate to="/" />;
  const [activeTab, setActiveTab] = useState(window.location.hash.slice(1) || 'company');

  // Sync URL hash <-> activeTab
  useEffect(() => {
    window.location.hash = activeTab;
  }, [activeTab]);

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <TabsList>
        {tabs.map((t) => <TabsTrigger key={t.id} value={t.id}>{t.label}</TabsTrigger>)}
      </TabsList>
      {tabs.map((t) => (
        <TabsContent key={t.id} value={t.id}>{t.component}</TabsContent>
      ))}
    </Tabs>
  );
}
```

### 5.2 Tab Contents

| Tab | Source / New | Fields |
|---|---|---|
| 🏢 บริษัท | merge existing `CompanySettings` component | name, address, taxId, phone (CompanyInfo model) |
| 💰 VAT (ใหม่) | New form | `VAT_RATE` (default 7), `VAT_PRICE_TYPE_DEFAULT` (`exclusive`/`inclusive`) |
| 📅 งวดบัญชี | extract logic from [`PeriodClosePage`](apps/web/src/pages/accounting/PeriodClosePage.tsx) → `PeriodsTab` | period table + close/reopen actions (Task 3 modal) + banner |
| 📎 เอกสารแนบ (ใหม่) | New form | `ATTACHMENT_REQUIRED_ABOVE_AMOUNT` (default 0), `ATTACHMENT_ALLOWED_TYPES` (default "PDF, JPG, PNG") |
| 👥 ผู้ใช้งาน | Maker-Checker toggle (Task 2) + link to `/users` | toggle card + summary |

**SystemConfig keys ใหม่ที่ต้อง seed:**
```sql
INSERT INTO system_config (key, value, description) VALUES
  ('VAT_RATE', '7', 'อัตรา VAT (%)'),
  ('VAT_PRICE_TYPE_DEFAULT', 'exclusive', 'ประเภทราคาเริ่มต้น exclusive/inclusive'),
  ('ATTACHMENT_REQUIRED_ABOVE_AMOUNT', '0', 'ยอดที่ต้องบังคับแนบเอกสาร (0 = ไม่บังคับ)'),
  ('ATTACHMENT_ALLOWED_TYPES', 'PDF, JPG, PNG', 'ประเภทไฟล์ที่อนุญาต');
```

### 5.3 Extract Settings → Separate Routes

Move existing SettingsPage tabs ออกจาก /settings เป็น route แยก:

| Existing (in SettingsPage tabs) | New route | Component |
|---|---|---|
| `StickerSettings` | `/settings/stickers` | extract เป็น standalone page |
| `CollectionsConfigCard` | `/settings/collections` | extract เป็น standalone page |
| `GeneralSettings` (pre/post — banking + penalty) | `/settings/general` | extract เป็น standalone page |
| `SystemSettings` | verify contents during implementation — accounting-related fields (เช่น VAT rate, attachment threshold) → ย้ายไป VAT / Attachment tab; operational fields → ย้ายไป relevant route | inspect file ตอน implement |

### 5.4 URL Redirects

**File:** `apps/web/src/App.tsx` — เพิ่ม redirect routes
```tsx
// Backward compatible 301-like client redirects
<Route path="/accounting/periods" element={<Navigate to="/settings#periods" replace />} />
```

ถ้ามี server-side route: `apps/api/src/main.ts` middleware ส่ง 301 redirect

### 5.5 Permission

- `/settings` root: `user.canSettings === true` (default OWNER)
- Non-OWNER → 403 + redirect to `/`
- Reuse existing `RolesGuard` + `ProtectedRoute`

### 5.6 Cache Invalidation

```tsx
// In each tab's mutation onSuccess:
queryClient.invalidateQueries({ queryKey: ['system-config'] });
queryClient.invalidateQueries({ queryKey: ['settings'] });
queryClient.invalidateQueries({ queryKey: ['company-info'] }); // if applicable
```

ไม่ใช้ WebSocket — react-query stale-while-revalidate เพียงพอ

### 5.7 Mobile Responsive

- TabsList ใช้ horizontal scroll (Radix UI default)
- ทดสอบ 375px viewport — labels ไม่ตัดข้อความ

---

## 6. Cross-Cutting Concerns

### 6.1 Audit Log Conventions

ทุก audit ใหม่ใช้ pattern:
```ts
{
  action: 'JV_OVERRIDDEN' | 'CONFIG_CHANGED' | 'PERIOD_REOPENED' | 'PERIOD_CLOSED',
  entity: lowercase string ('other_income', 'system_config', 'accounting_period'),
  entityId: string,
  metadata: JSON,
  userId: UUID (real FK),
  ipAddress: string | null,
}
```

ตาม [memory: AuditLog conventions](v5 PR notes): entity lowercase, userId real UUID FK, ipAddress optional

### 6.2 Permissions Matrix

| Action | Required Role |
|---|---|
| Override JV (POST with override lines) | `canPost === true` (existing) |
| Toggle Maker-Checker | OWNER only |
| Reopen period | OWNER only (existing — confirm) |
| Close period | OWNER OR `canSettings === true` |
| Edit Settings | `canSettings === true` |
| View Settings | `canSettings === true` (404 elsewhere) |

### 6.3 i18n / Thai Strings

ตาม [rules: backend.md](.claude/rules/backend.md) — error messages ภาษาไทย:
- V1: `Dr ({dr}) ≠ Cr ({cr}) — ผลต่าง {diff} บาท`
- V2: `ต้องมีอย่างน้อย 2 บรรทัด`
- V5: `บรรทัด {accountCode} มีทั้ง Dr และ Cr` / `บรรทัด {accountCode} ไม่มีทั้ง Dr และ Cr`

### 6.4 Decimal Precision

ตาม [rules: accounting.md](.claude/rules/accounting.md) — ทุกการคำนวณเงินใช้ `Prisma.Decimal` — ห้าม `Number()` ใน sum/diff
- `JournalOverrideService.validateOverride` ใช้ `new Decimal()` + `.gt()` / `.minus()`
- Tolerance 0.01 ผ่าน `.abs().gt(0.01)`

---

## 7. Testing Strategy

### 7.1 API Unit Tests

| File | Coverage |
|---|---|
| `journal-override.service.spec.ts` (ใหม่) | V1/V2/V5 edge cases (balanced, off-by-0.01, line counts 0/1/2/10, dr=cr=0, dr>0 cr>0, etc.) |
| `journal-override.service.spec.ts` — diff | computeDiffSummary: identical → "", changed line, added line, removed line, mixed |
| `system-config.service.spec.ts` | OWNER permission, audit emit on toggle |
| `monthly-close.service.spec.ts` | reopen w/ reason emits PERIOD_REOPENED audit |

### 7.2 API Integration Tests

| Test | Assertion |
|---|---|
| `POST /other-income/:id/post` (override) | doc.isOverridden=true, audit log JV_OVERRIDDEN with original/modified |
| `POST /other-income/:id/post` (override invalid V1) | 400 with rule:'V1' |
| `PUT /system-config/maker-checker` (as OWNER) | success + audit CONFIG_CHANGED |
| `PUT /system-config/maker-checker` (as non-OWNER) | 403 |
| `POST /accounting/periods/:p/reopen` (valid dto) | audit PERIOD_REOPENED |
| `POST /accounting/periods/:p/reopen` (missing reason) | 400 |

### 7.3 Web Component Tests (vitest)

- `MakerCheckerToggle.test.tsx` — confirmation dialog opens, pending count call, OWNER vs non-OWNER
- `ReopenPeriodModal.test.tsx` — required fields validation, submit disabled until filled
- `PaginationBar.test.tsx` — URL params sync, page size selector, jump to page
- `OverrideConfirmDialog.test.tsx` — checkbox required to proceed

### 7.4 E2E Tests (Playwright)

| File | Flow |
|---|---|
| `e2e/other-income-override-jv.spec.ts` | create OI → toggle override → modify JV → POST → see ✏ marker in list → view audit log diff |
| `e2e/maker-checker-toggle.spec.ts` | OWNER toggle ON → confirmation → assert auto-approve OFF for new OI |
| `e2e/reopen-period.spec.ts` | OWNER reopen Q1 → modal → fill reason → assert banner appears |
| `e2e/settings-tabs.spec.ts` | navigate /settings → click 5 tabs → assert URL hash + content |
| `e2e/pagination-bookmark.spec.ts` | OtherIncomeListPage → click page 3 → reload URL → assert still on page 3 |

### 7.5 Performance

- Seed 10,000 OtherIncome records → measure `GET /other-income?page=1&size=50` < 200ms
- DB indexes verified via `EXPLAIN ANALYZE`
- CI gate: pagination query budget assertion

---

## 8. Migration & Deployment

### 8.1 Migration Order

```
PR-1 (Sprint 1):
  - prisma migration: add JV_OVERRIDDEN to AuditAction enum
  - no data backfill required (is_overridden already exists with default false)

PR-2 (Sprint 2):
  - prisma migration: add PERIOD_REOPENED, PERIOD_CLOSED, CONFIG_CHANGED to AuditAction enum
  - prisma migration: add AccountingPeriod.reopenReason + taxFiled (nullable)
  - seed: ensure OTHER_INCOME_MAKER_CHECKER_ENABLED SystemConfig key exists (idempotent)

PR-3 (Sprint 3):
  - seed: VAT_RATE, VAT_PRICE_TYPE_DEFAULT, ATTACHMENT_REQUIRED_ABOVE_AMOUNT, ATTACHMENT_ALLOWED_TYPES
  - frontend routing changes only — no schema migration
```

### 8.2 Backward Compatibility

- `/accounting/periods` URL → client `<Navigate>` to `/settings#periods` (transparent to users)
- Bookmarks/links to old SettingsPage tabs (Stickers, Collections) → redirect to new dedicated routes
- Existing pagination URLs (`?page=N`) continue working — new pages use same param names

### 8.3 Rollout

- PR-1 + PR-2 + PR-3 ตามลำดับ — ไม่ feature flag เพราะแต่ละ PR self-contained
- หลัง PR-3 merge → demo session กับฝ่ายบัญชี

### 8.4 Documentation Updates

- Update `.claude/rules/accounting.md` — add Override JV audit pattern, Maker-Checker toggle endpoint
- Update CLAUDE.md key routes section — `/settings` 5-tab structure
- New section in `docs/superpowers/specs/` summarizing v2.2 changes for accountant team

---

## 9. Acceptance Criteria (ตาม PDF)

### Sprint 1
- [ ] AC-1.1: Override JV → ใส่ Dr=1000, Cr=999 → POST disabled + V1 error
- [ ] AC-1.2: ลบบรรทัดจนเหลือ 1 → POST disabled + V2 error
- [ ] AC-1.3: ใส่ทั้ง Dr+Cr ในบรรทัดเดียว → POST disabled + V5 error
- [ ] AC-1.4: POST สำเร็จ → audit log มี original + modified JV
- [ ] AC-1.5: List Page แสดง ✏ marker
- [ ] AC-1.6: Confirmation dialog ก่อนเข้า Override mode
- [ ] AC-1.7: Real-time validation แสดง error ระหว่างแก้
- [ ] AC-5.1: List Page แสดงด้วย default size + pagination bar
- [ ] AC-5.2: คลิก Next → URL `?page=2`
- [ ] AC-5.3: เปลี่ยน page size → URL update
- [ ] AC-5.4: Jump to page → ไปทันที
- [ ] AC-5.5: Refresh → คงอยู่หน้าเดิม
- [ ] AC-5.6: เปลี่ยน filter → reset page=1
- [ ] AC-5.7: Total count แสดงถูกต้อง
- [ ] AC-5.8: Query < 200ms (10k records)

### Sprint 2
- [ ] AC-2.1: OWNER เห็น toggle Maker-Checker
- [ ] AC-2.2: Admin คนอื่นเห็น toggle disabled
- [ ] AC-2.3: กด toggle → confirmation dialog
- [ ] AC-2.4: ยกเลิก → state ไม่เปลี่ยน
- [ ] AC-2.5: ยืนยัน → state เปลี่ยน + audit
- [ ] AC-2.6: ตอนปิด แสดงจำนวน READY ที่จะ auto-approve
- [ ] AC-2.7: Audit log ดูประวัติ toggle ได้
- [ ] AC-3.1: OWNER กดเปิดงวด → modal บังคับใส่เหตุผล
- [ ] AC-3.2: Non-OWNER → 403
- [ ] AC-3.3: ใส่ reason+note ครบ → เปิดสำเร็จ + audit
- [ ] AC-3.4: List Page แสดง banner เตือน
- [ ] AC-3.5: กดปิดงวดอีกครั้ง → banner หาย + audit
- [ ] AC-3.6: Audit timeline ดูได้

### Sprint 3
- [ ] AC-4.1: /settings เห็น 5 tabs
- [ ] AC-4.2: Non-OWNER → 403
- [ ] AC-4.3: ทุก tab save ได้
- [ ] AC-4.4: `/accounting/periods` → redirect → `/settings#periods`
- [ ] AC-4.5: เปลี่ยน setting → module อื่นใช้ค่าใหม่
- [ ] AC-4.6: Mobile responsive 375px
- [ ] AC-4.7: 📎 เอกสารแนบ tab — เปลี่ยน threshold ผ่าน UI ได้
- [ ] AC-4.8: 👥 ผู้ใช้งาน tab — มี Maker-Checker toggle

---

## 10. Out of Scope

- Auto-close period after 48h (PDF optional — skip)
- WebSocket-based settings change notification (use react-query stale-while-revalidate)
- VAT rate per-document override (use global SystemConfig only)
- Migration script for legacy SettingsPage URL bookmarks (client-side redirect sufficient)
- New module-specific Maker-Checker keys (e.g., EXPENSE_MAKER_CHECKER_ENABLED) — keep OtherIncome-scoped for v2.2
- Performance optimization beyond 200ms target (no cursor-based pagination, no server-side caching layer)

---

## 11. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Override JV audit log size — large JE arrays in metadata | JSON column compression at DB level (Postgres TOAST) — no action needed |
| Settings tab consolidation breaks existing bookmarks | client-side redirect for known URLs + deprecation banner on old SettingsPage for 1 release |
| Reopen Period audit double-write (existing + new) | check if existing reopenPeriod already writes audit — if so, replace; if not, add cleanly |
| Maker-Checker toggle causes READY docs to lose approval flow when turned OFF | confirmation dialog shows count + warns user; cleanup script handles existing READY docs |
| Pagination URL params conflict with existing filters in some pages | namespace params if needed (`?oi_page=N`) — verify each page during implementation |
