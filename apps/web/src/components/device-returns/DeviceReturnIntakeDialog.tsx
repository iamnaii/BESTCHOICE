import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Check, FileText, Gauge, Lock, PackageX, Search, Store } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import Modal from '@/components/ui/Modal';
import { DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { useDebounce } from '@/hooks/useDebounce';
import { formatNumberDecimal } from '@/utils/formatters';
import { Effect, Section } from './FormSection';
import {
  bkkToday,
  computeDeviationPct,
  formatDeviationLabel,
  DEVICE_RETURN_CREATE_ROLES,
  DEVICE_RETURN_KIND_LABEL,
  GRADES,
  RETURN_REASON_OPTIONS,
  TABLE_DEVIATION_LIMIT_PCT,
  type ConditionGrade,
  type CreateDeviceReturnPayload,
  type DeviceReturnLookupRow,
  type DeviceReturnPreview,
  type DeviceReturnRow,
  type ReturnReason,
} from './types';

interface BranchOption {
  id: string;
  name: string;
  isActive: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** เปิดจากหน้าสัญญา / รายการรอยึดเครื่อง — ล็อกสัญญาไว้ ไม่มีช่องค้นหา */
  initialContractId?: string;
  onCreated?: (row: DeviceReturnRow) => void;
}

const inputClass =
  'w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 outline-hidden';

/**
 * ฟอร์มสาขา "บันทึกรับเครื่องคืน" (spec 2026-09-20 §5.1, §7) — ไม่มีส่วนบัญชี:
 * สาขาบันทึกสภาพ/ราคาประเมิน แล้ว FINANCE ยืนยันใน RepossessionOverlay โหมดยืนยัน.
 * ตรรกะ autoPrice/±15% ยกมาจาก RepossessionOverlay เดิม (ราคาเดียว 2026-09-05) —
 * ค่าที่ระบบเติมจากตารางถูกสลับตามเกรด ค่าที่พิมพ์เองไม่ถูกทับ.
 */
export function DeviceReturnIntakeDialog({ open, onClose, initialContractId, onCreated }: Props) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const role = user?.role ?? '';
  const canCreate = DEVICE_RETURN_CREATE_ROLES.includes(role);
  const isOwner = role === 'OWNER';
  const lockedContract = !!initialContractId;
  const submitting = useRef(false);
  const session = useRef(0);

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search.trim(), 300);
  const [selectedContractId, setSelectedContractId] = useState<string | null>(
    initialContractId ?? null,
  );
  const [conditionGrade, setConditionGrade] = useState<ConditionGrade>('A');
  const [appraisalPrice, setAppraisalPrice] = useState('');
  const [autoPrice, setAutoPrice] = useState<string | null>(null);
  const [repairCost, setRepairCost] = useState('0');
  const [returnReason, setReturnReason] = useState<ReturnReason | ''>('');
  const [notes, setNotes] = useState('');
  const [deviceReceivedAt, setDeviceReceivedAt] = useState(bkkToday);
  const [receivingBranchId, setReceivingBranchId] = useState('');

  // Reset ทุกครั้งที่เปิด — dialog นี้ mount ค้างบนหน้า (open prop) เหมือน CreateBatchDialog
  useEffect(() => {
    session.current += 1;
    if (!open) return;
    setSearch('');
    setSelectedContractId(initialContractId ?? null);
    setConditionGrade('A');
    setAppraisalPrice('');
    setAutoPrice(null);
    setRepairCost('0');
    setReturnReason('');
    setNotes('');
    setDeviceReceivedAt(bkkToday());
    setReceivingBranchId('');
  }, [open, initialContractId]);

  const lookupEnabled = open && !selectedContractId && debouncedSearch.length >= 3;
  const lookup = useQuery<DeviceReturnLookupRow[]>({
    queryKey: ['device-returns', 'lookup', debouncedSearch],
    queryFn: async () =>
      (await api.get(`/device-returns/lookup?q=${encodeURIComponent(debouncedSearch)}`)).data,
    enabled: lookupEnabled,
    staleTime: 10_000,
  });

  const {
    data: preview,
    isLoading: previewLoading,
    isFetching: previewFetching,
    isError: previewFailed,
    error: previewError,
    refetch: retryPreview,
  } = useQuery<DeviceReturnPreview>({
    queryKey: ['device-returns', 'preview', selectedContractId, conditionGrade, appraisalPrice],
    queryFn: async () => {
      const params = new URLSearchParams({ contractId: selectedContractId!, conditionGrade });
      if (appraisalPrice) params.set('appraisalPrice', appraisalPrice);
      return (await api.get(`/device-returns/preview?${params.toString()}`)).data;
    },
    enabled: open && !!selectedContractId,
    placeholderData: (previous) =>
      previous?.contract.id === selectedContractId && previous.valuation?.grade === conditionGrade
        ? previous
        : undefined,
    // สถานะสัญญา/ยอดค้าง/ใบค้างเปลี่ยนได้ระหว่างที่ dialog ปิด
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const branches = useQuery<BranchOption[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get('/branches')).data,
    enabled: open && isOwner,
    staleTime: 60_000,
  });

  // ราคาตารางรับซื้อ (เกรดที่เลือก) → เติมราคาประเมินเป็นค่าตั้งต้นเฉพาะเมื่อช่องว่างหรือยังเป็น
  // ค่าที่ระบบเติมไว้ก่อนหน้า; เปลี่ยนเกรดแล้วไม่พบ → ล้างค่าที่ระบบเติม (ค่าที่พิมพ์เองคงไว้)
  const valuation = preview?.valuation;
  useEffect(() => {
    if (!valuation || valuation.grade !== conditionGrade) return;
    if (valuation.found && valuation.suggestedPrice != null) {
      const s = String(valuation.suggestedPrice);
      if (s === autoPrice) return;
      setAppraisalPrice((cur) => (cur === '' || cur === autoPrice ? s : cur));
      setAutoPrice(s);
    } else if (autoPrice !== null) {
      setAppraisalPrice((cur) => (cur === autoPrice ? '' : cur));
      setAutoPrice(null);
    }
  }, [valuation, conditionGrade, autoPrice]);

  // REPOSSESSION (สัญญา TERMINATED) มีเหตุผลเดียว → ระบบตั้งให้; VOLUNTARY เลือกเองจาก 3 ค่า
  const allowedReasons = useMemo(() => preview?.allowedReasons ?? [], [preview]);
  useEffect(() => {
    if (!preview) return;
    if (allowedReasons.length === 1) {
      setReturnReason(allowedReasons[0]);
    } else if (returnReason && !allowedReasons.includes(returnReason)) {
      setReturnReason('');
    }
  }, [preview, allowedReasons, returnReason]);

  const tablePrice =
    valuation?.found && valuation.grade === conditionGrade ? valuation.suggestedPrice : null;
  const appraisalNum = Number(appraisalPrice);
  const deviationPct = computeDeviationPct(appraisalNum, tablePrice);
  const needsReason = deviationPct !== null && Math.abs(deviationPct) > TABLE_DEVIATION_LIMIT_PCT;
  const reasonMissing = needsReason && notes.trim().length === 0;
  const deviationLabel = formatDeviationLabel(deviationPct);
  const blockedByEligibility = preview?.eligibility.canCreate === false;
  const returnKind = preview?.returnKind ?? null;
  const reasonOptions = RETURN_REASON_OPTIONS.filter((o) => allowedReasons.includes(o.value));
  const reasonLocked = allowedReasons.length === 1;

  const mutation = useMutation({
    retry: false,
    mutationFn: async (submitted: { payload: CreateDeviceReturnPayload; session: number }) => {
      return (await api.post('/device-returns', submitted.payload)).data as DeviceReturnRow;
    },
    onSuccess: (row, submitted) => {
      toast.success(`บันทึกใบรับเครื่องคืน ${row.docNumber} แล้ว — รอ FINANCE ยืนยัน`);
      queryClient.invalidateQueries({ queryKey: ['device-returns'] });
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      queryClient.invalidateQueries({ queryKey: ['contract', row.contract.id] });
      queryClient.invalidateQueries({ queryKey: ['repossessions'] });
      queryClient.invalidateQueries({ queryKey: ['customer-tags'] });
      if (session.current === submitted.session) {
        onCreated?.(row);
        onClose();
      }
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
    onSettled: () => {
      submitting.current = false;
    },
  });

  const computeBlockReason = (): string | null => {
    if (!canCreate) return 'เฉพาะเจ้าของ / ผจก.สาขา / พนักงานขาย บันทึกรับเครื่องคืนได้';
    if (!selectedContractId) return 'กรุณาเลือกสัญญา';
    if (previewLoading || previewFetching) return 'กำลังตรวจสอบสัญญา';
    if (previewFailed) return 'ตรวจสอบสัญญาไม่สำเร็จ กรุณาลองใหม่';
    if (!preview) return 'ยังตรวจสอบสัญญาไม่สำเร็จ';
    if (blockedByEligibility) return preview.eligibility.reason || 'สัญญานี้รับเครื่องคืนไม่ได้';
    if (isOwner && !receivingBranchId) return 'กรุณาเลือกสาขาที่รับเครื่อง';
    if (!deviceReceivedAt) return 'กรุณาระบุวันที่รับเครื่อง';
    if (deviceReceivedAt > bkkToday()) return 'วันที่รับเครื่องต้องไม่เป็นวันในอนาคต';
    if (!Number.isFinite(appraisalNum) || appraisalNum <= 0) {
      return 'กรุณาระบุราคาประเมินมากกว่า 0';
    }
    if (!Number.isFinite(Number(repairCost)) || Number(repairCost) < 0) {
      return 'ค่าซ่อมต้องไม่ติดลบ';
    }
    if (!returnReason || !allowedReasons.includes(returnReason))
      return 'กรุณาเลือกเหตุผลคืนเครื่อง';
    if (returnReason === 'OTHER' && !notes.trim()) return 'กรุณาระบุรายละเอียดเหตุผลคืนเครื่อง';
    if (reasonMissing) {
      return 'กรุณาอธิบายเหตุผลที่ราคาประเมินต่างจากตารางเกิน 15% ในหมายเหตุ';
    }
    if (mutation.isPending) return 'กำลังบันทึกใบรับเครื่องคืน';
    return null;
  };
  const submitBlockReason = computeBlockReason();
  const canSubmit = submitBlockReason === null;

  return (
    <Modal
      isOpen={open}
      onClose={() => {
        if (!submitting.current) onClose();
      }}
      title="บันทึกรับเครื่องคืน"
      size="lg"
    >
      <DialogDescription className="sr-only leading-snug">
        บันทึกสภาพเครื่องและราคาประเมิน เพื่อส่งให้ฝ่ายการเงินยืนยัน
      </DialogDescription>
      <fieldset disabled={mutation.isPending} className="space-y-4 min-w-0">
        {!canCreate && (
          <div className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/10 px-3 py-3">
            <Lock className="size-4 text-warning shrink-0 mt-0.5" />
            <div className="text-xs text-warning leading-snug">
              <strong className="block">
                บันทึกรับเครื่องคืนได้เฉพาะเจ้าของ / ผจก.สาขา / พนักงานขาย
              </strong>
              บทบาทนี้ดูได้อย่างเดียว — ให้สาขาที่รับเครื่องเป็นผู้บันทึก
            </div>
          </div>
        )}

        {/* 1. สัญญา — ค้นหา หรือสรุปสัญญาที่เลือก/ล็อกไว้ */}
        <Section
          icon={<Search className="size-4" />}
          title="สัญญา"
          subtitle="ค้นด้วยเลขสัญญา / เบอร์โทร / IMEI"
        >
          {!selectedContractId ? (
            <div className="space-y-2">
              <input
                id="device-return-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={inputClass}
                placeholder="เลขสัญญา / เบอร์โทร / IMEI (อย่างน้อย 3 ตัวอักษร)"
                autoFocus
              />
              {lookupEnabled && lookup.isLoading && (
                <p className="text-xs text-muted-foreground leading-snug">กำลังค้นหา...</p>
              )}
              {lookupEnabled && lookup.isError && (
                <p role="alert" className="text-xs text-destructive leading-snug">
                  ค้นหาไม่สำเร็จ: {getErrorMessage(lookup.error)}
                </p>
              )}
              {lookupEnabled && lookup.data && lookup.data.length === 0 && (
                <p className="text-xs text-muted-foreground leading-snug">
                  ไม่พบสัญญาที่ตรงกับคำค้น
                </p>
              )}
              {lookupEnabled && lookup.data && lookup.data.length > 0 && (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {lookup.data.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedContractId(row.id)}
                        className="w-full text-left px-3 py-2 hover:bg-accent transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-semibold text-sm">
                            {row.contractNumber}
                          </span>
                          <span className="text-xs text-muted-foreground">{row.status}</span>
                        </div>
                        <div className="text-xs text-muted-foreground leading-snug">
                          {row.customer.name}
                          {row.product && ` · ${row.product.brand} ${row.product.model}`}
                          {row.product?.imeiSerial && ` · ${row.product.imeiSerial}`}
                          {row.branch && ` · ${row.branch.name}`}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">สัญญา: </span>
                <span className="font-mono font-semibold">
                  {preview?.contract.contractNumber ?? '…'}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">ลูกค้า: </span>
                <span className="font-medium">{preview?.contract.customer.name ?? '…'}</span>
              </div>
              {preview?.contract.product && (
                <div>
                  <span className="text-muted-foreground">สินค้า: </span>
                  <span className="font-medium">
                    {preview.contract.product.brand} {preview.contract.product.model}
                    {preview.contract.product.storage ? ` ${preview.contract.product.storage}` : ''}
                  </span>
                  {preview.contract.product.imeiSerial && (
                    <span className="block text-xs text-muted-foreground font-mono">
                      {preview.contract.product.imeiSerial}
                    </span>
                  )}
                </div>
              )}
              {preview?.contract.branch && (
                <div>
                  <span className="text-muted-foreground">สาขาสัญญา: </span>
                  <span className="font-medium">{preview.contract.branch.name}</span>
                </div>
              )}
              <div>
                <span className="text-muted-foreground">ยอดค้าง: </span>
                <span className="font-medium">
                  {preview ? `${formatNumberDecimal(preview.outstandingBalance, 2)} ฿` : '…'}
                </span>
              </div>
              {!lockedContract && (
                <div className="col-span-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedContractId(null);
                      setSearch('');
                      setConditionGrade('A');
                      setAppraisalPrice('');
                      setAutoPrice(null);
                      setRepairCost('0');
                      setReturnReason('');
                      setNotes('');
                    }}
                    className="text-xs text-primary underline"
                  >
                    เปลี่ยนสัญญา
                  </button>
                </div>
              )}
            </div>
          )}
        </Section>

        {selectedContractId && previewFailed && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
          >
            <p>ตรวจสอบสัญญาไม่สำเร็จ: {getErrorMessage(previewError)}</p>
            <button type="button" onClick={() => retryPreview()} className="mt-2 underline">
              ลองใหม่
            </button>
          </div>
        )}

        {/* รับคืนไม่ได้ (สถานะ/ยอดค้าง 0/เครื่องเคยยึด/ใบค้าง) — บอกตั้งแต่เลือกสัญญา ไม่รอชน 400 */}
        {blockedByEligibility && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning leading-snug"
          >
            <AlertTriangle className="size-4 mt-0.5 shrink-0" />
            <span>{preview?.eligibility.reason}</span>
          </div>
        )}

        {selectedContractId && (
          <>
            {/* 2. ประเภท (ระบบเลือก) + เหตุผล + วันที่รับ */}
            <Section
              icon={<PackageX className="size-4" />}
              title="การรับคืน"
              subtitle="ประเภท (ระบบเลือกจากสถานะสัญญา), เหตุผล, วันที่รับเครื่อง"
            >
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="block text-xs font-medium text-foreground mb-1.5 leading-snug">
                    ประเภท
                  </span>
                  {returnKind ? (
                    <Badge
                      variant={returnKind === 'REPOSSESSION' ? 'destructive' : 'warning'}
                      appearance="light"
                      size="md"
                      data-testid="device-return-kind"
                    >
                      {DEVICE_RETURN_KIND_LABEL[returnKind]}
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </div>
                <div>
                  <label
                    htmlFor="device-return-received-at"
                    className="block text-xs font-medium text-foreground mb-1.5 leading-snug"
                  >
                    วันที่รับเครื่อง <span className="text-destructive">*</span>
                  </label>
                  <input
                    id="device-return-received-at"
                    type="date"
                    value={deviceReceivedAt}
                    max={bkkToday()}
                    onChange={(e) => setDeviceReceivedAt(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div className="col-span-2">
                  <label
                    htmlFor="device-return-reason"
                    className="block text-xs font-medium text-foreground mb-1.5 leading-snug"
                  >
                    เหตุผลคืนเครื่อง <span className="text-destructive">*</span>
                  </label>
                  <select
                    id="device-return-reason"
                    value={returnReason}
                    onChange={(e) => setReturnReason(e.target.value as ReturnReason | '')}
                    disabled={reasonLocked}
                    className={inputClass}
                  >
                    <option value="">— เลือกเหตุผลคืนเครื่อง —</option>
                    {reasonOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {reasonLocked && (
                    <p className="mt-1 text-[11px] text-muted-foreground leading-snug">
                      สัญญาบอกเลิกแล้ว — เหตุผลถูกตั้งเป็น "รับเครื่องคืนหลังบอกเลิกสัญญา" โดยระบบ
                    </p>
                  )}
                </div>
              </div>
            </Section>

            {/* 3. สภาพเครื่อง + ราคาประเมิน (ตารางรับซื้อเติมให้ ปรับได้ เตือน ±15%) */}
            <Section
              icon={<Gauge className="size-4" />}
              title="สภาพเครื่อง + ราคาประเมิน"
              subtitle="เกรดสภาพ, ราคาประเมิน (ตารางรับซื้อเติมให้ ปรับได้), ค่าซ่อม"
            >
              <div className="space-y-4">
                <div>
                  <span className="block text-xs font-medium text-foreground mb-1.5 leading-snug">
                    เกรดสภาพ <span className="text-destructive">*</span>
                  </span>
                  <div className="flex gap-2">
                    {GRADES.map((g) => (
                      <button
                        key={g}
                        type="button"
                        aria-pressed={conditionGrade === g}
                        onClick={() => setConditionGrade(g)}
                        className={`flex-1 px-2 py-2 text-sm rounded-lg border transition-colors ${
                          conditionGrade === g
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-background border-input hover:bg-muted'
                        }`}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="device-return-appraisal"
                      className="block text-xs font-medium text-foreground mb-1.5 leading-snug"
                    >
                      ราคาประเมิน (฿) <span className="text-destructive">*</span>
                    </label>
                    <input
                      id="device-return-appraisal"
                      type="number"
                      min={0}
                      step="0.01"
                      value={appraisalPrice}
                      onChange={(e) => setAppraisalPrice(e.target.value)}
                      className={`${inputClass} text-right font-mono`}
                      placeholder="0.00"
                    />
                    {valuation && valuation.grade === conditionGrade && (
                      <p
                        className={`mt-1 text-[11px] leading-snug ${
                          reasonMissing
                            ? 'text-destructive'
                            : valuation.found
                              ? 'text-muted-foreground'
                              : 'text-warning'
                        }`}
                      >
                        {!valuation.found
                          ? `ไม่มีรุ่นนี้ในตารางรับซื้อ (เกรด ${valuation.grade}) ตีราคาเอง`
                          : reasonMissing
                            ? `ต่างจากตารางรับซื้อ ${deviationLabel} (เกิน 15%) — ต้องระบุเหตุผลในหมายเหตุก่อนบันทึก`
                            : `ตารางรับซื้อ เกรด ${valuation.grade}: ${formatNumberDecimal(valuation.suggestedPrice ?? 0, 2)} ฿` +
                              (appraisalPrice === autoPrice
                                ? ' (ค่าตั้งต้น ปรับตามสภาพจริงได้)'
                                : deviationLabel
                                  ? ` · ต่างจากตาราง ${deviationLabel}`
                                  : '')}
                      </p>
                    )}
                  </div>
                  <div>
                    <label
                      htmlFor="device-return-repair-cost"
                      className="block text-xs font-medium text-foreground mb-1.5 leading-snug"
                    >
                      ค่าซ่อม (฿)
                    </label>
                    <input
                      id="device-return-repair-cost"
                      type="number"
                      min={0}
                      step="0.01"
                      value={repairCost}
                      onChange={(e) => setRepairCost(e.target.value)}
                      className={`${inputClass} text-right font-mono`}
                      placeholder="0.00"
                    />
                  </div>
                </div>
              </div>
            </Section>

            {/* 4. หมายเหตุ */}
            <Section
              icon={<FileText className="size-4" />}
              title="หมายเหตุ"
              subtitle="บังคับเมื่อเหตุผล = อื่น ๆ หรือราคาต่างจากตารางเกิน 15%"
            >
              <label htmlFor="device-return-notes" className="block text-xs font-medium mb-1.5">
                รายละเอียดเพิ่มเติม{' '}
                {returnReason === 'OTHER' || needsReason ? (
                  <span className="text-destructive">*</span>
                ) : (
                  '(ถ้ามี)'
                )}
              </label>
              <textarea
                id="device-return-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                maxLength={1000}
                className={`${inputClass} resize-none`}
                placeholder="เช่น สภาพเครื่อง หรือเหตุผลที่ราคาประเมินต่างจากตาราง..."
              />
              {needsReason && (
                <p className="text-xs text-warning mt-1 leading-snug">
                  กรุณาอธิบายเหตุผลที่ราคาประเมินต่างจากตารางเกิน 15%
                </p>
              )}
            </Section>

            {/* 5. OWNER เท่านั้น — สาขาที่รับเครื่องจริง (D7: รับได้ทุกสาขา ใบเก็บสาขาที่รับ) */}
            {isOwner && (
              <Section
                icon={<Store className="size-4" />}
                title="สาขาที่รับเครื่อง"
                subtitle="เจ้าของต้องระบุสาขาที่รับเครื่องจริง (สาขาบันทึกเองใช้สาขาตัวเอง)"
              >
                <label
                  htmlFor="device-return-branch"
                  className="block text-xs font-medium text-foreground mb-1.5 leading-snug"
                >
                  สาขาที่รับเครื่อง <span className="text-destructive">*</span>
                </label>
                <select
                  id="device-return-branch"
                  value={receivingBranchId}
                  onChange={(e) => setReceivingBranchId(e.target.value)}
                  className={inputClass}
                >
                  <option value="">— เลือกสาขา —</option>
                  {(branches.data ?? [])
                    .filter((b) => b.isActive)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                </select>
                {branches.isError && (
                  <div role="alert" className="mt-2 text-sm text-destructive leading-snug">
                    <p>โหลดสาขาไม่สำเร็จ: {getErrorMessage(branches.error)}</p>
                    <button type="button" className="underline" onClick={() => branches.refetch()}>
                      โหลดสาขาอีกครั้ง
                    </button>
                  </div>
                )}
              </Section>
            )}

            {/* 6. สิ่งที่จะเกิดขึ้น — ไม่มีการลงบัญชีในขั้นนี้ */}
            <Section
              icon={<Check className="size-4" />}
              title="สิ่งที่จะเกิดขึ้นเมื่อบันทึก"
              subtitle="ไม่มีการลงบัญชีในขั้นนี้ — FINANCE ลงบัญชีตอนยืนยัน"
              tone="success"
            >
              <ul className="space-y-1.5 text-sm">
                {returnKind === 'VOLUNTARY' && (
                  <Effect text="สัญญาหยุดนับค่างวดและค่าปรับทันที (สถานะ → บอกเลิกสัญญา) — ส่งกลับ/ยกเลิกใบจะคืนสถานะเดิมเฉพาะเมื่อมีสถานะเดิมบันทึกไว้และสัญญายังอยู่ในสถานะบอกเลิก" />
                )}
                {returnKind === 'REPOSSESSION' && (
                  <Effect text="สัญญาบอกเลิกอยู่แล้ว — สถานะไม่เปลี่ยนจนกว่า FINANCE ยืนยัน" />
                )}
                <Effect text="แจ้งลูกค้าทางไลน์ทันที (ไม่มีราคาประเมินในข้อความ)" />
                <Effect text="รอ FINANCE ยืนยันบัญชี (JP5 + ขาคู่ SHOP) — ค่าเครื่องหักในรอบจ่าย INTER-CO ถัดไป" />
                <Effect text="ปลดล็อค MDM (PJ-Soft) — ต้องทำ manual" warning />
              </ul>
            </Section>
          </>
        )}

        {/* Footer */}
        <div className="border-t border-border pt-3 space-y-3">
          {submitBlockReason && (
            <div
              id="device-return-submit-block"
              role="status"
              className="text-sm text-warning leading-snug"
            >
              {submitBlockReason}
            </div>
          )}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={mutation.isPending}
              className="px-5 py-2.5 text-sm border border-border rounded-lg hover:bg-accent transition-colors"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={() => {
                if (!canSubmit || submitting.current) return;
                submitting.current = true;
                mutation.mutate({
                  session: session.current,
                  payload: {
                    contractId: selectedContractId!,
                    deviceReceivedAt,
                    conditionGrade,
                    appraisalPrice: appraisalNum,
                    repairCost: repairCost ? Number(repairCost) : 0,
                    returnReason: returnReason as ReturnReason,
                    notes: notes.trim() || undefined,
                    receivingBranchId: isOwner ? receivingBranchId : undefined,
                  },
                });
              }}
              disabled={!canSubmit}
              title={submitBlockReason ?? undefined}
              aria-describedby={submitBlockReason ? 'device-return-submit-block' : undefined}
              className="px-6 py-2.5 text-sm bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg disabled:opacity-50 font-semibold transition-colors"
            >
              {mutation.isPending ? 'กำลังบันทึก...' : 'บันทึกรับเครื่องคืน'}
            </button>
          </div>
        </div>
      </fieldset>
    </Modal>
  );
}
