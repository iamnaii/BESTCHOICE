import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router';
import { api } from '@/lib/api';
import { copy, shopInfo } from '@/lib/copy';
import { Button, LoadingState, ErrorState } from '@/components';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useTrackEvent } from '@/hooks/useTrackEvent';
import type {
  BuybackAnswer,
  BuybackCatalog,
  BuybackQuestionsResponse,
  BuybackQuoteResult,
  BuybackSubmitResponse,
} from '@/types/buyback';
import { previewPrice, type Answers } from './quote-preview';
import { validQuoteWindow } from './quote-window';
import { groupModels, modelLabel, resolveDevice, storageLabel } from './device-options';
import { useSellNavigation, type SellStep } from './use-sell-navigation';
import SellFlowLayout from './components/SellFlowLayout';
import DeviceStep from './components/DeviceStep';
import QuestionStep from './components/QuestionStep';
import DeviceOriginStep, { isThaiOriginLabel } from './components/DeviceOriginStep';
import QuoteResultStep from './components/QuoteResultStep';
import SellContactLinks from './components/SellContactLinks';
import SellerStep, {
  normalizeSellerPhone,
  sellerErrors,
  type SellerDetails,
} from './components/SellerStep';

type Flow = 'BUYBACK' | 'EXCHANGE';
interface QuoteRequest {
  model: string;
  storage: string;
  answers: BuybackAnswer[];
  deviceEligibilityConfirmed?: boolean;
  revision: number;
}
function message(error: unknown, fallback: string) {
  return (
    (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback
  );
}
function usableQuote(value: BuybackQuoteResult): boolean {
  const cash = Number(value.cashPrice ?? value.price);
  const exchange = Number(value.exchangePrice);
  return (
    value.available &&
    validQuoteWindow(value) &&
    !!value.breakdown &&
    Array.isArray(value.breakdown.lines) &&
    Number.isFinite(Number(value.breakdown.maxPrice)) &&
    Number.isFinite(cash) &&
    cash > 0 &&
    Number.isFinite(exchange) &&
    exchange > 0
  );
}
export default function SellQuotePage() {
  usePageMeta(copy.sell.pageTitle, copy.sell.description);
  const location = useLocation();
  const route = useNavigate();
  const client = useQueryClient();
  const track = useTrackEvent();
  const navigation = useSellNavigation({ kind: 'device' });
  const [initialized, setInitialized] = useState(false);
  const [model, setModel] = useState('');
  const [storage, setStorage] = useState('');
  const [seriesId, setSeriesId] = useState('');
  const [answers, setAnswers] = useState<Answers>({});
  const [issueDraft, setIssueDraft] = useState<{ key: string; choices: string[] } | null>(null);
  const [eligibility, setEligibility] = useState(false);
  const [quote, setQuote] = useState<BuybackQuoteResult | null>(null);
  const [expired, setExpired] = useState(false);
  const quoteClock = useRef<{ server: number; wall: number; monotonic: number } | null>(null);
  const [flow, setFlow] = useState<Flow>('BUYBACK');
  const [quoteError, setQuoteError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [seller, setSeller] = useState<SellerDetails>({
    name: '',
    phone: '',
    imei: '',
    visitDate: '',
    notes: '',
  });
  const revision = useRef(0);
  const quoteFlight = useRef<number | null>(null);
  const submitting = useRef(false);
  const active = useRef(true);
  const profile = useRef<string | null>(null);
  const step: SellStep = submitting.current ? { kind: 'seller' } : navigation.step;
  useLayoutEffect(() => setIssueDraft(null), [location.key]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      revision.current += 1;
    };
  }, []);
  const catalog = useQuery<BuybackCatalog>({
    queryKey: ['buyback-catalog'],
    queryFn: () => api.get<BuybackCatalog>('/api/shop/buyback/catalog').then((r) => r.data),
    staleTime: 5 * 60_000,
  });
  const models = catalog.data?.models ?? [];
  const groups = groupModels(models);
  const storages = models.find((item) => item.model === model)?.storages ?? [];
  const maxPrice = storages.find((item) => item.storage === storage)?.maxPrice;
  const questionsQ = useQuery<BuybackQuestionsResponse>({
    queryKey: ['buyback-questions', model, storage],
    queryFn: () =>
      api
        .get<BuybackQuestionsResponse>('/api/shop/buyback/questions', {
          params: { model, storage },
        })
        .then((r) => r.data),
    enabled: !!(model && storage && maxPrice),
    staleTime: 5 * 60_000,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const data = questionsQ.data;
  const questions = data?.questions ?? [];
  const complete =
    !!maxPrice &&
    questions.every(
      (q) =>
        q.key !== 'device-origin' ||
        q.choices.some(
          (c) =>
            isThaiOriginLabel(c.label) &&
            answers[q.key]?.length === 1 &&
            answers[q.key][0] === c.id,
        ),
    ) &&
    previewPrice(maxPrice, questions, answers, data?.pricingMode).complete;
  const eligibilityReady = !data?.eligibilityRequired || eligibility;
  const fingerprint = data ? JSON.stringify([model, storage, data]) : null;
  function hasExpiredQuote() {
    const clock = quoteClock.current;
    if (!quote || !clock) return true;
    const elapsed = Math.max(0, Date.now() - clock.wall, performance.now() - clock.monotonic);
    return clock.server + elapsed >= Date.parse(quote.expiresAt ?? '');
  }
  useEffect(() => {
    if (!quote) return;
    const check = () => setExpired((previous) => previous || hasExpiredQuote());
    check();
    const deadline = Math.max(0, Date.parse(quote.expiresAt!) - Date.parse(quote.serverNow!));
    const timer = window.setTimeout(check, deadline);
    const interval = window.setInterval(check, 30_000);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [quote]);
  function invalidateQuote() {
    revision.current += 1;
    quoteFlight.current = null;
    setQuote(null);
    quoteClock.current = null;
    setExpired(false);
    setQuoteError('');
    setFlow('BUYBACK');
  }
  function clearProfile() {
    invalidateQuote();
    setAnswers({});
    setIssueDraft(null);
    setEligibility(false);
    profile.current = null;
  }
  useEffect(() => {
    if (!catalog.data || initialized) return;
    const params = new URLSearchParams(location.search);
    const resolved = resolveDevice(catalog.data.models, params.get('model'), params.get('storage'));
    setModel(resolved.model);
    setStorage(resolved.storage);
    setSeriesId(
      groupModels(catalog.data.models).find((group) =>
        group.models.some((item) => item.model === resolved.model),
      )?.id ?? '',
    );
    navigation.reset(
      resolved.step === 'questions' ? { kind: 'question', key: '' } : { kind: resolved.step },
    );
    setInitialized(true);
    // Hydrate once from a validated catalog; navigation within the form must not reapply the shared link.
  }, [catalog.data, initialized]);
  useLayoutEffect(() => {
    if (!catalog.data || !initialized || !model || submitting.current) return;
    const valid = resolveDevice(catalog.data.models, model, storage);
    if (valid.model !== model || (storage && valid.storage !== storage)) {
      clearProfile();
      setModel(valid.model);
      setStorage(valid.storage);
      if (!valid.model) setSeriesId('');
      navigation.reset({ kind: valid.model ? 'storage' : 'device' });
    }
  }, [catalog.data]);
  useLayoutEffect(() => {
    if (!fingerprint) return;
    if (profile.current && profile.current !== fingerprint) {
      clearProfile();
      navigation.reset({ kind: 'question', key: questions[0]?.key ?? '' });
    }
    profile.current = fingerprint;
  }, [fingerprint]);
  const quoteMutation = useMutation({
    retry: false,
    mutationFn: (request: QuoteRequest) =>
      api
        .post<BuybackQuoteResult>('/api/shop/buyback/quote', {
          model: request.model,
          storage: request.storage,
          answers: request.answers,
          deviceEligibilityConfirmed: request.deviceEligibilityConfirmed,
        })
        .then((r) => r.data),
    onSuccess: (value, request) => {
      if (!active.current || request.revision !== revision.current) return;
      if (!usableQuote(value)) {
        setQuoteError('ยังประเมินราคาเครื่องนี้ไม่ได้ กรุณาสอบถามร้าน');
        return;
      }
      quoteClock.current = {
        server: Date.parse(value.serverNow!),
        wall: Date.now(),
        monotonic: performance.now(),
      };
      setExpired(false);
      setQuote({
        ...value,
        source: value.source ?? data?.source,
        capturedAt: value.capturedAt ?? data?.capturedAt,
        pricingMode: value.pricingMode ?? data?.pricingMode,
      });
    },
    onError: (error, request) => {
      if (active.current && request.revision === revision.current)
        setQuoteError(message(error, copy.sell.quoteError));
    },
    onSettled: (_value, _error, request) => {
      if (quoteFlight.current === request.revision) quoteFlight.current = null;
    },
  });
  function requestQuote() {
    if (
      !complete ||
      !eligibilityReady ||
      questionsQ.isError ||
      questionsQ.isLoading ||
      quoteFlight.current !== null ||
      submitting.current
    )
      return;
    const currentRevision = revision.current;
    quoteFlight.current = currentRevision;
    setQuoteError('');
    quoteMutation.mutate({
      model,
      storage,
      answers: questions.map((q) => ({ questionKey: q.key, choiceIds: answers[q.key] ?? [] })),
      deviceEligibilityConfirmed: data?.eligibilityRequired ? eligibility : undefined,
      revision: currentRevision,
    });
  }
  useEffect(() => {
    if (submitting.current) return;
    if (step.kind === 'result' && !quote) {
      if (complete && eligibilityReady) requestQuote();
      else navigation.reset({ kind: 'question', key: questions[0]?.key ?? '' });
    }
    if (step.kind === 'seller' && !quote)
      navigation.reset({ kind: 'question', key: questions[0]?.key ?? '' });
  }, [step.kind]);
  const submitMutation = useMutation({
    retry: false,
    mutationFn: (payload: Record<string, unknown>) =>
      api.post<BuybackSubmitResponse>('/api/shop/buyback/submit', payload).then((r) => r.data),
    onSuccess: (result) => {
      if (!active.current) return;
      void client.invalidateQueries({ queryKey: ['buyback', result.id] });
      track({ name: 'sell_lead', flow, model, storage, grade: quote?.grade ?? undefined });
      route(`/sell/${result.id}`);
    },
    onError: (error) => {
      if (active.current) {
        const code = (error as { response?: { data?: { code?: string } } })?.response?.data?.code;
        if (code === 'QUOTE_EXPIRED' || code === 'QUOTE_INVALID') {
          setExpired(true);
          navigation.go({ kind: 'result' });
          setSubmitError('');
          return;
        }
        navigation.go({ kind: 'seller' });
        setSubmitError(message(error, copy.sell.submitError));
      }
    },
    onSettled: () => {
      submitting.current = false;
    },
  });
  const locked = submitMutation.isPending || navigation.transitioning;
  const questionIndex =
    step.kind === 'question'
      ? Math.max(
          0,
          questions.findIndex((q) => q.key === step.key),
        )
      : 0;
  const question = questions[questionIndex];
  function finishQuestion() {
    if (step.kind === 'question' && step.review) {
      navigation.advance({ kind: 'review' });
      return;
    }
    const next = questions[questionIndex + 1];
    navigation.advance(
      next
        ? { kind: 'question', key: next.key }
        : data?.eligibilityRequired && !eligibility
          ? { kind: 'eligibility' }
          : { kind: 'result' },
    );
  }
  function pickSingle(id: string) {
    if (locked || !question) return;
    invalidateQuote();
    setAnswers((old) => ({ ...old, [question.key]: [id] }));
    if (
      question.key === 'device-origin' &&
      !question.choices.some((c) => c.id === id && isThaiOriginLabel(c.label))
    )
      return;
    finishQuestion();
  }
  function none() {
    if (locked || !question) return;
    invalidateQuote();
    setIssueDraft(null);
    setAnswers((old) => ({ ...old, [question.key]: [] }));
    finishQuestion();
  }
  function toggleIssue(id: string) {
    if (locked || !question) return;
    setIssueDraft((old) => {
      const selected = old?.key === question.key ? old.choices : (answers[question.key] ?? []);
      return {
        key: question.key,
        choices: selected.includes(id)
          ? selected.filter((value) => value !== id)
          : [...selected, id],
      };
    });
  }
  function back() {
    if (submitting.current) return;
    navigation.back(
      step.kind === 'storage'
        ? { kind: 'device' }
        : step.kind === 'question' && questionIndex === 0
          ? { kind: 'storage' }
          : { kind: 'question', key: questions[Math.max(0, questionIndex - 1)]?.key ?? '' },
    );
  }
  function showResult() {
    if (complete)
      navigation.go(
        data?.eligibilityRequired && !eligibility ? { kind: 'eligibility' } : { kind: 'result' },
      );
  }
  function submit() {
    if (quote && (expired || hasExpiredQuote())) {
      setExpired(true);
      navigation.go({ kind: 'result' });
      return;
    }
    if (
      submitting.current ||
      !complete ||
      !eligibilityReady ||
      !quote ||
      !usableQuote(quote) ||
      Object.keys(sellerErrors(seller)).length
    )
      return;
    submitting.current = true;
    setSubmitError('');
    navigation.cancelAdvance();
    submitMutation.mutate({
      model,
      storage,
      answers: questions.map((q) => ({ questionKey: q.key, choiceIds: answers[q.key] ?? [] })),
      deviceEligibilityConfirmed: data?.eligibilityRequired ? eligibility : undefined,
      sellerName: seller.name.trim(),
      sellerPhone: normalizeSellerPhone(seller.phone),
      imei: seller.imei || undefined,
      notes: seller.notes || undefined,
      preferredVisitDate: seller.visitDate || undefined,
      flow,
      quoteToken: quote.quoteToken,
    });
  }
  const contactQuote = ['result', 'seller'].includes(step.kind) ? quote : null;
  let title =
    step.kind === 'device'
      ? 'คุณใช้ iPhone รุ่นไหน?'
      : step.kind === 'storage'
        ? 'เครื่องมีความจุเท่าไร?'
        : step.kind === 'question'
          ? question?.key === 'device-origin'
            ? 'เครื่องนี้เป็นโมเดลไทยไหม?'
            : (question?.title ?? 'เช็กสภาพเครื่อง')
          : step.kind === 'eligibility'
            ? 'ยืนยันสถานะเครื่อง'
            : step.kind === 'review'
              ? 'ตรวจคำตอบ'
              : step.kind === 'result'
                ? 'สรุปราคาเครื่องของคุณ'
                : 'ข้อมูลติดต่อ';
  const progressText = ['device', 'storage'].includes(step.kind)
    ? '1/4 · เลือกเครื่อง'
    : step.kind === 'question'
      ? `2/4 · เช็กสภาพ · ข้อ ${questionIndex + 1} จาก ${questions.length}`
      : ['review', 'eligibility'].includes(step.kind)
        ? '2/4 · เช็กสภาพ'
        : step.kind === 'result'
          ? '3/4 · ราคาประเมิน'
          : '4/4 · ข้อมูลติดต่อ';
  if (catalog.isLoading || (!initialized && !catalog.isError))
    return (
      <SellFlowLayout title="โหลดรายชื่อรุ่น" progressText="1/4 · เลือกเครื่อง">
        <LoadingState />
      </SellFlowLayout>
    );
  if (catalog.isError)
    return (
      <SellFlowLayout title="โหลดรายชื่อรุ่น" progressText="1/4 · เลือกเครื่อง">
        <ErrorState title={copy.sell.quoteError} onRetry={() => void catalog.refetch()} />
      </SellFlowLayout>
    );
  return (
    <SellFlowLayout
      title={title}
      wide={step.kind === 'result'}
      progressText={progressText}
      onBack={step.kind !== 'device' && !submitMutation.isPending ? back : undefined}
      footer={
        <SellContactLinks
          disabled={submitMutation.isPending}
          context={{
            model,
            storage,
            flow: quote ? flow : undefined,
            amount: contactQuote
              ? flow === 'EXCHANGE'
                ? contactQuote.exchangePrice
                : (contactQuote.cashPrice ?? contactQuote.price)
              : undefined,
            assessedAt: contactQuote?.assessedAt,
            expiresAt: contactQuote?.expiresAt,
            expired,
          }}
        />
      }
      transitioning={navigation.transitioning}
    >
      {model && !['device', 'storage', 'result'].includes(step.kind) && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-secondary-foreground">
            {modelLabel(model)} · {storageLabel(storage)}
          </p>
          <Button
            variant="ghost"
            disabled={submitMutation.isPending}
            onClick={() => {
              navigation.go({ kind: 'device' });
            }}
          >
            เปลี่ยนเครื่อง
          </Button>
        </div>
      )}
      {models.length === 0 ? (
        <p>ยังไม่มีรุ่นที่เปิดรับซื้อ กรุณาสอบถามร้าน</p>
      ) : (
        (step.kind === 'device' || step.kind === 'storage') && (
          <DeviceStep
            stage={step.kind}
            groups={groups}
            seriesId={seriesId}
            model={model}
            storage={storage}
            storages={storages}
            disabled={locked}
            onSeries={(value) => {
              if (locked) return;
              setSeriesId(value);
            }}
            onModel={(value) => {
              if (locked) return;
              if (model !== value) {
                clearProfile();
                setModel(value);
                setStorage('');
                navigation.reset({ kind: 'device' });
              }
              navigation.advance({ kind: 'storage' });
            }}
            onStorage={(value) => {
              if (locked) return;
              if (storage !== value) {
                clearProfile();
                setStorage(value);
              }
              navigation.advance({ kind: 'question', key: '' });
            }}
          />
        )
      )}
      {step.kind === 'question' &&
        (questionsQ.isLoading ? (
          <LoadingState />
        ) : questionsQ.isError ? (
          <ErrorState title="โหลดคำถามไม่สำเร็จ" onRetry={() => void questionsQ.refetch()} />
        ) : !question ? (
          <p>รุ่นและความจุนี้ยังประเมินออนไลน์ไม่ได้ กรุณาสอบถามร้าน</p>
        ) : question.key === 'device-origin' ? (
          <DeviceOriginStep
            question={question}
            answer={answers[question.key]}
            disabled={locked}
            onSelect={pickSingle}
            model={model}
            storage={storage}
          />
        ) : (
          <QuestionStep
            question={question}
            answer={issueDraft?.key === question.key ? issueDraft.choices : answers[question.key]}
            showIssues={
              issueDraft?.key === question.key ||
              (!!answers[question.key]?.length && question.selectType === 'MULTI')
            }
            disabled={locked}
            onSingle={pickSingle}
            onNone={none}
            onToggleIssue={toggleIssue}
            onShowIssues={() => {
              if (locked) return;
              setIssueDraft({ key: question.key, choices: answers[question.key] ?? [] });
            }}
            onConfirmIssues={() => {
              const selected =
                issueDraft?.key === question.key ? issueDraft.choices : answers[question.key];
              if (!locked && selected?.length) {
                invalidateQuote();
                setAnswers((old) => ({ ...old, [question.key]: selected }));
                finishQuestion();
              }
            }}
          />
        ))}
      {step.kind === 'eligibility' && (
        <div className="space-y-4">
          <label className="flex gap-3 rounded-xl border border-border p-4">
            <input
              type="checkbox"
              checked={eligibility}
              onChange={(event) => {
                invalidateQuote();
                setEligibility(event.target.checked);
              }}
              className="mt-1 size-5 shrink-0 accent-primary"
            />
            <span>
              {data?.eligibilityText ||
                'เครื่องไม่ติดล็อก iCloud หรือระบบผ่อนชำระ สามารถรีเซ็ตและใช้งานได้ปกติ'}
            </span>
          </label>
          {!eligibility && <p className="text-sm">ติ๊กยืนยันก่อนดูราคา</p>}
          <Button
            fullWidth
            size="lg"
            disabled={!eligibility || !complete}
            onClick={() => navigation.go({ kind: 'result' })}
          >
            ดูราคาประเมิน
          </Button>
        </div>
      )}
      {step.kind === 'review' && (
        <div className="space-y-4">
          {questions.map((q) => (
            <div key={q.key} className="rounded-xl border border-border p-4">
              <p className="font-semibold">{q.title}</p>
              <p className="mt-2 text-sm">
                {!Object.hasOwn(answers, q.key)
                  ? 'ยังไม่ได้ตอบ'
                  : answers[q.key].length
                    ? q.choices
                        .filter((c) => answers[q.key].includes(c.id))
                        .map((c) =>
                          q.key === 'device-origin'
                            ? isThaiOriginLabel(c.label)
                              ? 'เครื่องโมเดลไทย'
                              : 'เครื่องโมเดลนอก'
                            : c.label,
                        )
                        .join(' · ')
                    : 'ใช้งานได้ปกติทุกอย่าง'}
              </p>
              <Button
                variant="ghost"
                onClick={() => {
                  navigation.go({ kind: 'question', key: q.key, review: true });
                }}
                aria-label={`แก้ ${q.title}`}
              >
                แก้คำตอบ
              </Button>
            </div>
          ))}
          {!complete && <p>ตอบให้ครบทุกข้อก่อนดูราคา</p>}
          <Button fullWidth size="lg" disabled={!complete} onClick={showResult}>
            ดูราคาประเมิน
          </Button>
        </div>
      )}
      {step.kind === 'result' &&
        (quote ? (
          <QuoteResultStep
            quote={quote}
            model={model}
            storage={storage}
            expired={expired}
            conditions={questions.map((q) => ({
              title: q.title,
              answer: answers[q.key]?.length
                ? q.choices
                    .filter((c) => answers[q.key]?.includes(c.id))
                    .map((c) =>
                      q.key === 'device-origin' && isThaiOriginLabel(c.label)
                        ? 'โมเดลไทย · รหัส M'
                        : c.label,
                    )
                    .join(' · ')
                : 'ใช้งานได้ปกติทุกอย่าง',
            }))}
            flow={flow}
            onFlowChange={setFlow}
            onContinue={() => {
              if (expired || hasExpiredQuote()) setExpired(true);
              else navigation.go({ kind: 'seller' });
            }}
            onReview={() => navigation.go({ kind: 'review' })}
            onChangeDevice={() => navigation.go({ kind: 'device' })}
            onReassess={() => {
              invalidateQuote();
              requestQuote();
            }}
          />
        ) : quoteError ? (
          <div className="space-y-4">
            <p role="alert">{quoteError}</p>
            <Button fullWidth onClick={requestQuote}>
              ลองขอราคาอีกครั้ง
            </Button>
            <Button variant="ghost" fullWidth onClick={() => navigation.go({ kind: 'review' })}>
              ตรวจหรือแก้คำตอบ
            </Button>
            <a
              className="block min-h-11 py-3 text-secondary-foreground underline"
              href={shopInfo.lineUrl}
              target="_blank"
              rel="noreferrer"
            >
              สอบถามร้านทาง LINE
            </a>
          </div>
        ) : (
          <div role="status">
            <LoadingState />
            <p>กำลังขอราคาประเมิน</p>
          </div>
        ))}
      {step.kind === 'seller' &&
        quote &&
        (expired ? (
          <div className="space-y-4">
            <p role="alert">พ้นช่วงอ้างอิง 24 ชั่วโมงแล้ว กรุณาประเมินราคาใหม่ก่อนส่งข้อมูล</p>
            <Button fullWidth onClick={() => navigation.go({ kind: 'result' })}>
              กลับไปดูผลประเมิน
            </Button>
          </div>
        ) : (
          <SellerStep
            value={seller}
            onChange={(value) => {
              if (!submitting.current) setSeller(value);
            }}
            submitting={submitMutation.isPending}
            submitError={submitError}
            onSubmit={submit}
            flow={flow}
          />
        ))}
    </SellFlowLayout>
  );
}
