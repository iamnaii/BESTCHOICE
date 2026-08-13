import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Check, Landmark, Plus, Trash2 } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { getErrorMessage } from '@/lib/api';
import { equityApi, TXN_TYPE_LABELS } from '@/lib/equity';
import type {
  EquityFormValues,
  EquityLineInput,
  EquityTxnType,
  JournalPreview,
} from '@/lib/equity.types';
import { formatNumberDecimal } from '@/utils/formatters';

const NEEDS_RESOLUTION: EquityTxnType[] = [
  'CAP_INIT',
  'CAP_INC',
  'CAP_DEC',
  'DIV_DEC',
  'PRIOR_ADJ',
];
const NEEDS_PAYMENT: EquityTxnType[] = ['CAP_INIT', 'CAP_INC', 'CAP_DEC', 'DRAW', 'DIV_PAY'];
const NEEDS_SHAREHOLDERS: EquityTxnType[] = [
  'CAP_INIT',
  'CAP_INC',
  'CAP_DEC',
  'DRAW',
  'DIV_DEC',
  'DIV_PAY',
];

// 6 บัญชีเงินสด/ธนาคาร FINANCE (ตรงกับ CASH_ACCOUNT_CODES ฝั่ง API)
const CASH_ACCOUNTS = [
  { code: '11-1101', label: 'เงินสด — สุทธินีย์' },
  { code: '11-1102', label: 'เงินสด — เอกนรินทร์' },
  { code: '11-1103', label: 'เงินสด — พนักงานบัญชี' },
  { code: '11-1201', label: 'ธนาคารกสิกรไทย (รับ)' },
  { code: '11-1202', label: 'ธนาคารไทยพาณิชย์ (ค่าใช้จ่าย)' },
  { code: '11-1203', label: 'ธนาคารไทยพาณิชย์ (ค่าเสื่อม)' },
];

const TXN_DESC: Record<EquityTxnType, string> = {
  CAP_INIT:
    'บันทึกทุนตั้งบริษัท รองรับชำระบางส่วน (ขั้นต่ำ 25% — ป.พ.พ. ม.1110) · บันทึกได้ครั้งเดียว',
  CAP_INC: 'รับเงินเพิ่มทุน (ระบุส่วนเกินมูลค่าหุ้นได้)',
  CAP_DEC: 'ลดทุนจดทะเบียน จ่ายคืนผู้ถือหุ้น',
  DRAW: 'กรรมการถอนเงินไปใช้ส่วนตัว → 22-1102 (Contra)',
  DIV_DEC: 'มติประกาศจ่ายปันผล → ตั้งเจ้าหนี้ 21-4104',
  DIV_PAY: 'จ่ายเงินปันผลจริง หัก ภ.ง.ด.2 10% (บุคคลธรรมดา)',
  PRIOR_ADJ: 'แก้ข้อผิดพลาดงวดก่อนผ่านกำไรสะสม 32-1101 (TAS 8)',
};

const emptyLine = (): EquityLineInput => ({ shareholderId: '', amount: 0 });

export default function EquityEntryPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<EquityFormValues>({
    txnType: 'CAP_INC',
    txnDate: new Date().toISOString().slice(0, 10),
    lines: [emptyLine()],
  });
  const [preview, setPreview] = useState<JournalPreview | null>(null);

  const shareholders = useQuery({
    queryKey: ['equity', 'shareholders'],
    queryFn: equityApi.shareholders,
  });
  const mcQuery = useQuery({ queryKey: ['equity', 'mc'], queryFn: equityApi.makerCheckerEnabled });

  const existing = useQuery({
    queryKey: ['equity', 'doc', id],
    queryFn: () => equityApi.findOne(id!),
    enabled: !!id,
  });
  // โหลดร่างเดิมเข้าฟอร์ม (edit mode)
  useEffect(() => {
    const d = existing.data;
    if (!d) return;
    setForm({
      txnType: d.txnType,
      txnDate: d.txnDate.slice(0, 10),
      description: d.description ?? undefined,
      resolutionNo: d.resolutionNo ?? undefined,
      resolutionDate: d.resolutionDate?.slice(0, 10),
      paymentAccountCode: d.paymentAccountCode ?? undefined,
      paAccountCode: d.paAccountCode ?? undefined,
      paAmount: d.paAmount ? parseFloat(d.paAmount) : undefined,
      paDirection: d.paDirection ?? undefined,
      lines: d.lines.map((l) => ({
        shareholderId: l.shareholderId,
        amount: parseFloat(l.amount),
        premium: parseFloat(l.premium) || undefined,
        paid: parseFloat(l.paid) || undefined,
        wht: parseFloat(l.wht) || undefined,
      })),
    });
  }, [existing.data]);

  const t = form.txnType;
  const showSh = NEEDS_SHAREHOLDERS.includes(t);
  const isInit = t === 'CAP_INIT';
  const isInc = t === 'CAP_INC';
  const isDivPay = t === 'DIV_PAY';

  const setLine = (i: number, patch: Partial<EquityLineInput>) =>
    setForm((f) => ({ ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  const previewMut = useMutation({
    mutationFn: () => equityApi.preview(form),
    onSuccess: (p) => {
      setPreview(p);
      setStep(2);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const saveMut = useMutation({
    mutationFn: () => (id ? equityApi.update(id, form) : equityApi.create(form)),
    onSuccess: (doc) => {
      toast.success(`บันทึกร่าง ${doc.docNumber} แล้ว — แนบไฟล์มติ/ลงบัญชีได้จากหน้าเอกสาร`);
      navigate(`/finance/equity/${doc.id}`);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const totals = form.lines.reduce(
    (s, l) => ({
      amount: s.amount + (l.amount || 0),
      premium: s.premium + (l.premium || 0),
      paid: s.paid + (l.paid || 0),
      wht: s.wht + (l.wht || 0),
    }),
    { amount: 0, premium: 0, paid: 0, wht: 0 },
  );
  const initPctPaid = totals.amount > 0 ? (totals.paid / totals.amount) * 100 : 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title={id ? 'แก้ไขธุรกรรมส่วนของผู้ถือหุ้น' : 'บันทึกธุรกรรมส่วนของผู้ถือหุ้น'}
        icon={<Landmark size={20} />}
        action={
          <Button variant="ghost" onClick={() => navigate('/finance/equity')}>
            <ArrowLeft className="h-4 w-4 mr-1" /> กลับ
          </Button>
        }
      />

      {/* Stepper */}
      <div className="flex gap-2">
        {['ประเภท & ข้อมูล', 'ตรวจ Journal', 'ยืนยัน'].map((label, i) => (
          <div
            key={label}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm leading-snug ${step === i + 1 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
          >
            <span className="font-semibold">{i + 1}</span> {label}
          </div>
        ))}
      </div>

      {step === 1 && (
        <QueryBoundary
          isLoading={shareholders.isLoading || (!!id && existing.isLoading)}
          isError={shareholders.isError}
          error={shareholders.error}
          onRetry={shareholders.refetch}
        >
          {/* 1.1 เลือกประเภท */}
          <Card>
            <CardHeader className="font-semibold">1.1 ประเภทธุรกรรม</CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {(Object.keys(TXN_TYPE_LABELS) as EquityTxnType[]).map((code) => (
                <button
                  key={code}
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      txnType: code,
                      lines: NEEDS_SHAREHOLDERS.includes(code)
                        ? f.lines.length
                          ? f.lines
                          : [emptyLine()]
                        : [],
                    }))
                  }
                  className={`text-left border rounded-lg p-3 leading-snug ${t === code ? 'border-primary ring-2 ring-primary/20 bg-primary/5' : 'border-border hover:bg-accent'}`}
                >
                  <div className="font-medium text-sm">{TXN_TYPE_LABELS[code]}</div>
                  <div className="text-xs text-muted-foreground mt-1 leading-snug">
                    {TXN_DESC[code]}
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>

          {/* 1.2 รายละเอียด */}
          <Card>
            <CardHeader className="font-semibold">1.2 รายละเอียดเอกสาร</CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <label className="text-sm space-y-1">
                <span className="text-muted-foreground">วันที่ทำรายการ *</span>
                <input
                  type="date"
                  className="w-full border border-border rounded-md px-3 py-2 bg-background"
                  value={form.txnDate}
                  onChange={(e) => setForm({ ...form, txnDate: e.target.value })}
                />
              </label>
              <label className="text-sm space-y-1 md:col-span-3">
                <span className="text-muted-foreground">คำอธิบาย</span>
                <input
                  className="w-full border border-border rounded-md px-3 py-2 bg-background"
                  value={form.description ?? ''}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </label>
              {NEEDS_RESOLUTION.includes(t) && (
                <>
                  <label className="text-sm space-y-1">
                    <span className="text-muted-foreground">เลขที่มติ *</span>
                    <input
                      className="w-full border border-border rounded-md px-3 py-2 bg-background"
                      placeholder="เช่น BOD-2569-02"
                      value={form.resolutionNo ?? ''}
                      onChange={(e) => setForm({ ...form, resolutionNo: e.target.value })}
                    />
                  </label>
                  <label className="text-sm space-y-1">
                    <span className="text-muted-foreground">วันที่มติ *</span>
                    <input
                      type="date"
                      className="w-full border border-border rounded-md px-3 py-2 bg-background"
                      value={form.resolutionDate ?? ''}
                      onChange={(e) => setForm({ ...form, resolutionDate: e.target.value })}
                    />
                  </label>
                </>
              )}
              {NEEDS_PAYMENT.includes(t) && (
                <label className="text-sm space-y-1 md:col-span-2">
                  <span className="text-muted-foreground">ช่องทางเงินสด/ธนาคาร *</span>
                  <select
                    className="w-full border border-border rounded-md px-3 py-2 bg-background"
                    value={form.paymentAccountCode ?? ''}
                    onChange={(e) => setForm({ ...form, paymentAccountCode: e.target.value })}
                  >
                    <option value="">— เลือกบัญชี —</option>
                    {CASH_ACCOUNTS.map((a) => (
                      <option key={a.code} value={a.code}>
                        {a.code} · {a.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </CardContent>
          </Card>

          {/* 1.3 ผู้ถือหุ้น / PRIOR_ADJ */}
          {showSh && (
            <Card>
              <CardHeader className="font-semibold flex-row items-center justify-between">
                <span>1.3 ผู้ถือหุ้น ({form.lines.length} ราย)</span>
                {isInit && (
                  <span
                    className={`text-xs px-2 py-1 rounded-full leading-snug ${initPctPaid >= 25 ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}
                  >
                    ชำระแล้ว {initPctPaid.toFixed(1)}%{' '}
                    {initPctPaid >= 25 ? '✓ ≥25%' : '✗ ต่ำกว่า 25% (ม.1110)'}
                  </span>
                )}
              </CardHeader>
              <CardContent className="space-y-2">
                {form.lines.map((ln, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center">
                    <select
                      className="col-span-4 border border-border rounded-md px-2 py-2 text-sm bg-background"
                      value={ln.shareholderId}
                      onChange={(e) => setLine(i, { shareholderId: e.target.value })}
                    >
                      <option value="">— เลือกผู้ถือหุ้น —</option>
                      {(shareholders.data ?? [])
                        .filter((s) => s.isActive)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                    </select>
                    <input
                      type="number"
                      className="col-span-2 border border-border rounded-md px-2 py-2 text-sm bg-background text-right font-mono"
                      placeholder={isInit ? 'มูลค่าจอง (par)' : 'จำนวนเงิน'}
                      value={ln.amount || ''}
                      onChange={(e) => setLine(i, { amount: parseFloat(e.target.value) || 0 })}
                    />
                    {isInit && (
                      <input
                        type="number"
                        className="col-span-2 border border-border rounded-md px-2 py-2 text-sm bg-background text-right font-mono"
                        placeholder="ชำระจริง"
                        value={ln.paid ?? ''}
                        onChange={(e) =>
                          setLine(i, {
                            paid: e.target.value === '' ? undefined : parseFloat(e.target.value),
                          })
                        }
                      />
                    )}
                    {isInc && (
                      <input
                        type="number"
                        className="col-span-2 border border-border rounded-md px-2 py-2 text-sm bg-background text-right font-mono"
                        placeholder="ส่วนเกินมูลค่า"
                        value={ln.premium ?? ''}
                        onChange={(e) =>
                          setLine(i, {
                            premium: e.target.value === '' ? undefined : parseFloat(e.target.value),
                          })
                        }
                      />
                    )}
                    {isDivPay && (
                      <input
                        type="number"
                        className="col-span-2 border border-border rounded-md px-2 py-2 text-sm bg-background text-right font-mono"
                        placeholder="WHT (เว้นว่าง = อัตโนมัติ)"
                        value={ln.wht ?? ''}
                        onChange={(e) =>
                          setLine(i, {
                            wht: e.target.value === '' ? undefined : parseFloat(e.target.value),
                          })
                        }
                      />
                    )}
                    <button
                      type="button"
                      className="col-span-1 text-destructive"
                      aria-label="ลบผู้ถือหุ้น"
                      onClick={() =>
                        setForm((f) => ({ ...f, lines: f.lines.filter((_, j) => j !== i) }))
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] }))}
                >
                  <Plus className="h-4 w-4 mr-1" /> เพิ่มผู้ถือหุ้น
                </Button>
                {isDivPay && (
                  <p className="text-xs text-muted-foreground leading-snug">
                    เว้นช่อง WHT ว่าง = ระบบคำนวณให้: บุคคลธรรมดา/นิติบุคคลต่างชาติ 10% ·
                    นิติบุคคลไทย 0 (ม.65 ทวิ(10))
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {t === 'PRIOR_ADJ' && (
            <Card>
              <CardHeader className="font-semibold">
                1.3 ปรับปรุงงบย้อนหลัง (ผ่าน 32-1101 เท่านั้น — TAS 8)
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <label className="text-sm space-y-1">
                  <span className="text-muted-foreground">ทิศทาง *</span>
                  <select
                    className="w-full border border-border rounded-md px-3 py-2 bg-background"
                    value={form.paDirection ?? ''}
                    onChange={(e) => setForm({ ...form, paDirection: e.target.value })}
                  >
                    <option value="">— เลือก —</option>
                    <option value="DR_OTHER_CR_RE">Dr บัญชีคู่ / Cr 32-1101 (กำไรสะสมเพิ่ม)</option>
                    <option value="DR_RE_CR_OTHER">Dr 32-1101 / Cr บัญชีคู่ (กำไรสะสมลด)</option>
                  </select>
                </label>
                <label className="text-sm space-y-1">
                  <span className="text-muted-foreground">รหัสบัญชีคู่ *</span>
                  <input
                    className="w-full border border-border rounded-md px-3 py-2 bg-background font-mono"
                    placeholder="เช่น 11-1201"
                    value={form.paAccountCode ?? ''}
                    onChange={(e) => setForm({ ...form, paAccountCode: e.target.value })}
                  />
                </label>
                <label className="text-sm space-y-1">
                  <span className="text-muted-foreground">ยอดปรับปรุง *</span>
                  <input
                    type="number"
                    className="w-full border border-border rounded-md px-3 py-2 bg-background text-right font-mono"
                    value={form.paAmount ?? ''}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        paAmount: e.target.value === '' ? undefined : parseFloat(e.target.value),
                      })
                    }
                  />
                </label>
              </CardContent>
            </Card>
          )}

          <div className="flex justify-end">
            <Button onClick={() => previewMut.mutate()} disabled={previewMut.isPending}>
              ตรวจ Journal <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </QueryBoundary>
      )}

      {step === 2 && preview && (
        <Card>
          <CardHeader className="font-semibold flex-row items-center justify-between">
            <span>2. Journal ที่จะลงบัญชี (สร้างโดยระบบ)</span>
            <span className="text-xs px-2 py-1 rounded-full bg-success/10 text-success leading-snug">
              BALANCED — ตรวจโดย server
            </span>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase">
                  <th className="py-2">รหัส</th>
                  <th>ชื่อบัญชี</th>
                  <th>คำอธิบาย</th>
                  <th className="text-right">Dr</th>
                  <th className="text-right">Cr</th>
                </tr>
              </thead>
              <tbody>
                {preview.lines.map((l, i) => (
                  <tr key={i} className="border-b border-border">
                    <td className="py-2 font-mono text-xs font-semibold">{l.accountCode}</td>
                    <td>{l.accountName}</td>
                    <td className="text-muted-foreground text-xs leading-snug">{l.description}</td>
                    <td className="text-right font-mono">
                      {parseFloat(l.debit) > 0 ? formatNumberDecimal(parseFloat(l.debit), 2) : ''}
                    </td>
                    <td className="text-right font-mono">
                      {parseFloat(l.credit) > 0 ? formatNumberDecimal(parseFloat(l.credit), 2) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {isDivPay && (
              <p className="text-xs text-muted-foreground mt-2 leading-snug">
                WHT ที่คำนวณจริงต่อราย:{' '}
                {preview.resolvedLines
                  .map((r) => `${r.shareholderName} ${formatNumberDecimal(parseFloat(r.wht), 2)}`)
                  .join(' · ')}
              </p>
            )}
            <div className="flex justify-between mt-4">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft className="h-4 w-4 mr-1" /> ย้อนกลับ
              </Button>
              <Button onClick={() => setStep(3)}>
                ถัดไป <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader className="font-semibold">3. ยืนยันบันทึกร่าง</CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg bg-muted p-4 text-sm space-y-1 leading-snug">
              <div>
                ประเภท: <span className="font-medium">{TXN_TYPE_LABELS[t]}</span>
              </div>
              <div>
                ยอดรวม:{' '}
                <span className="font-mono font-semibold">
                  {formatNumberDecimal(
                    t === 'PRIOR_ADJ'
                      ? (form.paAmount ?? 0)
                      : totals.amount + (isInc ? totals.premium : 0),
                    2,
                  )}{' '}
                  บาท
                </span>
              </div>
              {isInit && (
                <div>
                  ชำระจริง {formatNumberDecimal(totals.paid, 2)} · ค้างชำระ (11-1310){' '}
                  {formatNumberDecimal(totals.amount - totals.paid, 2)}
                </div>
              )}
            </div>
            {NEEDS_RESOLUTION.includes(t) && (
              <p className="text-xs text-warning leading-snug">
                ประเภทนี้ต้องแนบไฟล์มติที่ประชุมก่อนลงบัญชี (V8) — แนบได้ในหน้าเอกสารหลังบันทึกร่าง
              </p>
            )}
            {mcQuery.isLoading ? null : mcQuery.isError ? (
              <p className="text-xs text-destructive leading-snug">
                โหลดสถานะ Maker-Checker ไม่สำเร็จ — รีเฟรชหน้า
              </p>
            ) : (
              mcQuery.data?.enabled && (
                <p className="text-xs text-muted-foreground leading-snug">
                  Maker-Checker เปิดอยู่ — หลังบันทึกร่างต้องส่งอนุมัติ
                  และผู้อนุมัติต้องเป็นคนละคนกับผู้สร้าง
                </p>
              )
            )}
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(2)}>
                <ArrowLeft className="h-4 w-4 mr-1" /> ย้อนกลับ
              </Button>
              <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
                <Check className="h-4 w-4 mr-1" /> บันทึกร่าง
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
