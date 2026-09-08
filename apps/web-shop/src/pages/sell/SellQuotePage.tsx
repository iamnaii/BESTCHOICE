import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { CheckCircle2, ChevronDown, MessageCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { copy, shopInfo } from '@/lib/copy';
import { useTrackEvent } from '@/hooks/useTrackEvent';
import ShopLayout from '@/components/layout/ShopLayout';
import {
  Button,
  Card,
  CardBody,
  CategoryHero,
  Container,
  Input,
  Label,
  LoadingState,
  ErrorState,
  StickyBottomBar,
  StickyBottomBarSpacer,
} from '@/components';
import type {
  BuybackCatalog,
  BuybackQuestion,
  BuybackQuestionsResponse,
  BuybackQuoteResult,
  BuybackSubmitResponse,
} from '@/types/buyback';
import { usePageMeta } from '@/hooks/usePageMeta';

import { previewPrice, type Answers } from './quote-preview';

export default function SellQuotePage() {
  usePageMeta(copy.sell.pageTitle, copy.sell.description);
  const [model, setModel] = useState('');
  const [storage, setStorage] = useState('');
  const catalog = useQuery<BuybackCatalog>({
    queryKey: ['buyback-catalog'],
    queryFn: () => api.get<BuybackCatalog>('/api/shop/buyback/catalog').then((r) => r.data),
    staleTime: 5 * 60_000,
  });
  const questionsQ = useQuery<BuybackQuestionsResponse>({
    queryKey: ['buyback-questions', model, storage],
    queryFn: () => api.get<BuybackQuestionsResponse>('/api/shop/buyback/questions', {
      params: { model, storage },
    }).then((r) => r.data),
    enabled: !!(model && storage),
    staleTime: 5 * 60_000,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  if (catalog.isLoading) {
    return <ShopLayout><Container narrow className="py-10"><LoadingState /></Container></ShopLayout>;
  }
  if (catalog.isError) {
    return <ShopLayout><Container narrow className="py-10">
      <ErrorState title={copy.sell.quoteError} onRetry={() => void catalog.refetch()} />
    </Container></ShopLayout>;
  }

  return <SellQuoteForm
    key={JSON.stringify([model, storage, questionsQ.data])}
    model={model}
    storage={storage}
    onModelChange={(value) => { setModel(value); setStorage(''); }}
    onStorageChange={setStorage}
    models={catalog.data?.models ?? []}
    questionData={questionsQ.data}
    questionsLoading={questionsQ.isLoading}
    questionsError={questionsQ.isError}
    onRetryQuestions={() => void questionsQ.refetch()}
  />;
}

interface SellQuoteFormProps {
  model: string;
  storage: string;
  onModelChange: (value: string) => void;
  onStorageChange: (value: string) => void;
  models: BuybackCatalog['models'];
  questionData?: BuybackQuestionsResponse;
  questionsLoading: boolean;
  questionsError: boolean;
  onRetryQuestions: () => void;
}

/** Remount when the device or its questionnaire changes, so answers cannot cross profiles. */
function SellQuoteForm({ model, storage, onModelChange, onStorageChange, models,
  questionData, questionsLoading, questionsError, onRetryQuestions }: SellQuoteFormProps) {
  const nav = useNavigate();
  const track = useTrackEvent();
  const [answers, setAnswers] = useState<Answers>({});
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [quote, setQuote] = useState<BuybackQuoteResult | null>(null);
  const [chosenFlow, setChosenFlow] = useState<'BUYBACK' | 'EXCHANGE' | null>(null);
  const [seller, setSeller] = useState({ name: '', phone: '', imei: '', visitDate: '', notes: '' });
  const [deviceEligibilityConfirmed, setDeviceEligibilityConfirmed] = useState(false);
  const revision = useRef(0);
  const submitting = useRef(false);
  const storages = models.find((m) => m.model === model)?.storages ?? [];
  const maxPrice = storages.find((s) => s.storage === storage)?.maxPrice ?? null;
  const questions = useMemo(() => questionData?.questions ?? [], [questionData]);
  const eligibilityReady = !questionData?.eligibilityRequired || deviceEligibilityConfirmed;
  const sourceDate = questionData?.capturedAt ? new Date(questionData.capturedAt) : null;
  const sourceName = questionData?.source?.toLowerCase().includes('yellobe') ? 'Yellobe' : questionData?.source;

  const answersPayload = useMemo(
    () => questions.map((q) => ({ questionKey: q.key, choiceIds: answers[q.key] ?? [] })),
    [questions, answers],
  );
  const preview = maxPrice ? previewPrice(maxPrice, questions, answers, questionData?.pricingMode, questionData?.bonusPct) : null;

  const quoteMutation = useMutation({
    mutationFn: (request: { answers: typeof answersPayload; deviceEligibilityConfirmed?: boolean; revision: number }) =>
      api
        .post<BuybackQuoteResult>('/api/shop/buyback/quote', {
          model,
          storage,
          answers: request.answers,
          deviceEligibilityConfirmed: request.deviceEligibilityConfirmed,
        })
        .then((r) => r.data),
    onSuccess: (data, request) => {
      if (request.revision !== revision.current) return;
      if (!data.available) {
        toast.error(copy.sell.modelUnavailable);
        return;
      }
      setQuote(data);
    },
    onError: (e: { response?: { data?: { message?: string } } }, request) => {
      if (request.revision === revision.current) toast.error(e.response?.data?.message ?? copy.sell.quoteError);
    },
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      api
        .post<BuybackSubmitResponse>('/api/shop/buyback/submit', {
          model,
          storage,
          answers: answersPayload,
          deviceEligibilityConfirmed: questionData?.eligibilityRequired ? deviceEligibilityConfirmed : undefined,
          sellerName: seller.name,
          sellerPhone: seller.phone,
          imei: seller.imei || undefined,
          notes: seller.notes || undefined,
          preferredVisitDate: seller.visitDate || undefined,
          flow: chosenFlow ?? 'BUYBACK',
        })
        .then((r) => r.data),
    onSuccess: (data) => {
      track('Lead', {
        type: 'buyback',
        model,
        storage,
        grade: quote?.grade,
        flow: chosenFlow ?? 'BUYBACK',
      });
      toast.success(
        chosenFlow === 'EXCHANGE' ? copy.sell.submitSuccessExchange : copy.sell.submitSuccessCash,
      );
      nav(`/sell/${data.id}`);
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? copy.sell.submitError),
    onSettled: () => { submitting.current = false; },
  });

  function clearQuote() {
    revision.current += 1;
    setQuote(null);
    setChosenFlow(null);
  }

  function pick(q: BuybackQuestion, choiceId: string | null) {
    if (submitting.current) return;
    clearQuote();
    if (q.selectType === 'SINGLE') {
      const idx = questions.findIndex((candidate) => candidate.key === q.key);
      setOpenKey(questions[idx + 1]?.key ?? null);
    }
    setAnswers((previous) => {
      const next = { ...previous };
      if (choiceId === null) {
        if (previous[q.key]?.length === 0) delete next[q.key];
        else next[q.key] = [];
      } else if (q.selectType === 'SINGLE') next[q.key] = [choiceId];
      else {
        const current = previous[q.key] ?? [];
        const selected = current.includes(choiceId) ? current.filter((id) => id !== choiceId) : [...current, choiceId];
        // Unchecking the last issue is not an explicit confirmation that there are no issues.
        if (selected.length === 0) delete next[q.key];
        else next[q.key] = selected;
      }
      return next;
    });
  }

  const deviceReady = !!(model && storage && maxPrice);
  const sellerReady = seller.name.trim().length > 0 && /^0\d{9}$/.test(seller.phone);
  const canQuote = deviceReady && !!preview?.complete && eligibilityReady && !questionsLoading && !questionsError;
  const quoteDisabled = !canQuote || quoteMutation.isPending || submitMutation.isPending || !!quote;
  const quoteLabel = quote ? 'เลื่อนลงเพื่อยืนยัน' : !preview?.complete ? 'ตอบแบบประเมินให้ครบก่อน'
    : !eligibilityReady ? 'ยืนยันสถานะเครื่องก่อนดูราคา' : 'ดูราคา';

  function requestQuote() {
    if (quoteDisabled || submitting.current) return;
    quoteMutation.mutate({ answers: answersPayload, revision: revision.current,
      deviceEligibilityConfirmed: questionData?.eligibilityRequired ? deviceEligibilityConfirmed : undefined });
  }

  function submit() {
    if (submitting.current || !canQuote || !quote?.available || !chosenFlow || !sellerReady) return;
    submitting.current = true;
    submitMutation.mutate();
  }

  return (
    <ShopLayout>
      <CategoryHero
        title={copy.sell.quoteCta}
        breadcrumbs={[{ label: copy.sell.pageTitle, to: '/sell' }, { label: 'เช็คราคา' }]}
      />

      <Container narrow className="py-6 md:py-10 space-y-6 leading-snug">
        {/* Step 1: เลือกเครื่อง */}
        <Card variant="elevated">
          <CardBody className="space-y-4 leading-snug">
            <h2 className="font-semibold leading-snug">1. เลือกรุ่น iPhone</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="bb-model">รุ่น</Label>
                <select
                  id="bb-model"
                  className="w-full h-10 rounded-xl border border-border bg-background px-3 text-sm leading-snug"
                  value={model}
                  onChange={(e) => onModelChange(e.target.value)}
                  disabled={submitMutation.isPending}
                >
                  <option value="">เลือกรุ่น</option>
                  {models.map((m) => (
                    <option key={m.model} value={m.model}>{m.model}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bb-storage">ความจุ</Label>
                <select
                  id="bb-storage"
                  className="w-full h-10 rounded-xl border border-border bg-background px-3 text-sm leading-snug"
                  value={storage}
                  onChange={(e) => onStorageChange(e.target.value)}
                  disabled={!model || submitMutation.isPending}
                >
                  <option value="">เลือกความจุ</option>
                  {storages.map((s) => (
                    <option key={s.storage} value={s.storage}>{s.storage}</option>
                  ))}
                </select>
              </div>
            </div>
            {models.length === 0 && (
              <p className="text-sm text-muted-foreground leading-snug">{copy.sell.modelUnavailable}</p>
            )}
            {deviceReady && (
              <div className="rounded-xl bg-primary/5 border border-primary/20 p-3 leading-snug">
                <div className="text-sm text-primary">ราคารับซื้อสูงสุด</div>
                <div className="text-3xl font-bold text-primary num">
                  ฿{Number(maxPrice).toLocaleString()}
                </div>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Step 2: แบบประเมินสภาพ */}
        {deviceReady && (
          <Card variant="elevated">
            <CardBody className="space-y-3 leading-snug">
              <h2 className="font-semibold leading-snug">2. ประเมินสภาพเครื่อง</h2>
              {questionsLoading && <LoadingState />}
              {questionsError && <ErrorState title="โหลดแบบประเมินไม่สำเร็จ" onRetry={onRetryQuestions} />}
              {!questionsLoading && !questionsError && questions.length === 0 && (
                <p className="text-sm text-muted-foreground">ยังไม่มีแบบประเมินสำหรับรุ่นและความจุนี้ กรุณาสอบถามร้าน</p>
              )}
              {sourceName && <p className="text-xs text-muted-foreground leading-snug">
                เงื่อนไขอ้างอิง {sourceName}
                {sourceDate && !Number.isNaN(sourceDate.getTime()) && ` · ข้อมูล ${sourceDate.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' })}`}
              </p>}
              {questions.map((q, qi) => {
                const chosen = answers[q.key] ?? [];
                const answered = q.selectType === 'SINGLE' ? chosen.length === 1 : Object.hasOwn(answers, q.key);
                const open = openKey === q.key || (openKey === null && qi === 0 && chosen.length === 0);
                return (
                  <div key={q.key} className="rounded-xl border border-border">
                    <button
                      type="button"
                      className="w-full flex items-center justify-between gap-2 p-3 text-left leading-snug"
                      aria-expanded={open}
                      onClick={() => setOpenKey(open ? null : q.key)}
                    >
                      <span className="flex items-center gap-2 leading-snug">
                        {answered && (
                          <CheckCircle2 className="size-4 text-primary" aria-hidden="true" />
                        )}
                        <span className="font-medium">{q.title}</span>
                      </span>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground leading-snug">
                        {q.selectType === 'SINGLE'
                          ? q.choices.find((c) => c.id === chosen[0])?.label ?? 'ยังไม่ได้เลือก'
                          : !answered ? 'ยังไม่ได้เลือก' : chosen.length ? `มี ${chosen.length} ข้อ` : 'ไม่มีอาการเหล่านี้'}
                        <ChevronDown className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                      </span>
                    </button>
                    {open && (
                      <div className="p-3 pt-0 space-y-2">
                        {q.helpText && (
                          <p className="text-xs text-muted-foreground leading-snug">{q.helpText}</p>
                        )}
                        <div
                          className="grid gap-2 sm:grid-cols-2"
                          role={q.selectType === 'SINGLE' ? 'radiogroup' : 'group'}
                          aria-label={q.title}
                        >
                          {q.choices.filter((c) => !c.isNoneChoice).map((c) => {
                            const selected = chosen.includes(c.id);
                            return (
                              <button
                                key={c.id}
                                type="button"
                                role={q.selectType === 'SINGLE' ? 'radio' : 'checkbox'}
                                aria-checked={selected}
                                aria-label={c.label}
                                disabled={submitMutation.isPending}
                                onClick={() => pick(q, c.id)}
                                className={`rounded-xl border p-3 text-left text-sm leading-snug transition-colors ${
                                  selected
                                    ? 'border-primary bg-primary/5'
                                    : 'border-border hover:bg-accent'
                                }`}
                              >
                                {c.label}
                                {c.helpText && <span className="mt-1 block text-xs text-muted-foreground leading-snug">{c.helpText}</span>}
                              </button>
                            );
                          })}
                          {q.selectType === 'MULTI' && <button
                            type="button" role="checkbox" aria-checked={answered && chosen.length === 0}
                            disabled={submitMutation.isPending}
                            onClick={() => pick(q, null)}
                            className={`rounded-xl border p-3 text-left text-sm leading-snug transition-colors ${answered && chosen.length === 0 ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent'}`}
                          >ไม่มีอาการเหล่านี้</button>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {questionData?.eligibilityRequired && questions.length > 0 && (
                <label className="flex items-start gap-3 rounded-xl border border-border p-3 text-sm leading-snug">
                  <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-primary"
                    checked={deviceEligibilityConfirmed} disabled={submitMutation.isPending}
                    onChange={(event) => { clearQuote(); setDeviceEligibilityConfirmed(event.target.checked); }} />
                  <span>{questionData.eligibilityText || 'เครื่องไม่ติดล็อก iCloud หรือระบบผ่อนชำระ สามารถรีเซ็ตและใช้งานได้ปกติ'}</span>
                </label>
              )}
              {preview && preview.complete && eligibilityReady && !quote && (
                <div className="rounded-xl bg-muted p-3 text-sm leading-snug space-y-0.5">
                  <div>ขายรับเงินสด ~฿{preview.price.toLocaleString()}</div>
                  <div>
                    เทิร์นแลกเครื่องใหม่ ~฿
                    {preview.exchangePrice.toLocaleString()}{' '}
                    <span className="text-primary">(+{Number(questionData?.bonusPct ?? '10')}%)</span>
                  </div>
                  <div className="text-xs text-muted-foreground">กด "ดูราคา" เพื่อยืนยัน</div>
                </div>
              )}
              <div className="hidden md:block">
                <Button
                  onClick={requestQuote}
                  disabled={quoteDisabled}
                  loading={quoteMutation.isPending}
                  variant="primary"
                  size="lg"
                  fullWidth
                >
                  {quoteLabel}
                </Button>
              </div>
            </CardBody>
          </Card>
        )}

        {/* Step 3: ผลประเมิน */}
        {quote?.available && quote.breakdown && (
          <Card variant="outlined">
            <CardBody className="space-y-4 leading-snug">
              <h2 className="font-semibold leading-snug">3. เลือกทางที่ต้องการ</h2>
              <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="เลือกวิธีขาย">
                <button
                  type="button"
                  role="radio"
                  aria-checked={chosenFlow === 'BUYBACK'}
                  onClick={() => setChosenFlow('BUYBACK')}
                  disabled={submitMutation.isPending}
                  className={`rounded-xl border p-4 text-left leading-snug transition-colors ${
                    chosenFlow === 'BUYBACK'
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-accent'
                  }`}
                >
                  <div className="text-sm text-muted-foreground">💵 {copy.sell.cashOption}</div>
                  <div className="text-3xl font-bold text-primary num">
                    ฿{Number(quote.cashPrice ?? quote.price).toLocaleString()}
                  </div>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={chosenFlow === 'EXCHANGE'}
                  onClick={() => setChosenFlow('EXCHANGE')}
                  disabled={submitMutation.isPending}
                  className={`rounded-xl border p-4 text-left leading-snug transition-colors ${
                    chosenFlow === 'EXCHANGE'
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-accent'
                  }`}
                >
                  <div className="text-sm text-muted-foreground">
                    🔄 {copy.sell.exchangeOption}{' '}
                    {Number(quote.bonusPct ?? 0) > 0 && (
                      <span className="rounded bg-promo px-1.5 py-0.5 text-xs font-semibold text-promo-foreground">
                        +{Number(quote.bonusPct)}%
                      </span>
                    )}
                  </div>
                  <div className="text-3xl font-bold text-primary num">
                    ฿{Number(quote.exchangePrice ?? quote.price).toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground">{copy.sell.exchangeCreditNote}</div>
                </button>
              </div>
              <div className="space-y-1 text-sm leading-snug">
                <div className="flex justify-between text-muted-foreground">
                  <span>ราคาสูงสุด</span>
                  <span>฿{Number(quote.breakdown.maxPrice).toLocaleString()}</span>
                </div>
                {quote.breakdown.lines
                  .filter((l) => l.applied !== false && Number(l.amount) > 0)
                  .map((l, i) => (
                    <div key={i} className="flex justify-between text-muted-foreground">
                      <span>
                        {l.label}
                        {l.deductType === 'PERCENT' ? ` (−${Number(l.deductValue)}%)` : ''}
                      </span>
                      <span>−฿{Number(l.amount).toLocaleString()}</span>
                    </div>
                  ))}
                {chosenFlow === 'EXCHANGE' && quote.cashPrice && quote.exchangePrice && (
                  <div className="flex justify-between font-medium text-primary">
                    <span>โบนัสเทิร์น +{Number(quote.bonusPct)}%</span>
                    <span>
                      +฿{(Number(quote.exchangePrice) - Number(quote.cashPrice)).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground leading-snug">{copy.sell.priceCondition}</p>

              {/* Step 4: ส่งข้อมูลนัดเข้าร้าน */}
              <div className="space-y-3 border-t border-border pt-4">
                <h3 className="font-semibold leading-snug">4. ยืนยัน — นัดเข้าร้าน</h3>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="bb-name">{copy.sell.sellerName} *</Label>
                    <Input
                      id="bb-name"
                      disabled={submitMutation.isPending}
                      value={seller.name}
                      onChange={(e) => setSeller((s) => ({ ...s, name: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bb-phone">{copy.sell.sellerPhone} *</Label>
                    <Input
                      id="bb-phone"
                      disabled={submitMutation.isPending}
                      inputMode="numeric"
                      value={seller.phone}
                      onChange={(e) => setSeller((s) => ({ ...s, phone: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bb-imei">IMEI (ถ้ามี)</Label>
                    <Input
                      id="bb-imei"
                      disabled={submitMutation.isPending}
                      value={seller.imei}
                      onChange={(e) => setSeller((s) => ({ ...s, imei: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bb-visit">วันที่สะดวกเข้าร้าน (ถ้ามี)</Label>
                    <Input
                      id="bb-visit"
                      disabled={submitMutation.isPending}
                      type="date"
                      value={seller.visitDate}
                      onChange={(e) => setSeller((s) => ({ ...s, visitDate: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="bb-notes">หมายเหตุ (ถ้ามี)</Label>
                    <Input
                      id="bb-notes"
                      disabled={submitMutation.isPending}
                      value={seller.notes}
                      onChange={(e) => setSeller((s) => ({ ...s, notes: e.target.value }))}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground leading-snug">
                  ร้านอยู่ {copy.contact.address} · {copy.contact.hours}
                </p>
                <Button
                  onClick={submit}
                  disabled={!sellerReady || !chosenFlow || !canQuote || submitMutation.isPending}
                  loading={submitMutation.isPending}
                  variant="primary"
                  size="lg"
                  fullWidth
                >
                  {chosenFlow === 'EXCHANGE'
                    ? 'ยืนยันเทิร์น — มาเลือกเครื่องที่ร้าน'
                    : 'ยืนยันขาย — รับเงินสดที่ร้าน'}
                </Button>
              </div>
            </CardBody>
          </Card>
        )}

        {/* รุ่นไม่เปิดรับซื้อ → ชวนทักไลน์ */}
        {model && storages.length === 0 && (
          <Card variant="outlined">
            <CardBody className="space-y-3 leading-snug">
              <p className="text-sm text-muted-foreground leading-snug">{copy.sell.modelUnavailable}</p>
              <Button asChild variant="line" size="lg" fullWidth>
                <a href={shopInfo.lineUrl} target="_blank" rel="noreferrer">
                  <MessageCircle className="size-4" aria-hidden="true" />
                  สอบถามราคาทางไลน์
                </a>
              </Button>
            </CardBody>
          </Card>
        )}
      </Container>

      <StickyBottomBar>
        <Button
          onClick={requestQuote}
          disabled={quoteDisabled}
          loading={quoteMutation.isPending}
          variant="primary"
          size="lg"
          fullWidth
        >
          {quoteLabel}
        </Button>
      </StickyBottomBar>
      <StickyBottomBarSpacer />
    </ShopLayout>
  );
}
