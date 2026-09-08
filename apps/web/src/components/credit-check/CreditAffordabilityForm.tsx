import { useEffect, useId, useRef, useState } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';

export interface CreditApprovalPayload {
  verifiedMonthlyIncome: number;
  livingExpenses: number;
  externalMonthlyDebt: number;
  salaryPayDay: number;
  evidenceNotes: string;
  approvedMonthlyPayment: number;
  contextToken: string;
  confirmed: true;
}

export interface CreditApprovalSnapshot extends Omit<CreditApprovalPayload, 'contextToken' | 'confirmed' | 'approvedMonthlyPayment'> {
  approvedMonthlyPayment: number | string;
  id: string;
  internalMonthlyDebt: number | string;
  maximumMonthlyPayment: number | string;
  remainingIncome: number | string;
  policyVersion: string;
  usedByContractId: string | null;
  supersededAt: string | null;
  createdAt: string;
  approvedBy?: { id: string; name: string };
}

interface Preview {
  internalMonthlyDebt: number;
  remainingIncome: number;
  maximumMonthlyPayment: number;
  contextToken: string;
  replacingPendingApproval?: boolean;
  commitments: { id: string; contractNumber: string; monthlyPayment: number }[];
}

type Props = { creditCheckId: string; onChange: (value: CreditApprovalPayload | null) => void };
export default function CreditAffordabilityForm(props: Props) {
  return <CreditAffordabilityFields key={props.creditCheckId} {...props} />;
}

function CreditAffordabilityFields({ creditCheckId, onChange }: {
  creditCheckId: string; onChange: (value: CreditApprovalPayload | null) => void;
}) {
  const id = useId();
  const revision = useRef(0);
  const [values, setValues] = useState({ verifiedMonthlyIncome: '', livingExpenses: '', externalMonthlyDebt: '', salaryPayDay: '', evidenceNotes: '' });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [amount, setAmount] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const complete = [values.verifiedMonthlyIncome, values.livingExpenses, values.externalMonthlyDebt].every(
    value => /^\d+(\.\d{1,2})?$/.test(value) && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 9999999.99,
  ) && values.salaryPayDay !== '' && values.evidenceNotes.trim().length >= 20;
  const amountValid = /^\d+(\.\d{1,2})?$/.test(amount) && Number.isFinite(Number(amount)) && Number(amount) > 0 &&
    !!preview && Number(amount) <= preview.maximumMonthlyPayment;

  useEffect(() => {
    onChange(complete && preview && confirmed && amountValid ? {
      verifiedMonthlyIncome: Number(values.verifiedMonthlyIncome), livingExpenses: Number(values.livingExpenses),
      externalMonthlyDebt: Number(values.externalMonthlyDebt), salaryPayDay: Number(values.salaryPayDay),
      evidenceNotes: values.evidenceNotes.trim(), approvedMonthlyPayment: Number(amount),
      contextToken: preview.contextToken, confirmed: true,
    } : null);
  }, [values, preview, confirmed, amount, amountValid, complete, onChange]);

  function change(field: keyof typeof values, value: string) {
    revision.current += 1;
    setValues(current => ({ ...current, [field]: value }));
    setPreview(null); setConfirmed(false); setAmount(''); setError('');
  }

  async function calculate() {
    const currentRevision = revision.current;
    setPending(true); setError(''); setPreview(null); setConfirmed(false);
    try {
      const { data } = await api.post<Preview>(`/credit-checks/${creditCheckId}/affordability`, {
        verifiedMonthlyIncome: Number(values.verifiedMonthlyIncome), livingExpenses: Number(values.livingExpenses),
        externalMonthlyDebt: Number(values.externalMonthlyDebt), salaryPayDay: Number(values.salaryPayDay),
        evidenceNotes: values.evidenceNotes.trim(),
      });
      if (currentRevision !== revision.current) return;
      setPreview(data); setAmount(String(data.maximumMonthlyPayment));
    } catch (err) {
      if (currentRevision === revision.current) setError(getErrorMessage(err));
    } finally { setPending(false); }
  }

  const inputClass = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm';
  return <div className="space-y-3 border-t border-border pt-3">
    <p className="text-sm font-medium">ยืนยันความสามารถผ่อนชำระ</p>
    <p className="text-xs text-muted-foreground">ทุกยอดเป็นบาทต่อเดือน แยกเงินโอนและเงินกู้จากรายได้ประจำ หนี้ที่หักในสลิปให้นับเพียงครั้งเดียว</p>
    <div className="grid gap-3 sm:grid-cols-2">
      {([
        ['verifiedMonthlyIncome', 'รายได้ประจำที่ยืนยัน (ก่อนหักหนี้)'],
        ['livingExpenses', 'ค่าครองชีพ (ไม่รวมหนี้)'],
        ['externalMonthlyDebt', 'ค่างวดหนี้ภายนอก (ไม่รวม BESTCHOICE)'],
      ] as const).map(([field, label]) => <div key={field}>
        <label htmlFor={`${id}-${field}`} className="mb-1 block text-xs">{label}</label>
        <input id={`${id}-${field}`} className={inputClass} type="number" min="0" max="9999999.99" step="0.01"
          value={values[field]} onChange={event => change(field, event.target.value)} />
      </div>)}
      <div><label htmlFor={`${id}-payday`} className="mb-1 block text-xs">วันเงินเดือนออก / วันครบกำหนดชำระ</label>
        <select id={`${id}-payday`} className={inputClass} value={values.salaryPayDay} onChange={event => change('salaryPayDay', event.target.value)}>
          <option value="">เลือกวันที่ยืนยันแล้ว</option>
          {Array.from({ length: 31 }, (_, index) => index + 1).map(day => <option key={day} value={day}>{day === 31 ? 'สิ้นเดือน' : `วันที่ ${day}`}</option>)}
        </select>
      </div>
    </div>
    <div><label htmlFor={`${id}-evidence`} className="mb-1 block text-xs">หลักฐานและที่มาของตัวเลข (อย่างน้อย 20 ตัวอักษร)</label>
      <textarea id={`${id}-evidence`} className={inputClass} rows={3} maxLength={2000} value={values.evidenceNotes}
        placeholder="ระบุเอกสาร/หน้า ช่วงรายได้ ค่าใช้จ่าย หนี้นอกบัญชี และหลักฐานวันเงินเดือน"
        onChange={event => change('evidenceNotes', event.target.value)} />
    </div>
    <Button type="button" variant="outline" disabled={!complete || pending} onClick={calculate}>{pending ? 'กำลังคำนวณ…' : 'คำนวณเพดาน'}</Button>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {preview && <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
      <p>ภาระ BESTCHOICE: {preview.internalMonthlyDebt.toLocaleString('th-TH')} บาท/เดือน</p>
      {preview.commitments.map(item => <p key={item.id} className="text-xs text-muted-foreground">{item.contractNumber}: {item.monthlyPayment.toLocaleString('th-TH')} บาท/เดือน</p>)}
      <p>เงินเหลือก่อนผ่อนใหม่: {preview.remainingIncome.toLocaleString('th-TH')} บาท/เดือน</p>
      <p className="font-semibold">เพดานที่คำนวณ: {preview.maximumMonthlyPayment.toLocaleString('th-TH')} บาท/เดือน</p>
      {preview.replacingPendingApproval && <p className="text-xs">การยืนยันครั้งนี้จะแทนยอดอนุมัติเดิมที่ยังไม่ได้นำไปใช้</p>}
      {preview.maximumMonthlyPayment <= 0 ? <p role="status">ข้อมูลครบแล้ว คำนวณได้ 0 บาท จึงยังอนุมัติค่างวดใหม่ไม่ได้</p> : <>
      <div><label htmlFor={`${id}-amount`} className="mb-1 block">อนุมัติค่างวดไม่เกิน (บาท/เดือน)</label>
        <input id={`${id}-amount`} className={inputClass} type="number" min="0.01" max={preview.maximumMonthlyPayment} step="0.01"
          value={amount} onChange={event => { setAmount(event.target.value); setConfirmed(false); }} />
        {!amountValid && <p className="text-xs text-destructive">ยอดต้องมากกว่า 0 และไม่เกินเพดานที่คำนวณ</p>}
      </div>
      {amountValid && <p>เงินเหลือหลังผ่อน: {(preview.remainingIncome - Number(amount)).toLocaleString('th-TH')} บาท/เดือน</p>}
      <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmed} disabled={!amountValid}
        onChange={event => setConfirmed(event.target.checked)} />ยืนยันตัวเลขและวันรับเงินกับหลักฐานแล้ว รวมรายจ่ายและหนี้นอกบัญชีครบ โดยไม่หักหนี้ซ้ำ</label>
      </>}
    </div>}
  </div>;
}
