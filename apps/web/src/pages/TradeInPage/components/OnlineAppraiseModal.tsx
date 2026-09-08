import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import Modal from '@/components/ui/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import AppraisalModal from './AppraisalModal';
import type { TradeIn } from '../types';

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
  const [manualPrice, setManualPrice] = useState('');
  const [manualReason, setManualReason] = useState('');
  const [cashFallback, setCashFallback] = useState(false);
  const [eligibleItemId, setEligibleItemId] = useState<string | null>(null);
  const eligibilityRequired = item?.quoteBreakdown?.eligibilityRequired === true;
  const deviceEligibilityConfirmed = !!item && eligibleItemId === item.id;

  const appraise = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.patch(`/trade-ins/${item!.id}/appraise-online`, body),
    onSuccess: () => {
      toast.success('ยืนยันราคาเรียบร้อย');
      queryClient.invalidateQueries({ queryKey: ['trade-ins'] });
      if (item) queryClient.invalidateQueries({ queryKey: ['trade-in-detail', item.id] });
      resetAndClose();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  function handleClose() {
    if (appraise.isPending) return;
    resetAndClose();
  }

  function resetAndClose() {
    setMode('AS_ANSWERED');
    setManualPrice('');
    setManualReason('');
    setCashFallback(false);
    setEligibleItemId(null);
    onClose();
  }

  function confirm() {
    if (appraise.isPending || (eligibilityRequired && !deviceEligibilityConfirmed)) return;
    const eligibility = eligibilityRequired ? { deviceEligibilityConfirmed } : {};
    if (mode === 'AS_ANSWERED') {
      appraise.mutate({ mode, ...(cashFallback ? { useCashPrice: true } : {}), ...eligibility });
    } else if (mode === 'MANUAL') {
      const price = Number(manualPrice);
      if (!Number.isFinite(price) || price <= 0) {
        toast.error('กรุณาระบุราคา');
        return;
      }
      if (manualReason.trim().length < 3) {
        toast.error('ระบุเหตุผลอย่างน้อย 3 ตัวอักษร');
        return;
      }
      appraise.mutate({ mode, offeredPrice: price, reason: manualReason, ...eligibility });
    }
  }

  const quoted = item?.quoteBreakdown ? Number(item.quoteBreakdown.price) : null;

  if (mode === 'REVISED') {
    return (
      <AppraisalModal item={item} onClose={handleClose} onBack={() => setMode('AS_ANSWERED')} />
    );
  }

  return (
    <Modal isOpen={!!item} onClose={handleClose} title="ยืนยันราคาใบเสนอออนไลน์" size="lg">
      {item && (
        <div className="space-y-4 text-sm leading-snug">
          <div className="rounded-lg bg-muted p-3 space-y-1">
            <div className="font-semibold">
              {item.deviceBrand} {item.deviceModel} {item.deviceStorage ?? ''}
              <span
                className={`ml-2 text-xs font-medium ${item.flow === 'EXCHANGE' ? 'text-warning' : 'text-muted-foreground'}`}
              >
                {item.flow === 'EXCHANGE' ? 'เทิร์นแลกเครื่องใหม่ (เครดิต)' : 'รับซื้อเงินสด'}
              </span>
            </div>
            {quoted !== null && (
              <div className="text-lg font-bold">
                ราคาที่เสนอออนไลน์: ฿{quoted.toLocaleString()}
              </div>
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
              disabled={appraise.isPending}
              onClick={() => {
                setMode('AS_ANSWERED');
                setCashFallback(false);
              }}
            >
              สภาพตรงตามที่ตอบ
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={appraise.isPending}
              onClick={() => {
                setMode('REVISED');
                setCashFallback(false);
              }}
            >
              สภาพไม่ตรง — แก้คำตอบ
            </Button>
            {isOwner && (
              <Button
                variant={mode === 'MANUAL' ? 'primary' : 'outline'}
                size="sm"
                disabled={appraise.isPending}
                onClick={() => {
                  setMode('MANUAL');
                  setCashFallback(false);
                }}
              >
                กำหนดราคาเอง (OWNER)
              </Button>
            )}
            {item.flow === 'EXCHANGE' && (
              <Button
                variant={cashFallback ? 'primary' : 'outline'}
                size="sm"
                disabled={appraise.isPending}
                onClick={() => {
                  setMode('AS_ANSWERED');
                  setCashFallback(true);
                }}
              >
                ลูกค้าไม่ซื้อเครื่อง — ใช้ราคาเงินสด
              </Button>
            )}
          </div>

          {mode === 'AS_ANSWERED' && (
            <p className="text-muted-foreground">
              ยืนยัน{item.flow === 'EXCHANGE' ? 'มูลค่าเทิร์น (เครดิตซื้อเครื่องใหม่)' : 'รับซื้อ'}
              ที่ ฿{Number(item.estimatedValue ?? quoted ?? 0).toLocaleString()} ตามใบเสนอ
            </p>
          )}

          {cashFallback && item.quoteBreakdown?.cashPrice && (
            <p className="text-muted-foreground">
              ถอยเป็นขายเงินสด ฿{Number(item.quoteBreakdown.cashPrice).toLocaleString()} —
              ระบบจะเปลี่ยนรายการเป็น "รับซื้อ"
            </p>
          )}

          {mode === 'MANUAL' && (
            <div className="space-y-3">
              <div>
                <Label>ราคาที่เสนอ (บาท) *</Label>
                <Input
                  className="mt-1"
                  type="number"
                  value={manualPrice}
                  onChange={(e) => setManualPrice(e.target.value)}
                />
              </div>
              <div>
                <Label>เหตุผล * (บันทึก audit)</Label>
                <Input
                  className="mt-1"
                  value={manualReason}
                  onChange={(e) => setManualReason(e.target.value)}
                />
              </div>
            </div>
          )}

          {eligibilityRequired && (
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-primary"
                aria-label="ยืนยันเครื่องผ่านเงื่อนไขรับซื้อ"
                checked={deviceEligibilityConfirmed}
                disabled={appraise.isPending}
                onChange={(event) => setEligibleItemId(event.target.checked ? item.id : null)}
              />
              <span>{item.quoteBreakdown?.eligibilityText}</span>
            </label>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={handleClose} disabled={appraise.isPending}>
              ยกเลิก
            </Button>
            <Button
              onClick={confirm}
              disabled={appraise.isPending || (eligibilityRequired && !deviceEligibilityConfirmed)}
            >
              {appraise.isPending ? 'กำลังบันทึก...' : 'ยืนยันราคา'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
