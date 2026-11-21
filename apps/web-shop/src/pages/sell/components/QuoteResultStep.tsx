import type { BuybackQuoteResult } from '@/types/buyback';
import { Button } from '@/components';
import { copy } from '@/lib/copy';
import ChoiceButton from './ChoiceButton';
export default function QuoteResultStep({
  quote,
  flow,
  onFlowChange,
  onContinue,
  onReview,
}: {
  quote: BuybackQuoteResult;
  flow: 'BUYBACK' | 'EXCHANGE';
  onFlowChange: (flow: 'BUYBACK' | 'EXCHANGE') => void;
  onContinue: () => void;
  onReview: () => void;
}) {
  const exchange = flow === 'EXCHANGE';
  const amount = exchange ? quote.exchangePrice : (quote.cashPrice ?? quote.price);
  const bonus = Math.max(0, Number(quote.exchangePrice ?? 0) - Number(quote.cashPrice ?? quote.price ?? 0));
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="เลือกวิธีขาย">
        <ChoiceButton selected={!exchange} onClick={() => onFlowChange('BUYBACK')}>
          ขายสด
        </ChoiceButton>
        <ChoiceButton selected={exchange} onClick={() => onFlowChange('EXCHANGE')}>
          เทิร์นซื้อเครื่อง
        </ChoiceButton>
      </div>
      <section className={`rounded-2xl p-5 min-[700px]:p-6 ${exchange ? 'bg-ink text-ink-foreground' : 'bg-secondary text-secondary-foreground'}`} aria-label="ราคาประเมิน">
        {exchange && bonus > 0 && (
          <p className="mb-3 inline-block rounded-lg bg-promo px-2 py-1 text-sm font-semibold text-promo-foreground">
            โบนัสเทิร์น +{bonus.toLocaleString('th-TH', { maximumFractionDigits: 2 })} บาท
          </p>
        )}
        <p>{exchange ? 'มูลค่าเครดิตเทิร์นโดยประมาณ' : 'ราคาขายสดโดยประมาณ'}</p>
        <p className="my-4 break-words text-[36px] font-bold leading-snug">
          {Number(amount).toLocaleString('th-TH', { maximumFractionDigits: 2 })} บาท
        </p>
        <p className="text-sm">
          {exchange ? copy.sell.exchangeCreditNote : 'รับเงินที่ร้านหลังตรวจเครื่อง'}
        </p>
      </section>
      <p className="text-sm">ราคายืนยันจริงตอนตรวจเครื่องที่ร้าน คุณปฏิเสธได้ ไม่มีค่าใช้จ่าย</p>
      <Button variant="ghost" fullWidth onClick={onReview}>
        ตรวจหรือแก้คำตอบ
      </Button>
      <Button fullWidth size="lg" onClick={onContinue}>
        {exchange ? 'ใช้เครดิตเทิร์น · กรอกข้อมูล' : 'เลือกขายสด · กรอกข้อมูล'}
      </Button>
    </div>
  );
}
