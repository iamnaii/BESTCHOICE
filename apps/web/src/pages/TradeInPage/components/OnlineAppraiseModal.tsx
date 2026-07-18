import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import Modal from '@/components/ui/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import type { TradeIn } from '../types';

interface QuestionChoice { id: string; label: string; deductType: 'PERCENT' | 'FIXED'; deductValue: string }
interface Question { id: string; key: string; title: string; selectType: 'SINGLE' | 'MULTI'; choices: QuestionChoice[] }

interface Props {
  item: TradeIn | null;
  onClose: () => void;
}

type Mode = 'AS_ANSWERED' | 'REVISED' | 'MANUAL';

/** §7.4 — ยืนยันราคา record จาก instant quote: ตรงตามตอบ / แก้คำตอบ / OWNER free-hand */
export default function OnlineAppraiseModal({ item, onClose }: Props) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const [mode, setMode] = useState<Mode>('AS_ANSWERED');
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [manualPrice, setManualPrice] = useState('');
  const [manualReason, setManualReason] = useState('');
  const [cashFallback, setCashFallback] = useState(false);

  // questionnaire ปัจจุบัน (public endpoint) — ใช้เฉพาะโหมดแก้คำตอบ
  const questionsQ = useQuery<{ questions: Question[] }>({
    queryKey: ['buyback-questions-public'],
    queryFn: () => api.get('/shop/buyback/questions').then((r) => r.data),
    enabled: !!item && mode === 'REVISED',
  });

  // prefill จากคำตอบเดิมของลูกค้าเมื่อเปิดโหมด REVISED ครั้งแรก
  const prefill = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const a of item?.conditionAnswers ?? []) map[a.questionKey] = a.choices.map((c) => c.choiceId);
    return map;
  }, [item]);
  const effectiveAnswers = Object.keys(answers).length > 0 ? answers : prefill;

  const appraise = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.patch(`/trade-ins/${item!.id}/appraise-online`, body),
    onSuccess: () => {
      toast.success('ยืนยันราคาเรียบร้อย');
      queryClient.invalidateQueries({ queryKey: ['trade-ins'] });
      if (item) queryClient.invalidateQueries({ queryKey: ['trade-in-detail', item.id] });
      handleClose();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  function handleClose() {
    setMode('AS_ANSWERED');
    setAnswers({});
    setManualPrice('');
    setManualReason('');
    setCashFallback(false);
    onClose();
  }

  function confirm() {
    if (mode === 'AS_ANSWERED') {
      appraise.mutate(cashFallback ? { mode, useCashPrice: true } : { mode });
    } else if (mode === 'REVISED') {
      const qs = questionsQ.data?.questions ?? [];
      const payload = qs.map((q) => ({ questionKey: q.key, choiceIds: effectiveAnswers[q.key] ?? [] }));
      const incomplete = qs.some((q) => q.selectType === 'SINGLE' && (effectiveAnswers[q.key] ?? []).length !== 1);
      if (incomplete) { toast.error('ตอบแบบประเมินให้ครบทุกข้อ'); return; }
      appraise.mutate({ mode, answers: payload });
    } else {
      const price = Number(manualPrice);
      if (!Number.isFinite(price) || price <= 0) { toast.error('กรุณาระบุราคา'); return; }
      if (manualReason.trim().length < 3) { toast.error('ระบุเหตุผลอย่างน้อย 3 ตัวอักษร'); return; }
      appraise.mutate({ mode, offeredPrice: price, reason: manualReason });
    }
  }

  const quoted = item?.quoteBreakdown ? Number(item.quoteBreakdown.price) : null;

  return (
    <Modal isOpen={!!item} onClose={handleClose} title="ยืนยันราคาใบเสนอออนไลน์" size="lg">
      {item && (
        <div className="space-y-4 text-sm leading-snug">
          <div className="rounded-lg bg-muted p-3 space-y-1">
            <div className="font-semibold">
              {item.deviceBrand} {item.deviceModel} {item.deviceStorage ?? ''}
              <span className={`ml-2 text-xs font-medium ${item.flow === 'EXCHANGE' ? 'text-warning' : 'text-muted-foreground'}`}>
                {item.flow === 'EXCHANGE' ? 'เทิร์นแลกเครื่องใหม่ (เครดิต)' : 'รับซื้อเงินสด'}
              </span>
            </div>
            {quoted !== null && (
              <div className="text-lg font-bold">ราคาที่เสนอออนไลน์: ฿{quoted.toLocaleString()}</div>
            )}
            {item.quoteBreakdown?.cashPrice && item.quoteBreakdown?.exchangePrice && (
              <div className="text-xs text-muted-foreground">
                เงินสด ฿{Number(item.quoteBreakdown.cashPrice).toLocaleString()} · เทิร์น ฿
                {Number(item.quoteBreakdown.exchangePrice).toLocaleString()} (+
                {Number(item.quoteBreakdown.bonusPct ?? 0)}%)
              </div>
            )}
          </div>

          <div className="flex gap-1.5 flex-wrap">
            <Button
              variant={mode === 'AS_ANSWERED' ? 'primary' : 'outline'}
              size="sm"
              onClick={() => { setMode('AS_ANSWERED'); setCashFallback(false); }}
            >
              สภาพตรงตามที่ตอบ
            </Button>
            <Button
              variant={mode === 'REVISED' ? 'primary' : 'outline'}
              size="sm"
              onClick={() => { setMode('REVISED'); setCashFallback(false); }}
            >
              สภาพไม่ตรง — แก้คำตอบ
            </Button>
            {isOwner && (
              <Button
                variant={mode === 'MANUAL' ? 'primary' : 'outline'}
                size="sm"
                onClick={() => { setMode('MANUAL'); setCashFallback(false); }}
              >
                กำหนดราคาเอง (OWNER)
              </Button>
            )}
            {item.flow === 'EXCHANGE' && (
              <Button
                variant={cashFallback ? 'primary' : 'outline'}
                size="sm"
                onClick={() => { setMode('AS_ANSWERED'); setCashFallback(true); }}
              >
                ลูกค้าไม่ซื้อเครื่อง — ใช้ราคาเงินสด
              </Button>
            )}
          </div>

          {mode === 'AS_ANSWERED' && (
            <p className="text-muted-foreground">
              ยืนยัน{item.flow === 'EXCHANGE' ? 'มูลค่าเทิร์น (เครดิตซื้อเครื่องใหม่)' : 'รับซื้อ'}ที่ ฿
              {Number(item.estimatedValue ?? quoted ?? 0).toLocaleString()} ตามใบเสนอ
            </p>
          )}

          {cashFallback && item.quoteBreakdown?.cashPrice && (
            <p className="text-muted-foreground">
              ถอยเป็นขายเงินสด ฿{Number(item.quoteBreakdown.cashPrice).toLocaleString()} — ระบบจะเปลี่ยนรายการเป็น "รับซื้อ"
            </p>
          )}

          {mode === 'REVISED' && (
            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {questionsQ.isLoading && <p className="text-muted-foreground">กำลังโหลดแบบประเมิน...</p>}
              {(questionsQ.data?.questions ?? []).map((q) => {
                const chosen = effectiveAnswers[q.key] ?? [];
                return (
                  <div key={q.key}>
                    <Label>{q.title}</Label>
                    <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
                      {q.choices.map((c) => {
                        const selected = chosen.includes(c.id);
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() =>
                              setAnswers((_prev) => {
                                const base = { ...effectiveAnswers };
                                if (q.selectType === 'SINGLE') return { ...base, [q.key]: [c.id] };
                                return {
                                  ...base,
                                  [q.key]: selected ? chosen.filter((x) => x !== c.id) : [...chosen, c.id],
                                };
                              })
                            }
                            className={`rounded-lg border p-2 text-left text-xs leading-snug transition-colors ${
                              selected ? 'border-primary bg-primary/10' : 'border-border hover:bg-accent'
                            }`}
                          >
                            {c.label}
                            <span className="text-muted-foreground">
                              {' '}({c.deductType === 'PERCENT' ? `−${Number(c.deductValue)}%` : `−฿${Number(c.deductValue).toLocaleString()}`})
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              <p className="text-xs text-muted-foreground">ระบบจะคิดราคาใหม่จากตารางค่าหักปัจจุบันโดยอัตโนมัติ</p>
            </div>
          )}

          {mode === 'MANUAL' && (
            <div className="space-y-3">
              <div>
                <Label>ราคาที่เสนอ (บาท) *</Label>
                <Input className="mt-1" type="number" value={manualPrice} onChange={(e) => setManualPrice(e.target.value)} />
              </div>
              <div>
                <Label>เหตุผล * (บันทึก audit)</Label>
                <Input className="mt-1" value={manualReason} onChange={(e) => setManualReason(e.target.value)} />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={handleClose}>ยกเลิก</Button>
            <Button onClick={confirm} disabled={appraise.isPending}>
              {appraise.isPending ? 'กำลังบันทึก...' : 'ยืนยันราคา'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
