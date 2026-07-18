import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { CheckCircle2, ChevronDown, MessageCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { copy } from '@/lib/copy';
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

type Answers = Record<string, string[]>;

/** mirror สูตร server ไว้แสดง preview เท่านั้น — ราคาจริงมาจาก POST /quote */
function previewPrice(
  maxPrice: number,
  questions: BuybackQuestion[],
  answers: Answers,
): { price: number; complete: boolean } {
  let fixed = 0;
  let pct = 0;
  let complete = true;
  for (const q of questions) {
    const chosen = answers[q.key] ?? [];
    if (q.selectType === 'SINGLE' && chosen.length !== 1) complete = false;
    for (const id of chosen) {
      const c = q.choices.find((x) => x.id === id);
      if (!c) continue;
      if (c.deductType === 'FIXED') fixed += Number(c.deductValue);
      else pct += Number(c.deductValue);
    }
  }
  pct = Math.min(pct, 100);
  const raw = Math.max(maxPrice - fixed, 0) * (1 - pct / 100);
  return { price: Math.max(Math.floor(raw / 10) * 10, 0), complete };
}

export default function SellQuotePage() {
  usePageMeta(copy.sell.pageTitle, copy.sell.description);
  const nav = useNavigate();
  const track = useTrackEvent();

  const [model, setModel] = useState('');
  const [storage, setStorage] = useState('');
  const [answers, setAnswers] = useState<Answers>({});
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [quote, setQuote] = useState<BuybackQuoteResult | null>(null);
  const [chosenFlow, setChosenFlow] = useState<'BUYBACK' | 'EXCHANGE' | null>(null);
  const [seller, setSeller] = useState({ name: '', phone: '', imei: '', visitDate: '', notes: '' });

  const catalog = useQuery<BuybackCatalog>({
    queryKey: ['buyback-catalog'],
    queryFn: () => api.get<BuybackCatalog>('/api/shop/buyback/catalog').then((r) => r.data),
    staleTime: 5 * 60_000,
  });
  const questionsQ = useQuery<BuybackQuestionsResponse>({
    queryKey: ['buyback-questions'],
    queryFn: () =>
      api.get<BuybackQuestionsResponse>('/api/shop/buyback/questions').then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  const models = catalog.data?.models ?? [];
  const storages = models.find((m) => m.model === model)?.storages ?? [];
  const maxPrice = storages.find((s) => s.storage === storage)?.maxPrice ?? null;
  const questions = questionsQ.data?.questions ?? [];
  const bonusPct = questionsQ.data?.bonusPct ?? '10';

  const answersPayload = useMemo(
    () => questions.map((q) => ({ questionKey: q.key, choiceIds: answers[q.key] ?? [] })),
    [questions, answers],
  );
  const preview = maxPrice ? previewPrice(Number(maxPrice), questions, answers) : null;

  const quoteMutation = useMutation({
    mutationFn: () =>
      api
        .post<BuybackQuoteResult>('/api/shop/buyback/quote', {
          model,
          storage,
          answers: answersPayload,
        })
        .then((r) => r.data),
    onSuccess: (data) => {
      if (!data.available) {
        toast.error(copy.sell.modelUnavailable);
        return;
      }
      setQuote(data);
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? copy.sell.quoteError),
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      api
        .post<BuybackSubmitResponse>('/api/shop/buyback/submit', {
          model,
          storage,
          answers: answersPayload,
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
  });

  function pick(q: BuybackQuestion, choiceId: string) {
    setQuote(null); // คำตอบเปลี่ยน → ใบเสนอเดิมใช้ไม่ได้
    setChosenFlow(null);
    setAnswers((prev) => {
      const current = prev[q.key] ?? [];
      if (q.selectType === 'SINGLE') {
        // ตอบแล้วเลื่อนไปข้อถัดไปแบบ yellobe
        const idx = questions.findIndex((x) => x.key === q.key);
        setOpenKey(questions[idx + 1]?.key ?? null);
        return { ...prev, [q.key]: [choiceId] };
      }
      return {
        ...prev,
        [q.key]: current.includes(choiceId)
          ? current.filter((x) => x !== choiceId)
          : [...current, choiceId],
      };
    });
  }

  const deviceReady = !!(model && storage && maxPrice);
  const sellerReady = seller.name.trim().length > 0 && /^0\d{9}$/.test(seller.phone);

  if (catalog.isLoading || questionsQ.isLoading) {
    return (
      <ShopLayout>
        <Container narrow className="py-10"><LoadingState /></Container>
      </ShopLayout>
    );
  }
  if (catalog.isError || questionsQ.isError) {
    return (
      <ShopLayout>
        <Container narrow className="py-10"><ErrorState title={copy.sell.quoteError} /></Container>
      </ShopLayout>
    );
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
                  className="w-full h-10 rounded-xl border border-zinc-200 bg-background px-3 text-sm leading-snug"
                  value={model}
                  onChange={(e) => {
                    setModel(e.target.value);
                    setStorage('');
                    setQuote(null);
                    setChosenFlow(null);
                  }}
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
                  className="w-full h-10 rounded-xl border border-zinc-200 bg-background px-3 text-sm leading-snug"
                  value={storage}
                  onChange={(e) => {
                    setStorage(e.target.value);
                    setQuote(null);
                    setChosenFlow(null);
                  }}
                  disabled={!model}
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
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 leading-snug">
                <div className="text-sm text-emerald-800">ราคารับซื้อสูงสุด</div>
                <div className="text-3xl font-bold text-emerald-600">
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
              {questions.map((q, qi) => {
                const chosen = answers[q.key] ?? [];
                const answered = q.selectType === 'SINGLE' ? chosen.length === 1 : true;
                const open = openKey === q.key || (openKey === null && qi === 0 && chosen.length === 0);
                return (
                  <div key={q.key} className="rounded-xl border border-zinc-200">
                    <button
                      type="button"
                      className="w-full flex items-center justify-between gap-2 p-3 text-left leading-snug"
                      aria-expanded={open}
                      onClick={() => setOpenKey(open ? null : q.key)}
                    >
                      <span className="flex items-center gap-2 leading-snug">
                        {answered && chosen.length > 0 && (
                          <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" />
                        )}
                        <span className="font-medium">{q.title}</span>
                      </span>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground leading-snug">
                        {q.selectType === 'SINGLE'
                          ? q.choices.find((c) => c.id === chosen[0])?.label ?? 'ยังไม่ได้เลือก'
                          : `มี ${chosen.length} ข้อ`}
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
                          {q.choices.map((c) => {
                            const selected = chosen.includes(c.id);
                            return (
                              <button
                                key={c.id}
                                type="button"
                                role={q.selectType === 'SINGLE' ? 'radio' : 'checkbox'}
                                aria-checked={selected}
                                onClick={() => pick(q, c.id)}
                                className={`rounded-xl border p-3 text-left text-sm leading-snug transition-colors ${
                                  selected
                                    ? 'border-emerald-500 bg-emerald-50'
                                    : 'border-zinc-200 hover:bg-accent'
                                }`}
                              >
                                {c.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {preview && preview.complete && !quote && (
                <div className="rounded-xl bg-muted p-3 text-sm leading-snug space-y-0.5">
                  <div>ขายรับเงินสด ~฿{preview.price.toLocaleString()}</div>
                  <div>
                    เทิร์นแลกเครื่องใหม่ ~฿
                    {Math.max(
                      Math.floor((preview.price * (100 + Number(bonusPct))) / 100 / 10) * 10,
                      0,
                    ).toLocaleString()}{' '}
                    <span className="text-emerald-700">(+{Number(bonusPct)}%)</span>
                  </div>
                  <div className="text-xs text-muted-foreground">กด "ดูราคา" เพื่อยืนยัน</div>
                </div>
              )}
              <div className="hidden md:block">
                <Button
                  onClick={() => quoteMutation.mutate()}
                  disabled={!deviceReady || !preview?.complete || quoteMutation.isPending || !!quote}
                  loading={quoteMutation.isPending}
                  variant="primary"
                  size="lg"
                  fullWidth
                >
                  {quote ? 'เลื่อนลงเพื่อยืนยัน' : preview?.complete ? 'ดูราคา' : 'ตอบแบบประเมินให้ครบก่อน'}
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
                  className={`rounded-xl border p-4 text-left leading-snug transition-colors ${
                    chosenFlow === 'BUYBACK'
                      ? 'border-emerald-500 bg-emerald-50'
                      : 'border-zinc-200 hover:bg-accent'
                  }`}
                >
                  <div className="text-sm text-muted-foreground">💵 {copy.sell.cashOption}</div>
                  <div className="text-3xl font-bold text-emerald-600">
                    ฿{Number(quote.cashPrice ?? quote.price).toLocaleString()}
                  </div>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={chosenFlow === 'EXCHANGE'}
                  onClick={() => setChosenFlow('EXCHANGE')}
                  className={`rounded-xl border p-4 text-left leading-snug transition-colors ${
                    chosenFlow === 'EXCHANGE'
                      ? 'border-emerald-500 bg-emerald-50'
                      : 'border-zinc-200 hover:bg-accent'
                  }`}
                >
                  <div className="text-sm text-muted-foreground">
                    🔄 {copy.sell.exchangeOption}{' '}
                    {Number(quote.bonusPct ?? 0) > 0 && (
                      <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-xs font-semibold text-white">
                        +{Number(quote.bonusPct)}%
                      </span>
                    )}
                  </div>
                  <div className="text-3xl font-bold text-emerald-600">
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
                  .filter((l) => Number(l.amount) > 0)
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
                  <div className="flex justify-between font-medium text-emerald-700">
                    <span>โบนัสเทิร์น +{Number(quote.bonusPct)}%</span>
                    <span>
                      +฿{(Number(quote.exchangePrice) - Number(quote.cashPrice)).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground leading-snug">{copy.sell.priceCondition}</p>

              {/* Step 4: ส่งข้อมูลนัดเข้าร้าน */}
              <div className="space-y-3 border-t border-zinc-200 pt-4">
                <h3 className="font-semibold leading-snug">4. ยืนยัน — นัดเข้าร้าน</h3>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="bb-name">{copy.sell.sellerName} *</Label>
                    <Input
                      id="bb-name"
                      value={seller.name}
                      onChange={(e) => setSeller((s) => ({ ...s, name: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bb-phone">{copy.sell.sellerPhone} *</Label>
                    <Input
                      id="bb-phone"
                      inputMode="numeric"
                      value={seller.phone}
                      onChange={(e) => setSeller((s) => ({ ...s, phone: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bb-imei">IMEI (ถ้ามี)</Label>
                    <Input
                      id="bb-imei"
                      value={seller.imei}
                      onChange={(e) => setSeller((s) => ({ ...s, imei: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bb-visit">วันที่สะดวกเข้าร้าน (ถ้ามี)</Label>
                    <Input
                      id="bb-visit"
                      type="date"
                      value={seller.visitDate}
                      onChange={(e) => setSeller((s) => ({ ...s, visitDate: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="bb-notes">หมายเหตุ (ถ้ามี)</Label>
                    <Input
                      id="bb-notes"
                      value={seller.notes}
                      onChange={(e) => setSeller((s) => ({ ...s, notes: e.target.value }))}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground leading-snug">
                  ร้านอยู่ {copy.contact.address} · {copy.contact.hours}
                </p>
                <Button
                  onClick={() => submitMutation.mutate()}
                  disabled={!sellerReady || !chosenFlow || submitMutation.isPending}
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
              <Button asChild variant="outline" fullWidth>
                <a href="https://line.me/R/ti/p/@bestchoice" target="_blank" rel="noreferrer">
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
          onClick={() => quoteMutation.mutate()}
          disabled={!deviceReady || !preview?.complete || quoteMutation.isPending || !!quote}
          loading={quoteMutation.isPending}
          variant="primary"
          size="lg"
          fullWidth
        >
          {quote ? 'เลื่อนลงเพื่อยืนยัน' : preview?.complete ? 'ดูราคา' : 'ตอบแบบประเมินให้ครบก่อน'}
        </Button>
      </StickyBottomBar>
      <StickyBottomBarSpacer />
    </ShopLayout>
  );
}
