import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, FileText } from 'lucide-react';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { useDebounce } from '@/hooks/useDebounce';
import {
  SUPPLIER_DOC_LABEL,
  SUPPLIER_DOC_NUMBER_MAX,
  SUPPLIER_DOC_TYPES,
  bangkokTodayIso,
  earliestSupplierDocIso,
  formatIsoDate,
  formatIsoMonth,
  type SupplierDocErrors,
  type SupplierDocForm,
} from '../supplier-doc.util';
import { fieldCls } from './UnitInspectScreen';

export interface ReceivingDocCheck {
  duplicates: { grNumber: string; receivedAt: string; poNumber: string }[];
  periodClosed: boolean;
}

/**
 * ตัวตรวจก่อนกดยืนยัน (เตือน ไม่บล็อก) — เลขที่ซ้ำของผู้จัดจำหน่ายรายนี้ + งวดของวันที่ในเอกสารปิดแล้วหรือยัง.
 * ใช้ตัวตัดสินงวดตัวเดียวกับตอนลงบัญชี (`GET /purchase-orders/receiving-doc-check`)
 */
export function useSupplierDocCheck(supplierId: string | undefined, doc: SupplierDocForm): ReceivingDocCheck | undefined {
  const withDoc = doc.type !== 'NONE';
  const number = useDebounce(withDoc ? doc.number.trim() : '', 400);
  const date = withDoc ? doc.date : '';
  const enabled = Boolean(supplierId) && Boolean(number || date);
  const { data } = useQuery({
    queryKey: ['purchase-orders', 'receiving-doc-check', supplierId, number, date],
    queryFn: async () => {
      const res = await api.get<ReceivingDocCheck>('/purchase-orders/receiving-doc-check', {
        params: { supplierId, docNumber: number || undefined, docDate: date || undefined },
      });
      return res.data;
    },
    enabled,
    staleTime: 30_000,
  });
  return enabled ? data : undefined;
}

export interface SupplierDocSectionProps {
  doc: SupplierDocForm;
  setDoc: (doc: SupplierDocForm) => void;
  supplierHasVat: boolean;
  /** ผลตรวจเลขซ้ำ/งวดปิด — ผู้เรียกถือไว้เพื่อใช้กับบรรทัด "ลงบัญชีวันที่" ในกล่องสรุปด้วย */
  check: ReceivingDocCheck | undefined;
  /** แสดงหลังกดยืนยันครั้งแรก (ไม่ขึ้นแดงตั้งแต่ยังไม่ได้กรอก) */
  errors: SupplierDocErrors;
  className?: string;
}

const hintCls = 'text-xs leading-snug text-muted-foreground';
const errorCls = 'mt-1 text-xs leading-snug text-destructive';
const warnCls = 'flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-[13px] leading-snug text-warning-strong';

/**
 * เอกสารจากผู้จัดจำหน่าย — ประเภท · เลขที่ · วันที่ในเอกสาร (ข3, แบบหน้าจอที่เจ้าของเคาะ 2026-10-01).
 * วันที่ในเอกสาร = วันที่ลงบัญชีรับสินค้า (งวดปิด = ลงวันที่รับของแทน). ไม่มีเอกสาร = ซ่อนเลขที่/วันที่
 * และบอกให้เขียนเหตุผลในหมายเหตุใบรับ (ช่องหมายเหตุอยู่กับผู้เรียก)
 */
export function SupplierDocSection({ doc, setDoc, supplierHasVat, check, errors, className }: SupplierDocSectionProps) {
  const today = bangkokTodayIso();
  const withDoc = doc.type !== 'NONE';
  const defaultHint = supplierHasVat
    ? 'ผู้จัดจำหน่ายจด VAT จึงเลือกใบกำกับภาษีไว้ให้ก่อน'
    : 'ผู้จัดจำหน่ายไม่จด VAT จึงเลือกใบส่งของ / ใบแจ้งหนี้ไว้ให้ก่อน — เปลี่ยนได้';
  const duplicate = withDoc ? check?.duplicates[0] : undefined;
  const periodClosed = withDoc && Boolean(doc.date) && check?.periodClosed === true;

  return (
    <section className={cn('rounded-[10px] border border-border p-3.5 sm:p-4', className)} aria-label="เอกสารจากผู้จัดจำหน่าย">
      <div className="mb-3 flex items-center gap-2">
        <FileText className="size-4 text-muted-foreground" />
        <h4 className="text-sm font-semibold leading-snug">เอกสารจากผู้จัดจำหน่าย</h4>
      </div>

      <div className="mb-1.5 text-[13px] text-muted-foreground" id="supplier-doc-type-label">
        ประเภทเอกสาร
      </div>
      <div role="radiogroup" aria-labelledby="supplier-doc-type-label" className="flex flex-wrap gap-2">
        {SUPPLIER_DOC_TYPES.map((type) => {
          const active = doc.type === type;
          return (
            <button
              key={type}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setDoc({ ...doc, type })}
              className={cn(
                'inline-flex min-h-10 items-center rounded-lg border px-3 text-sm leading-snug transition-colors',
                active ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-border hover:bg-accent',
              )}
            >
              {SUPPLIER_DOC_LABEL[type]}
            </button>
          );
        })}
      </div>

      {withDoc ? (
        <>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="supplier-doc-number" className="mb-1.5 block text-[13px] text-muted-foreground">
                เลขที่เอกสาร
              </label>
              <input
                id="supplier-doc-number"
                value={doc.number}
                onChange={(e) => setDoc({ ...doc, number: e.target.value })}
                maxLength={SUPPLIER_DOC_NUMBER_MAX}
                placeholder="เช่น IV2610-0123"
                aria-invalid={Boolean(errors.number)}
                className={cn(fieldCls, errors.number && 'border-destructive')}
              />
              {errors.number && <p className={errorCls}>{errors.number}</p>}
            </div>
            <div>
              <label htmlFor="supplier-doc-date" className="mb-1.5 block text-[13px] text-muted-foreground">
                วันที่ในเอกสาร
              </label>
              <input
                id="supplier-doc-date"
                type="date"
                value={doc.date}
                min={earliestSupplierDocIso(today)}
                max={today}
                onChange={(e) => setDoc({ ...doc, date: e.target.value })}
                aria-invalid={Boolean(errors.date)}
                className={cn(fieldCls, errors.date && 'border-destructive')}
              />
              {errors.date && <p className={errorCls}>{errors.date}</p>}
            </div>
          </div>
          <p className={cn(hintCls, 'mt-2')}>ระบบลงบัญชีรับสินค้าด้วยวันที่นี้ ไม่ใช่วันที่กดรับ · {defaultHint}</p>
        </>
      ) : (
        <p className={cn(hintCls, 'mt-3')}>
          ระบบลงบัญชีรับสินค้าด้วย วันที่รับของ ({formatIsoDate(today)}) · กรุณาเขียนเหตุผลที่ไม่มีเอกสารในช่องหมายเหตุ
        </p>
      )}

      {(duplicate || periodClosed) && (
        <div className="mt-3 space-y-2">
          {periodClosed && (
            <div className={warnCls} role="status">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                เดือน{formatIsoMonth(doc.date)} ปิดงวดบัญชีแล้ว — ระบบจะลงบัญชีรับสินค้าวันที่รับของ ({formatIsoDate(today)}) แทน ·
                เก็บวันที่ในเอกสารไว้ตามจริง และแจ้งฝ่ายบัญชีให้ทราบ
              </span>
            </div>
          )}
          {duplicate && (
            <div className={warnCls} role="status">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                เลขที่ {doc.number.trim()} เคยใช้กับใบรับของ {duplicate.grNumber} ของผู้จัดจำหน่ายรายนี้ — ตรวจว่าไม่ได้กรอกซ้ำ
                (ยังรับของได้)
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
