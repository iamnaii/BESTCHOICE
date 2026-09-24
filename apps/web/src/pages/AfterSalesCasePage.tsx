import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Clock } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAuth } from '@/contexts/AuthContext';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import StepBar, { type StepBarStep } from './after-sales/StepBar';
import PhotoCompare from './after-sales/PhotoCompare';
import CaseTimeline from './after-sales/CaseTimeline';
import ExchangeCard from './after-sales/ExchangeCard';
import {
  SendRepairDialog,
  MarkRepairedDialog,
  SendBackDialog,
  CancelCaseDialog,
} from './after-sales/RepairActionDialogs';
import {
  ConfirmExchangeDialog,
  RejectExchangeDialog,
  SwitchToRepairDialog,
  ApprovePricedDialog,
  CancelSwapDialog,
  DeliverExchangeConfirm,
} from './after-sales/ExchangeActionDialogs';
import {
  afterSalesKeys,
  baht,
  dayOf,
  dayTimeOf,
  OUTCOME_LABEL,
  PAYER_LABEL,
  primaryAction,
  secondaryActions,
  SOURCE_LABEL,
  STAGE_ICON,
  STAGE_LABEL,
  STAGE_TILE,
  stageIndex,
  STALE_ICON,
  staleLabel,
  STEP_TITLES_BY_OUTCOME,
  WARRANTY_LABEL,
  WARRANTY_TILE,
  type AfterSalesStage,
  type CaseDetail,
  type CaseDialogId,
} from './after-sales/after-sales';

/** ทำได้ (ส่งซ่อม/บันทึกซ่อมเสร็จ/ส่งซ่อมต่อ/ส่งมอบคืน) — FM/ACCOUNTANT อ่านอย่างเดียว
 * (เกตปุ่มแนบไฟล์รูปเทียบ — decision บนปุ่มหลัก/รองย้ายไปอยู่ที่ `primaryAction`/`secondaryActions`
 * ใน after-sales.ts แล้วทั้งหมด ตั้งแต่ Task 11) */
const STAFF_ROLES = new Set(['OWNER', 'BRANCH_MANAGER', 'SALES']);
/** C4b (final-fix brief) — mirror ของ roles บน App.tsx: `/expenses/:id` และ `/other-income/:id`
 * ไม่ได้เปิดให้ทุก role ที่เห็นหน้าเคสนี้ — SALES เข้าทั้งสองไม่ได้, BRANCH_MANAGER เข้า expenses
 * ได้แต่ other-income ไม่ได้ ⇒ เอกสารที่ role เปิดไม่ได้ต้องโชว์เป็นข้อความ (เลขที่เอกสารเฉยๆ)
 * ไม่ใช่ลิงก์ที่กดแล้วชน 403 */
const EXPENSE_DETAIL_ROLES = new Set(['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT']);
const OTHER_INCOME_DETAIL_ROLES = new Set(['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']);

/** Task 11 — kind ของ timeline ที่ใช้หา hint (วันเวลา+ชื่อ) ต่อ "ตำแหน่ง" ของ StepBar (0..3)
 * แยกตาม outcome เพราะ SAME_MODEL_EXCHANGE/PRICED_EXCHANGE ไม่มี stage IN_REPAIR จริง (deriveStage
 * ข้ามจาก RECEIVED ไป AWAITING_APPROVAL ตรงๆ — ดู after-sales-stage.util.ts OPEN_EXCHANGE_STAGE) */
const STEP_KINDS_BY_OUTCOME: Record<string, [string[], string[], string[], string[]]> = {
  REPAIR: [
    ['RECEIVED'],
    ['REPAIR_IN_PROGRESS', 'REPAIR_SENT'],
    ['REPAIR_READY_FOR_PICKUP', 'REPAIR_DONE'],
    ['REPAIR_CLOSED', 'CLOSED'],
  ],
  SAME_MODEL_EXCHANGE: [['RECEIVED'], ['OUTCOME_SET'], ['APPROVED'], ['DELIVERED', 'CLOSED']],
  CASH_SAME_MODEL_EXCHANGE: [['RECEIVED'], ['OUTCOME_SET'], ['APPROVED'], ['DELIVERED', 'CLOSED']],
  PRICED_EXCHANGE: [
    ['RECEIVED'],
    ['EXCHANGE_REQUESTED'],
    ['EXCHANGE_APPROVED', 'APPROVED'],
    ['CLOSED'],
  ],
};

type DialogKind = CaseDialogId | null;

function findStepHint(timeline: CaseDetail['timeline'], kinds: string[]): string | undefined {
  for (let i = timeline.length - 1; i >= 0; i -= 1) {
    if (kinds.includes(timeline[i].kind)) {
      const item = timeline[i];
      return item.actorName ? `${dayTimeOf(item.at)} · ${item.actorName}` : dayTimeOf(item.at);
    }
  }
  return undefined;
}

function headerTone(stage: AfterSalesStage): string {
  if (stage === 'RECEIVED' || stage === 'IN_REPAIR' || stage === 'READY_FOR_PICKUP') {
    return 'border-warning/40 bg-warning/10';
  }
  if (stage === 'CLOSED') return 'border-primary/20 bg-primary/5';
  return 'border-border bg-card';
}

function StageChip({ data }: { data: CaseDetail }) {
  const Icon = data.stale ? STALE_ICON : STAGE_ICON[data.stage];
  const label = data.stale
    ? (staleLabel(data.stage, data.daysInStage) ?? STAGE_LABEL[data.stage])
    : STAGE_LABEL[data.stage];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold leading-snug ${STAGE_TILE[data.stage]}`}
    >
      <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
      {label}
    </span>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4 sm:p-5">
      <h2 className="text-base font-semibold leading-snug">{title}</h2>
      {children}
    </section>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-semibold leading-snug text-foreground">
      {children}
    </span>
  );
}

export default function AfterSalesCasePage() {
  const { id = '' } = useParams<{ id: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const query = useQuery<CaseDetail>({
    queryKey: afterSalesKeys.case(id),
    queryFn: async () => (await api.get(`/after-sales/${id}`)).data,
    enabled: !!id,
    staleTime: 0,
  });
  const data = query.data;

  useDocumentTitle(data ? `เคส ${data.caseNumber}` : 'เคสหลังการขาย');

  const returnMutation = useMutation({
    mutationFn: async () => (await api.post(`/after-sales/${id}/repair/return`, {})).data,
    onSuccess: () => {
      toast.success('ส่งมอบคืนลูกค้าแล้ว');
      queryClient.invalidateQueries({ queryKey: afterSalesKeys.all });
      setDialog(null);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const canAct = !!user && STAFF_ROLES.has(user.role);

  const action = data && user ? primaryAction(data, user.role) : null;
  const primaryDialog = action && 'dialog' in action ? action.dialog : null;
  const primaryLabel = action && 'label' in action ? action.label : null;
  const waitingText = action && 'waitingText' in action ? action.waitingText : null;
  const showPrimaryButton = !!primaryDialog;
  const onPrimaryClick = () => {
    if (primaryDialog) setDialog(primaryDialog);
  };
  const secondary = data && user ? secondaryActions(data, user.role) : [];
  // Task 11 row "PRICED_EXCHANGE READY_FOR_PICKUP" ไม่มีปุ่มหลัก (primaryAction คืน null เสมอ) —
  // แทนที่ด้วยลิงก์ไปหน้าสัญญาใหม่ตรงตำแหน่งปุ่มหลัก
  const priceReadyContract =
    data?.outcome === 'PRICED_EXCHANGE' &&
    data.stage === 'READY_FOR_PICKUP' &&
    data.replacementContractId &&
    data.exchange?.replacementContract
      ? data.exchange.replacementContract
      : null;

  // Ruling P-B — เปิด dialog ที่ ?action=confirm|approve ชี้มาตอนโหลดครั้งแรก (เฉพาะเมื่อเคส
  // อยู่ใน stage ที่ตรงกันและ role ทำได้จริง — ใช้ primaryAction ตัวเดียวกับปุ่มหลัก) แล้วลบพารามิเตอร์
  // ทิ้งทันทีกัน dialog เปิดซ้ำตอน refetch/re-render ครั้งถัดไป
  useEffect(() => {
    if (!data || !user) return;
    const wanted = searchParams.get('action');
    if (!wanted) return;
    const act = primaryAction(data, user.role);
    if (act && 'dialog' in act) {
      if (wanted === 'confirm' && act.dialog === 'exchange-confirm') setDialog('exchange-confirm');
      if (wanted === 'approve' && act.dialog === 'approve') setDialog('approve');
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('action');
        return next;
      },
      { replace: true },
    );
  }, [data, user, searchParams, setSearchParams]);

  return (
    <div className="space-y-4">
      <QueryBoundary
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={query.refetch}
      >
        {data && (
          <>
            {(() => {
              const deviceLine =
                [data.deviceBrand, data.deviceModel].filter(Boolean).join(' ') ||
                'ไม่ทราบรุ่นเครื่อง';
              // ไม่มีเส้นทางซ่อมในร้าน (in-shop) ในระบบ (R21, fix round 1) — repairTicket
              // ที่ยังไม่ได้เลือกศูนย์ (ยังไม่กด "ส่งซ่อม") ไม่มีข้อความส่วนนี้เลย
              // แทนที่จะอ้างความสามารถที่ไม่มีจริง
              const centerLine = data.repairTicket?.repairSupplier?.name
                ? `ศูนย์ ${data.repairTicket.repairSupplier.name}`
                : data.repairTicket?.externalClaimNo
                  ? `เลขเคลม ${data.repairTicket.externalClaimNo}`
                  : null;
              const summaryLine = [data.customer.name, deviceLine, centerLine]
                .filter(Boolean)
                .join(' · ');

              return (
                <div className={`space-y-3 rounded-xl border p-4 sm:p-5 ${headerTone(data.stage)}`}>
                  <nav
                    aria-label="breadcrumb"
                    className="text-xs leading-snug text-muted-foreground"
                  >
                    <Link to="/after-sales" className="hover:underline">
                      หลังการขาย
                    </Link>{' '}
                    / เคส
                  </nav>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h1 className="text-xl font-semibold leading-snug text-foreground">
                          {data.caseNumber}
                        </h1>
                        <StageChip data={data} />
                        {data.outcome && (
                          <Chip>
                            {OUTCOME_LABEL[data.outcome]}
                            {data.repairTicket ? ` · ${PAYER_LABEL[data.repairTicket.payer]}` : ''}
                          </Chip>
                        )}
                        <Chip>{SOURCE_LABEL[data.source]}</Chip>
                      </div>
                      <p className="text-sm leading-snug text-muted-foreground">{summaryLine}</p>
                    </div>

                    <div className="flex flex-col items-stretch gap-2 lg:items-end">
                      {showPrimaryButton && (
                        <Button variant="primary" size="lg" onClick={onPrimaryClick}>
                          {primaryLabel}
                        </Button>
                      )}
                      {waitingText && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-3 py-1.5 text-sm font-semibold leading-snug text-warning-strong">
                          <Clock aria-hidden className="h-4 w-4 shrink-0" />
                          {waitingText}
                        </span>
                      )}
                      {priceReadyContract && (
                        <Link
                          to={`/contracts/${priceReadyContract.id}`}
                          className="text-sm font-semibold leading-snug text-primary hover:underline"
                        >
                          ไปสัญญาใหม่ {priceReadyContract.contractNumber} — เปิดใช้ที่หน้าสัญญา
                        </Link>
                      )}
                      <div className="flex flex-wrap justify-end gap-2">
                        {secondary.map((item, index) =>
                          item.kind === 'link' ? (
                            <Link
                              key={`${item.kind}-${index}`}
                              to={item.to}
                              className="inline-flex h-10 items-center rounded-lg border border-border bg-card px-3.5 text-sm font-semibold leading-snug text-primary hover:underline"
                            >
                              {item.label}
                            </Link>
                          ) : (
                            <Button
                              key={`${item.kind}-${index}`}
                              variant="outline"
                              size="md"
                              className={item.destructive ? 'text-destructive' : undefined}
                              onClick={() => setDialog(item.dialog)}
                            >
                              {item.label}
                            </Button>
                          ),
                        )}
                        <Button variant="outline" size="md" disabled title="เร็ว ๆ นี้">
                          ใบรับฝากเครื่อง
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {(() => {
              const outcomeForSteps = data.outcome ?? 'REPAIR';
              const titles = STEP_TITLES_BY_OUTCOME[outcomeForSteps];
              const kindSets =
                STEP_KINDS_BY_OUTCOME[outcomeForSteps] ?? STEP_KINDS_BY_OUTCOME.REPAIR;
              const stepIndex = stageIndex(data.stage);
              const steps: StepBarStep[] = titles.map((title, index) => ({
                tone:
                  stepIndex === -1
                    ? 'idle'
                    : index < stepIndex
                      ? 'done'
                      : index === stepIndex
                        ? 'now'
                        : 'idle',
                title,
                hint: findStepHint(data.timeline, kindSets[index]),
              }));
              return <StepBar ariaLabel="ขั้นตอนเคสหลังการขาย" steps={steps} />;
            })()}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="space-y-4">
                <Card title="เครื่องและลูกค้า">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <Link
                        to={`/customers/${data.customer.id}`}
                        className="font-semibold text-primary hover:underline"
                      >
                        {data.customer.name}
                      </Link>
                      <p className="text-xs leading-snug text-muted-foreground">
                        {data.customer.phone ?? '—'}
                      </p>
                    </div>
                    {data.contractId && (
                      <Link
                        to={`/contracts/${data.contractId}`}
                        className="text-sm text-primary hover:underline"
                      >
                        ดูสัญญาผ่อน
                      </Link>
                    )}
                  </div>
                  <p className="text-sm leading-snug text-foreground">
                    {[data.deviceBrand, data.deviceModel].filter(Boolean).join(' ') ||
                      'ไม่ทราบรุ่นเครื่อง'}
                  </p>
                  <p className="text-xs leading-snug text-muted-foreground">
                    {data.deviceImei ?? '—'} · {data.branch.name} · รับเรื่องเมื่อ{' '}
                    {dayTimeOf(data.receivedAt)} โดย {data.receivedBy.name}
                  </p>
                </Card>

                <ExchangeCard data={data} />

                <Card title="สิทธิ์ ณ วันแจ้ง">
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold leading-snug ${
                      WARRANTY_TILE[data.warrantySnapshot.status] ?? WARRANTY_TILE.WALK_IN
                    }`}
                  >
                    {WARRANTY_LABEL[data.warrantySnapshot.status] ?? data.warrantySnapshot.status}
                  </span>
                  <div className="space-y-0.5 text-sm leading-snug text-foreground">
                    {/* C5 (final-fix brief) — warrantySnapshot ของแถวที่ backfill มา
                        (`{status, checkedAt, backfilled}`) ไม่มี daysRemainingIn7Day เลย —
                        โชว์ประโยคนี้เฉพาะเมื่อเป็นตัวเลขจริงเท่านั้น กัน "เหลืออีก undefined วัน" */}
                    {data.warrantySnapshot.status === 'IN_7DAY_DEFECT' &&
                      Number.isFinite(data.warrantySnapshot.daysRemainingIn7Day) && (
                        <p>เหลืออีก {data.warrantySnapshot.daysRemainingIn7Day} วัน</p>
                      )}
                    {data.warrantySnapshot.shopWarrantyEndDate && (
                      <p>ประกันร้านถึง {dayOf(data.warrantySnapshot.shopWarrantyEndDate)}</p>
                    )}
                    {data.warrantySnapshot.manufacturerWarrantyEndDate && (
                      <p>
                        ประกันศูนย์ถึง {dayOf(data.warrantySnapshot.manufacturerWarrantyEndDate)}
                      </p>
                    )}
                  </div>
                  <p className="text-xs leading-snug text-muted-foreground">
                    ตรวจสิทธิ์เมื่อ {dayOf(data.warrantySnapshot.checkedAt)}
                  </p>
                </Card>

                <Card title="เทียบรูปตอนซื้อ / ตอนรับฝาก">
                  <PhotoCompare
                    caseId={data.id}
                    photoCount={data.photoCount}
                    purchasePhotoAngles={data.purchasePhotoAngles}
                    canUpload={canAct && data.photoCount < 6}
                  />
                </Card>

                <Card title="เช็คลิสต์ตอนรับฝาก">
                  <div className="flex flex-wrap gap-2">
                    {data.accessories.box && <Chip>กล่อง</Chip>}
                    {data.accessories.charger && <Chip>สายชาร์จ</Chip>}
                    {data.accessories.case && <Chip>เคส</Chip>}
                    {data.accessories.other && <Chip>{data.accessories.other}</Chip>}
                    <Chip>
                      {data.unlockConfirmed ? 'ปลดล็อกเครื่องแล้ว' : 'ยังไม่ปลดล็อกเครื่อง'}
                    </Chip>
                  </div>
                </Card>

                <Card title="อาการที่ลูกค้าแจ้ง">
                  <p className="text-sm leading-snug text-foreground">{data.symptom}</p>
                </Card>
              </div>

              <div className="space-y-4">
                <Card title="ไทม์ไลน์">
                  <CaseTimeline
                    timeline={data.timeline}
                    stale={data.stale}
                    daysInStage={data.daysInStage}
                  />
                </Card>

                <Card title="ค่าใช้จ่ายและบัญชี">
                  {data.repairTicket ? (
                    <>
                      <dl className="grid grid-cols-2 gap-y-1.5 text-sm leading-snug">
                        <dt className="text-muted-foreground">ประมาณ</dt>
                        <dd className="text-right tabular-nums">
                          {data.repairTicket.estimatedCost != null
                            ? baht(data.repairTicket.estimatedCost)
                            : '—'}
                        </dd>
                        <dt className="text-muted-foreground">จริง</dt>
                        <dd className="text-right tabular-nums">
                          {data.repairTicket.actualCost != null
                            ? baht(data.repairTicket.actualCost)
                            : '—'}
                        </dd>
                        <dt className="text-muted-foreground">ผู้จ่าย</dt>
                        <dd className="text-right">{PAYER_LABEL[data.repairTicket.payer]}</dd>
                      </dl>
                      {data.repairTicket.expenseDocument ? (
                        user && EXPENSE_DETAIL_ROLES.has(user.role) ? (
                          <Link
                            to={`/expenses/${data.repairTicket.expenseDocument.id}`}
                            className="text-sm text-primary underline-offset-2 hover:underline"
                          >
                            {data.repairTicket.expenseDocument.number}
                          </Link>
                        ) : (
                          <p className="text-sm leading-snug text-foreground">
                            {data.repairTicket.expenseDocument.number}
                          </p>
                        )
                      ) : data.repairTicket.otherIncome ? (
                        user && OTHER_INCOME_DETAIL_ROLES.has(user.role) ? (
                          <Link
                            to={`/other-income/${data.repairTicket.otherIncome.id}`}
                            className="text-sm text-primary underline-offset-2 hover:underline"
                          >
                            {data.repairTicket.otherIncome.docNumber}
                          </Link>
                        ) : (
                          <p className="text-sm leading-snug text-foreground">
                            {data.repairTicket.otherIncome.docNumber}
                          </p>
                        )
                      ) : (
                        <p className="text-xs leading-snug text-muted-foreground">
                          จะสร้างตอนส่งมอบ
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm leading-snug text-muted-foreground">
                      ไม่มีใบซ่อมสำหรับเคสนี้
                    </p>
                  )}
                </Card>

                <Card title="LINE ลูกค้า">
                  {data.lineLinked ? (
                    <p className="text-sm leading-snug text-foreground">
                      พร้อมส่ง (เปิดใช้รอบถัดไป)
                    </p>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-2.5 py-1 text-xs font-semibold leading-snug text-warning-strong">
                      ยังไม่ผูก LINE — โทรแจ้ง
                    </span>
                  )}
                </Card>
              </div>
            </div>

            {showPrimaryButton && (
              <div
                data-testid="mobile-bar"
                className="sticky bottom-0 -mx-4 border-t border-border bg-card px-4 py-3 md:hidden"
              >
                <Button variant="primary" size="lg" className="w-full" onClick={onPrimaryClick}>
                  {primaryLabel}
                </Button>
              </div>
            )}

            <SendRepairDialog
              caseId={data.id}
              open={dialog === 'send'}
              onOpenChange={(next) => setDialog(next ? 'send' : null)}
            />
            <MarkRepairedDialog
              caseId={data.id}
              open={dialog === 'mark-repaired'}
              onOpenChange={(next) => setDialog(next ? 'mark-repaired' : null)}
              defaultPayer={data.repairTicket?.payer ?? 'SHOP'}
            />
            <SendBackDialog
              caseId={data.id}
              open={dialog === 'send-back'}
              onOpenChange={(next) => setDialog(next ? 'send-back' : null)}
            />
            <CancelCaseDialog
              caseId={data.id}
              open={dialog === 'cancel'}
              onOpenChange={(next) => setDialog(next ? 'cancel' : null)}
            />
            <ConfirmDialog
              open={dialog === 'return'}
              onOpenChange={(next) => setDialog(next ? 'return' : null)}
              title="ส่งมอบคืนลูกค้า"
              description="ระบบจะสร้างเอกสารบัญชีค่าซ่อมตามผู้จ่าย (ร่าง) และปิดเคส"
              confirmLabel="ยืนยันส่งมอบคืน"
              loading={returnMutation.isPending}
              onConfirm={() => returnMutation.mutate()}
            />

            <ConfirmExchangeDialog
              caseId={data.id}
              open={dialog === 'exchange-confirm'}
              onOpenChange={(next) => setDialog(next ? 'exchange-confirm' : null)}
              data={data}
            />
            <DeliverExchangeConfirm
              caseId={data.id}
              open={dialog === 'exchange-deliver'}
              onOpenChange={(next) => setDialog(next ? 'exchange-deliver' : null)}
            />
            <RejectExchangeDialog
              caseId={data.id}
              open={dialog === 'exchange-reject'}
              onOpenChange={(next) => setDialog(next ? 'exchange-reject' : null)}
              kind="SAME_MODEL"
            />
            <SwitchToRepairDialog
              caseId={data.id}
              open={dialog === 'switch-to-repair'}
              onOpenChange={(next) => setDialog(next ? 'switch-to-repair' : null)}
              defaultPayer={data.repairTicket?.payer ?? 'SHOP'}
            />
            <ApprovePricedDialog
              caseId={data.id}
              open={dialog === 'approve'}
              onOpenChange={(next) => setDialog(next ? 'approve' : null)}
              mode={data.exchange?.mode === 'MEMO' ? 'MEMO' : 'PRICED'}
            />
            <RejectExchangeDialog
              caseId={data.id}
              open={dialog === 'reject-priced'}
              onOpenChange={(next) => setDialog(next ? 'reject-priced' : null)}
              kind="PRICED"
            />
            <CancelSwapDialog
              caseId={data.id}
              open={dialog === 'cancel-swap'}
              onOpenChange={(next) => setDialog(next ? 'cancel-swap' : null)}
            />
          </>
        )}
      </QueryBoundary>
    </div>
  );
}
