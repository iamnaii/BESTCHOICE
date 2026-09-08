import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ClipboardCheck, LoaderCircle, Smartphone, X } from 'lucide-react';
import { toast } from 'sonner';
import type {
  BuybackAnswer,
  BuybackQuestionsResponse,
  BuybackQuoteResult,
} from '@installment/shared';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import InspectionQuestions, { isQuestionAnswered } from '@/components/trade-in/InspectionQuestions';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { TradeIn } from '../types';

interface Props {
  item: TradeIn | null;
  onClose: () => void;
  onBack?: () => void;
}
type AppraisalPreview = BuybackQuoteResult & { previewToken?: string };
const money = (value: string | number) =>
  `฿${Number(value).toLocaleString('th-TH', { maximumFractionDigits: 2 })}`;
const errorClass = 'text-[color-mix(in_srgb,var(--color-destructive)_80%,var(--color-foreground))]';

export default function AppraisalModal(props: Props) {
  return props.item ? <AppraisalForm key={props.item.id} {...props} item={props.item} /> : null;
}

function AppraisalForm({ item, onClose, onBack }: Props & { item: TradeIn }) {
  const [isSaving, setIsSaving] = useState(false);
  const questions = useQuery<BuybackQuestionsResponse>({
    queryKey: ['trade-in-appraisal-questions', item.id],
    queryFn: ({ signal }) =>
      api
        .get('/trade-ins/appraisal-questions', { params: { tradeInId: item.id }, signal })
        .then((r) => r.data),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const supported =
    item.deviceBrand.trim().toLowerCase() === 'apple' && /^iphone\b/i.test(item.deviceModel.trim());
  const unavailable = !supported
    ? 'ขณะนี้รับซื้อเฉพาะ iPhone แบบตรวจนี้ยังใช้กับอุปกรณ์อื่นไม่ได้'
    : !item.deviceStorage?.trim()
      ? 'รายการนี้ยังไม่มีความจุเครื่อง กรุณาตรวจข้อมูลรุ่นและความจุก่อนประเมิน'
      : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isSaving) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-3xl gap-0 overflow-hidden rounded-xl p-0 motion-reduce:animate-none"
        onEscapeKeyDown={(event) => {
          if (isSaving) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (isSaving) event.preventDefault();
        }}
      >
        <DialogHeader className="mb-0 shrink-0 flex-row items-center justify-between gap-3 space-y-0 border-b border-border px-5 py-4 text-start sm:px-7">
          <div className="min-w-0">
            <DialogTitle>ตรวจสภาพและประเมินราคา</DialogTitle>
            <DialogDescription className="mt-1 leading-snug">
              ตรวจ iPhone ตามรายการ แล้วระบบคำนวณราคาให้
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11"
              disabled={isSaving}
              aria-label="ปิดหน้าประเมินราคา"
            >
              <X className="size-5" aria-hidden="true" />
            </Button>
          </DialogClose>
        </DialogHeader>
        {unavailable ||
        questions.isPending ||
        questions.isError ||
        !questions.data?.questions.length ? (
          <div className="space-y-4 overflow-y-auto p-5 text-sm leading-snug sm:p-7">
            <DeviceContext item={item} />
            {unavailable ? (
              <p role="alert" className={errorClass}>
                {unavailable}
              </p>
            ) : questions.isPending ? (
              <p role="status">กำลังโหลดแบบตรวจสภาพเครื่อง...</p>
            ) : questions.isError ? (
              <div role="alert" className="space-y-3">
                <p className={errorClass}>{getErrorMessage(questions.error)}</p>
                <Button variant="outline" onClick={() => questions.refetch()}>
                  โหลดแบบตรวจใหม่
                </Button>
              </div>
            ) : (
              <p role="alert">ยังไม่มีแบบตรวจที่เปิดใช้งาน กรุณาตั้งค่าแบบประเมินก่อนรับซื้อ</p>
            )}
            <Button variant="outline" onClick={onClose}>
              ปิด
            </Button>
          </div>
        ) : (
          <InspectionForm
            key={JSON.stringify(questions.data)}
            item={item}
            questionnaire={questions.data}
            onClose={onClose}
            onBack={onBack}
            onSavingChange={setIsSaving}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DeviceContext({ item }: { item: TradeIn }) {
  return (
    <section aria-label="ข้อมูลเครื่องที่ประเมิน" className="min-w-0 space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Smartphone className="size-6" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold leading-snug wrap-anywhere">
            {item.deviceBrand} {item.deviceModel}
          </h3>
          <p className="mt-1 text-muted-foreground">
            {[item.deviceStorage, item.deviceColor].filter(Boolean).join(' · ')}
          </p>
          <p className="mt-1 wrap-anywhere">
            <span className="text-muted-foreground">ผู้ขาย </span>
            {item.customer?.name || item.sellerName || 'ยังไม่ระบุผู้ขาย'}
          </p>
        </div>
        <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs">
          {item.flow === 'EXCHANGE' ? 'เทิร์นเครื่อง' : 'รับซื้อเงินสด'}
        </span>
      </div>
      <dl className="grid min-w-0 gap-3 rounded-lg bg-muted/50 px-4 py-3 sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">IMEI</dt>
          <dd className="mt-1 font-medium tabular-nums wrap-anywhere">
            {item.imei || 'ยังไม่ระบุ'}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Serial Number</dt>
          <dd className="mt-1 font-medium wrap-anywhere">{item.serialNumber || 'ยังไม่ระบุ'}</dd>
        </div>
      </dl>
    </section>
  );
}

function InspectionForm({
  item,
  questionnaire,
  onClose,
  onBack,
  onSavingChange,
}: {
  item: TradeIn;
  questionnaire: BuybackQuestionsResponse;
  onClose: () => void;
  onBack?: () => void;
  onSavingChange: (saving: boolean) => void;
}) {
  const { questions } = questionnaire;
  const [deviceEligibilityConfirmed, setDeviceEligibilityConfirmed] = useState(false);
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const completed = questions.filter((question) => isQuestionAnswered(question, selected)).length;
  const eligibilityComplete = !questionnaire.eligibilityRequired || deviceEligibilityConfirmed;
  const complete = questions.length > 0 && completed === questions.length && eligibilityComplete;
  const answers: BuybackAnswer[] = questions.map((q) => ({
    questionKey: q.key,
    choiceIds: [...(selected[q.key] ?? [])].sort(),
  }));
  const eligibility = questionnaire.eligibilityRequired ? { deviceEligibilityConfirmed } : {};
  const previewKey = ['trade-in-appraisal-preview', item.id, questionnaire, answers, eligibility];
  const preview = useQuery<AppraisalPreview>({
    queryKey: previewKey,
    queryFn: ({ signal }) =>
      api
        .post(`/trade-ins/${item.id}/appraisal-preview`, { answers, ...eligibility }, { signal })
        .then((r) => r.data),
    enabled: complete,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const quote = complete && !preview.isFetching && !preview.isError ? preview.data : undefined;
  const ready = !!(
    quote?.available &&
    quote.previewToken &&
    Number(quote.price) > 0 &&
    Number.isFinite(Number(quote.price))
  );
  const save = useMutation({
    mutationFn: () =>
      api.patch(`/trade-ins/${item.id}/appraise-online`, {
        mode: 'REVISED',
        answers,
        ...eligibility,
        previewToken: quote!.previewToken,
      }),
    onMutate: () => onSavingChange(true),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-ins'] });
      queryClient.invalidateQueries({ queryKey: ['trade-in-detail'] });
      toast.success('บันทึกผลตรวจและราคาประเมินแล้ว');
      onClose();
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: previewKey, exact: true });
    },
    onSettled: () => onSavingChange(false),
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (ready && !save.isPending) save.mutate();
  }

  return (
    <form className="flex min-h-0 flex-col" onSubmit={submit} aria-busy={save.isPending}>
      <div className="shrink-0 border-b border-border bg-muted/30 px-5 py-3 sm:px-7">
        <div className="mb-2 flex items-center justify-between gap-3 text-sm leading-snug">
          <span className="flex items-center gap-2 font-medium">
            <ClipboardCheck className="size-4" aria-hidden="true" />
            ผลตรวจสภาพเครื่อง
          </span>
          <span role="status" className="text-muted-foreground">
            ตรวจแล้ว {completed}/{questions.length} ข้อ
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="ความคืบหน้าการตรวจเครื่อง"
          aria-valuemin={0}
          aria-valuemax={questions.length}
          aria-valuenow={completed}
          className="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full bg-primary"
            style={{ width: `${(completed / questions.length) * 100}%` }}
          />
        </div>
      </div>
      <div
        className="min-h-0 space-y-6 overflow-y-auto overscroll-contain px-5 py-5 text-sm leading-snug sm:px-7"
        data-testid="appraisal-body"
      >
        <DeviceContext item={item} />
        <InspectionQuestions
          questionnaire={questionnaire}
          selected={selected}
          onChange={(next) => {
            save.reset();
            setSelected(next);
          }}
          deviceEligibilityConfirmed={deviceEligibilityConfirmed}
          onEligibilityChange={(confirmed) => {
            save.reset();
            setDeviceEligibilityConfirmed(confirmed);
          }}
          disabled={save.isPending}
        />
        {complete && preview.isError && (
          <div role="alert" className="space-y-3">
            <p className={errorClass}>{getErrorMessage(preview.error)}</p>
            <Button type="button" variant="outline" onClick={() => preview.refetch()}>
              คำนวณราคาใหม่
            </Button>
          </div>
        )}
        {quote && !quote.available && (
          <p role="alert" className={errorClass}>
            ยังไม่มีราคากลางสำหรับรุ่นและความจุนี้ กรุณาเพิ่มราคากลางก่อนประเมิน
          </p>
        )}
        {quote?.available && quote.breakdown && (
          <section
            aria-label="รายละเอียดราคาประเมิน"
            className="space-y-3 rounded-xl border border-border bg-muted/30 p-4"
          >
            <h3 className="font-semibold">ราคาตามผลตรวจ</h3>
            <dl className="space-y-2">
              <PriceRow label="ราคากลางสภาพสมบูรณ์" value={money(quote.breakdown.maxPrice)} />
              {quote.breakdown.lines
                .filter((line) => Number(line.amount) > 0)
                .map((line, i) => (
                  <PriceRow key={i} label={line.label} value={`−${money(line.amount)}`} />
                ))}
              <PriceRow label="ราคารับซื้อเงินสด" value={money(quote.cashPrice ?? quote.price!)} />
              {item.flow === 'EXCHANGE' && (
                <PriceRow
                  label={`ราคาเทิร์นรวมโบนัส ${Number(quote.bonusPct ?? 0)}%`}
                  value={money(quote.exchangePrice ?? quote.price!)}
                />
              )}
              <PriceRow label="เกรดจากผลประเมิน" value={quote.grade ?? '—'} />
            </dl>
            <p className="border-t border-border pt-3 text-xs text-muted-foreground">
              คำนวณจากแบบประเมินและราคากลางชุดเดียวกับหน้าเว็บ
            </p>
          </section>
        )}
        {quote?.available && !ready && (
          <p role="alert" className={errorClass}>
            ผลตรวจนี้ยังไม่มีราคารับซื้อที่ยืนยันได้ กรุณาตรวจคำตอบและราคากลางอีกครั้ง
          </p>
        )}
      </div>
      <footer className="shrink-0 space-y-3 border-t border-border bg-card px-5 py-4 sm:px-7">
        {save.isError && (
          <p role="alert" className={cn('text-sm leading-snug', errorClass)}>
            {getErrorMessage(save.error)} ตรวจราคาล่าสุดก่อนยืนยันอีกครั้ง
          </p>
        )}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div aria-live="polite">
            <p className="text-xs leading-snug text-muted-foreground">
              {item.flow === 'EXCHANGE' ? 'ราคาเสนอเทิร์นเครื่อง' : 'ราคาเสนอรับซื้อ'}
            </p>
            <p className="mt-1 text-2xl font-semibold leading-snug tabular-nums">
              {ready
                ? money(quote!.price!)
                : complete && preview.isFetching
                  ? 'กำลังคำนวณ...'
                  : '—'}
            </p>
            {!complete && (
              <p className="mt-1 text-xs leading-snug text-muted-foreground">
                {completed < questions.length
                  ? `ตรวจอีก ${questions.length - completed} ข้อ เพื่อดูราคา`
                  : 'ยืนยันเครื่องผ่านเงื่อนไขรับซื้อ เพื่อดูราคา'}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {onBack && (
              <Button
                type="button"
                variant="ghost"
                className="min-h-11"
                disabled={save.isPending}
                onClick={onBack}
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
                กลับ
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={save.isPending}
              onClick={onClose}
            >
              ยกเลิก
            </Button>
            <Button
              type="submit"
              className="min-h-11 bg-[color-mix(in_srgb,var(--color-primary)_85%,var(--color-foreground))] hover:bg-[color-mix(in_srgb,var(--color-primary)_75%,var(--color-foreground))] dark:bg-primary dark:text-background dark:hover:bg-primary/90"
              disabled={!ready || save.isPending}
            >
              {save.isPending && (
                <LoaderCircle
                  className="size-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              )}
              {save.isPending ? 'กำลังบันทึก...' : 'บันทึกผลตรวจและราคา'}
            </Button>
          </div>
        </div>
      </footer>
    </form>
  );
}

function PriceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="min-w-0 text-muted-foreground wrap-anywhere">{label}</dt>
      <dd className="shrink-0 font-medium tabular-nums">{value}</dd>
    </div>
  );
}
