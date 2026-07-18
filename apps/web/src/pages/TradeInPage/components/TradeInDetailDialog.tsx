import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import Modal from '@/components/ui/Modal';
import type { TradeIn } from '../types';

interface Props {
  id: string | null;
  onClose: () => void;
}

/** รายละเอียด TradeIn — โชว์คำตอบประเมินออนไลน์ + breakdown + รูป/แบต/โน้ตของ record online เก่า */
export default function TradeInDetailDialog({ id, onClose }: Props) {
  const { data, isLoading } = useQuery<TradeIn>({
    queryKey: ['trade-in-detail', id],
    queryFn: () => api.get(`/trade-ins/${id}`).then((r) => r.data),
    enabled: !!id,
  });

  return (
    <Modal isOpen={!!id} onClose={onClose} title="รายละเอียดรายการรับซื้อ" size="lg">
      {isLoading && <p className="text-sm text-muted-foreground">กำลังโหลด...</p>}
      {data && (
        <div className="space-y-4 text-sm leading-snug">
          <div>
            <div className="font-semibold">
              {data.deviceBrand} {data.deviceModel} {data.deviceStorage ?? ''}
            </div>
            <div className="text-muted-foreground">
              {data.deviceCondition && <>เกรด {data.deviceCondition}</>}
              {data.batteryHealth != null && <> · แบตเตอรี่ {data.batteryHealth}%</>}
              {data.imei && <> · IMEI {data.imei}</>}
            </div>
            <div className="text-muted-foreground">
              ผู้ขาย: {data.sellerName ?? data.customer?.name ?? '-'} {data.sellerPhone ? `(${data.sellerPhone})` : ''}
            </div>
            {data.preferredVisitDate && (
              <div className="text-muted-foreground">
                วันที่สะดวกเข้าร้าน: {new Date(data.preferredVisitDate).toLocaleDateString('th-TH')}
              </div>
            )}
          </div>

          {data.quoteBreakdown && (
            <div className="rounded-lg border border-border p-3 space-y-1">
              <div className="font-medium">ใบเสนอราคาออนไลน์</div>
              {data.quoteBreakdown.chosenFlow && (
                <div className="text-xs text-muted-foreground">
                  ประเภท: {data.quoteBreakdown.chosenFlow === 'EXCHANGE' ? 'เทิร์นแลกเครื่องใหม่ (เครดิต)' : 'รับซื้อเงินสด'}
                </div>
              )}
              <div className="flex justify-between text-muted-foreground">
                <span>ราคาสูงสุด</span><span>฿{Number(data.quoteBreakdown.maxPrice).toLocaleString()}</span>
              </div>
              {data.quoteBreakdown.lines.filter((l) => Number(l.amount) > 0).map((l, i) => (
                <div key={i} className="flex justify-between text-muted-foreground">
                  <span>{l.label}</span><span>−฿{Number(l.amount).toLocaleString()}</span>
                </div>
              ))}
              {data.quoteBreakdown.chosenFlow === 'EXCHANGE' &&
                data.quoteBreakdown.cashPrice &&
                data.quoteBreakdown.exchangePrice && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>โบนัสเทิร์น +{Number(data.quoteBreakdown.bonusPct ?? 0)}%</span>
                    <span>
                      +฿{(
                        Number(data.quoteBreakdown.exchangePrice) -
                        Number(data.quoteBreakdown.cashPrice)
                      ).toLocaleString()}
                    </span>
                  </div>
                )}
              <div className="flex justify-between font-semibold border-t border-border pt-1">
                <span>ราคาที่เสนอ</span><span>฿{Number(data.quoteBreakdown.price).toLocaleString()}</span>
              </div>
            </div>
          )}

          {data.conditionAnswers && data.conditionAnswers.length > 0 && (
            <div className="rounded-lg border border-border p-3 space-y-1.5">
              <div className="font-medium">คำตอบประเมินออนไลน์ของลูกค้า</div>
              {data.conditionAnswers.map((a) => (
                <div key={a.questionKey} className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{a.title}</span>
                  <span className="text-right">
                    {a.choices.length === 0 ? 'ไม่มีปัญหา' : a.choices.map((c) => c.label).join(', ')}
                  </span>
                </div>
              ))}
            </div>
          )}

          {data.customerNotes && (
            <div className="text-muted-foreground">หมายเหตุลูกค้า: {data.customerNotes}</div>
          )}

          {(data.photoUrls?.length ?? 0) > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {data.photoUrls!.map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noreferrer" className="block aspect-square rounded-lg overflow-hidden bg-muted">
                  <img src={url} alt={`รูปที่ ${i + 1}`} className="h-full w-full object-cover" />
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
