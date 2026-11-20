import type { BuybackQuoteResult } from '@/types/buyback';
import { buybackSourceName } from '@installment/shared';
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
  const source = buybackSourceName(quote.source ?? quote.breakdown?.source);
  const capturedAt = quote.capturedAt ?? quote.breakdown?.capturedAt;
  const date = capturedAt ? new Date(capturedAt) : null;
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
      <section className="rounded-2xl border border-border p-5" aria-label="ราคาประเมิน">
        {exchange && Number(quote.bonusPct) > 0 && (
          <p className="mb-3 inline-block rounded-lg bg-promo px-2 py-1 text-sm font-semibold text-promo-foreground">
            โบนัสเทิร์น {Number(quote.bonusPct)}%
          </p>
        )}
        <p>{exchange ? 'มูลค่าเครดิตเทิร์นโดยประมาณ' : 'ราคาขายสดโดยประมาณ'}</p>
        <p className="my-4 break-words text-[36px] font-bold leading-snug text-primary">
          {Number(amount).toLocaleString('th-TH', { maximumFractionDigits: 2 })} บาท
        </p>
        <p className="text-sm">
          {exchange ? copy.sell.exchangeCreditNote : 'รับเงินที่ร้านหลังตรวจเครื่อง'}
        </p>
      </section>
      <p className="text-sm">ราคายืนยันจริงตอนตรวจเครื่องที่ร้าน คุณปฏิเสธได้ ไม่มีค่าใช้จ่าย</p>
      <details className="border-t border-border">
        <summary className="min-h-11 cursor-pointer py-3 text-secondary-foreground">
          ดูที่มาของราคา
        </summary>
        {source && (
          <p className="mb-3 text-sm">
            {(quote.pricingMode ?? quote.breakdown?.pricingMode) === 'SUM_PERCENT_FLOOR10'
              ? 'ราคากลางอ้างอิง'
              : 'เงื่อนไขอ้างอิง'}{' '}
            {source}
            {(quote.pricingMode ?? quote.breakdown?.pricingMode) === 'SUM_PERCENT_FLOOR10' &&
              ' · หักสภาพตามเกณฑ์ร้าน'}
            {date &&
              !Number.isNaN(date.getTime()) &&
              ` · ${date.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' })}`}
          </p>
        )}
        <p className="text-sm">
          ราคาสูงสุด {Number(quote.breakdown?.maxPrice).toLocaleString('th-TH')} บาท
        </p>
        {quote.breakdown?.lines
          .filter((line) => line.applied !== false && Number(line.amount) > 0)
          .map((line, index) => (
            <p key={index} className="mt-2 text-sm">
              {line.label} {line.deductType === 'PERCENT' ? `(${line.deductValue}%)` : ''} −
              {Number(line.amount).toLocaleString('th-TH')} บาท
            </p>
          ))}
      </details>
      <Button variant="ghost" fullWidth onClick={onReview}>
        ตรวจหรือแก้คำตอบ
      </Button>
      <Button fullWidth size="lg" onClick={onContinue}>
        {exchange ? 'ใช้เครดิตเทิร์น · กรอกข้อมูล' : 'เลือกขายสด · กรอกข้อมูล'}
      </Button>
    </div>
  );
}
