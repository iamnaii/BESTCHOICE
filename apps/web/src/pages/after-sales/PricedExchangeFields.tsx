import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import api from '@/lib/api';
import {
  afterSalesKeys,
  APPROVER_LABEL,
  TIER_LABEL,
  baht,
  type ExchangeApprovalTier,
} from './after-sales';

export interface PricedForm {
  buybackPrice: string;
  deviceCondition: 'A' | 'B' | 'C' | 'D';
  newTotalMonths: string;
  newInterestRatePct: string;
  conditionNote: string;
}

export interface ExchangePreview {
  mode: 'MEMO' | 'PRICED' | null;
  tier: ExchangeApprovalTier | null;
  ncv: string;
  marketMin: string | null;
  expectedPl: string | null;
  blockers: { overdueBlocked: boolean; advanceBlocked: boolean };
  hasUnpaidLateFee: boolean;
  plan: {
    financedAmount: string;
    storeCommission: string;
    interestTotal: string;
    vatAmount: string;
    monthlyPayment: string;
  } | null;
}

interface PricedExchangeFieldsProps {
  imei: string;
  replacementProductId: string | null;
  value: PricedForm;
  onChange: (v: PricedForm) => void;
  /** ให้หน้าแม่อ่าน mode/blockers/tier ไปตัดสินปุ่มบันทึก + สรุปก่อนบันทึก — คอมโพเนนต์นี้ยังเป็น
   * เจ้าของ preview query เดียวเหมือนเดิม แค่รายงานผลขึ้นไปเพิ่ม (เหมือน ReplacementProductPicker) */
  onPreviewChange?: (preview: ExchangePreview | null) => void;
}

const inputClass =
  'h-11 w-full rounded-lg border border-input bg-background px-3.5 text-sm leading-snug text-foreground placeholder:text-muted-foreground/70';
const areaClass =
  'w-full resize-none rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm leading-snug text-foreground placeholder:text-muted-foreground/70';

const TIER_TILE: Record<ExchangeApprovalTier, string> = {
  AUTO: 'border-primary/20 bg-primary/10 text-primary',
  REVIEW: 'border-warning/40 bg-warning/10 text-warning-strong',
  ESCALATE: 'border-destructive/30 bg-destructive/10 text-destructive',
};

/** ผู้อนุมัติตาม tier — REVIEW/ESCALATE มีป้ายเฉพาะ (คำสั่งเจ้าของ), AUTO ใช้ TIER_LABEL เดิม */
export function tierApproverText(tier: ExchangeApprovalTier): string {
  if (tier === 'REVIEW') return 'ผจก.สาขาอนุมัติ';
  // T10-2 — ป้ายเต็มประโยคคู่กับ REVIEW ('ผจก.สาขาอนุมัติ')
  if (tier === 'ESCALATE') return `${APPROVER_LABEL.OWNER}อนุมัติ`;
  return TIER_LABEL.AUTO;
}

/** ดอกเบี้ยเดินทางเป็นเศษส่วนดิบเสมอ (0.08 = 8%/เดือน) แต่ UI แสดง/แก้เป็น % (8.00) — ย้ายมาจาก
 * หน้า /insurance/exchange-request/new เดิม (ถูกลบแล้ว Task 13) แปลง pct -> rate ให้ preview query + submit payload */
export function pctToRate(pct: string): string | undefined {
  const n = parseFloat(pct);
  return Number.isFinite(n) ? (n / 100).toString() : undefined;
}

/** ฟอร์มเปลี่ยนแบบมีราคา — ราคารับซื้อ/สภาพ/งวด/ดอกเบี้ย + preview tier/NCV/blockers สด (ย้าย
 * previewQ จากหน้า /insurance/exchange-request/new เดิม เปลี่ยน URL เป็น imei + replacementProductId) */
export default function PricedExchangeFields({
  imei,
  replacementProductId,
  value,
  onChange,
  onPreviewChange,
}: PricedExchangeFieldsProps) {
  const preview = useQuery<ExchangePreview>({
    queryKey: afterSalesKeys.preview({
      imei,
      replacementProductId,
      buybackPrice: value.buybackPrice,
      deviceCondition: value.deviceCondition,
      newTotalMonths: value.newTotalMonths,
      newInterestRatePct: value.newInterestRatePct,
    }),
    queryFn: async () => {
      const params: Record<string, string> = { imei };
      if (replacementProductId) params.replacementProductId = replacementProductId;
      if (value.buybackPrice) params.buybackPrice = value.buybackPrice;
      if (value.deviceCondition) params.deviceCondition = value.deviceCondition;
      if (value.newTotalMonths) params.newTotalMonths = value.newTotalMonths;
      const rate = pctToRate(value.newInterestRatePct);
      if (rate !== undefined) params.newInterestRate = rate;
      return (await api.get('/after-sales/exchange/preview', { params })).data;
    },
    enabled: !!imei && !!replacementProductId,
  });

  useEffect(() => {
    onPreviewChange?.(preview.data ?? null);
  }, [preview.data, onPreviewChange]);

  const isMemo = preview.data?.mode === 'MEMO';

  return (
    <div className="space-y-3">
      {isMemo ? (
        <div className="rounded-lg border border-primary/20 bg-primary/10 p-3 text-sm font-semibold leading-snug text-primary">
          ราคาเท่าเดิม (MEMO)
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label
                htmlFor="pf-buyback"
                className="block text-xs leading-snug text-muted-foreground"
              >
                ราคารับซื้อเครื่องเดิม (บาท) <span className="text-destructive">*</span>
              </label>
              <input
                id="pf-buyback"
                inputMode="decimal"
                value={value.buybackPrice}
                onChange={(e) => onChange({ ...value, buybackPrice: e.target.value })}
                className={inputClass}
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="pf-condition"
                className="block text-xs leading-snug text-muted-foreground"
              >
                สภาพเครื่อง
              </label>
              <select
                id="pf-condition"
                value={value.deviceCondition}
                onChange={(e) =>
                  onChange({
                    ...value,
                    deviceCondition: e.target.value as PricedForm['deviceCondition'],
                  })
                }
                className={inputClass}
              >
                {(['A', 'B', 'C', 'D'] as const).map((c) => (
                  <option key={c} value={c}>
                    เกรด {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label
                htmlFor="pf-months"
                className="block text-xs leading-snug text-muted-foreground"
              >
                จำนวนงวดสัญญาใหม่
              </label>
              <input
                id="pf-months"
                inputMode="numeric"
                value={value.newTotalMonths}
                onChange={(e) => onChange({ ...value, newTotalMonths: e.target.value })}
                className={inputClass}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="pf-rate" className="block text-xs leading-snug text-muted-foreground">
                อัตราดอกเบี้ย (%/เดือน)
              </label>
              <input
                id="pf-rate"
                inputMode="decimal"
                value={value.newInterestRatePct}
                onChange={(e) => onChange({ ...value, newInterestRatePct: e.target.value })}
                className={inputClass}
              />
            </div>
          </div>
          <div className="space-y-1">
            <label htmlFor="pf-note" className="block text-xs leading-snug text-muted-foreground">
              หมายเหตุสภาพเครื่อง
            </label>
            <textarea
              id="pf-note"
              rows={2}
              value={value.conditionNote}
              onChange={(e) => onChange({ ...value, conditionNote: e.target.value })}
              className={areaClass}
            />
          </div>
        </>
      )}

      {preview.data?.tier && (
        <div className="flex flex-wrap items-center gap-2 text-sm leading-snug">
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold leading-snug ${TIER_TILE[preview.data.tier]}`}
          >
            {tierApproverText(preview.data.tier)}
          </span>
          <span className="text-xs text-muted-foreground">
            NCV ฿{baht(preview.data.ncv)}
            {preview.data.marketMin
              ? ` · ราคากลางขั้นต่ำ ฿${baht(preview.data.marketMin)}`
              : ' · ไม่มีราคากลางรุ่นนี้'}
          </span>
        </div>
      )}

      {preview.data?.expectedPl && (
        <p
          className={`text-sm leading-snug ${preview.data.expectedPl.startsWith('-') ? 'text-destructive' : 'text-primary'}`}
        >
          {preview.data.expectedPl.startsWith('-')
            ? `ขาดทุนจากการเปลี่ยนเครื่อง: ฿${baht(preview.data.expectedPl.slice(1))}`
            : `กำไรจากการเปลี่ยนเครื่อง: ฿${baht(preview.data.expectedPl)}`}
        </p>
      )}

      {preview.data?.blockers.overdueBlocked && (
        <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm leading-snug text-destructive">
          <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          มีงวดค้างชำระ — เคลียร์ก่อนเปลี่ยนเครื่อง
        </p>
      )}
      {preview.data?.blockers.advanceBlocked && (
        <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm leading-snug text-destructive">
          <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          มีเงินรับล่วงหน้า/เครดิตค้าง — ใช้หรือคืนก่อนเปลี่ยนเครื่อง
        </p>
      )}
      {preview.data?.hasUnpaidLateFee && (
        <p className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm leading-snug text-warning-strong">
          <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          มีค่าปรับล่าช้าค้างเก็บ — แนะนำเก็บก่อนเปลี่ยนเครื่อง
        </p>
      )}
      {preview.isError && (
        <p className="flex items-center gap-2 text-sm leading-snug text-destructive">
          <AlertTriangle aria-hidden className="h-4 w-4 shrink-0" />
          โหลดข้อมูลตรวจสอบไม่สำเร็จ
        </p>
      )}

      {preview.data?.plan && (
        <p className="text-xs leading-snug text-muted-foreground">
          สัญญาใหม่: ฿{baht(preview.data.plan.financedAmount)} · ดอกเบี้ย ฿
          {baht(preview.data.plan.interestTotal)} · VAT ฿{baht(preview.data.plan.vatAmount)} →
          ค่างวด{' '}
          <span className="font-semibold text-foreground">
            ฿{baht(preview.data.plan.monthlyPayment)}
          </span>
          /งวด
        </p>
      )}
    </div>
  );
}
