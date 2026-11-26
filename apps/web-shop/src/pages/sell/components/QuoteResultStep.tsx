import type { BuybackQuoteResult } from '@/types/buyback';
import { Button } from '@/components';
import { Clock3, ShieldCheck } from '@/lib/icons';
import { quoteDate } from '../quote-window';
import { modelLabel, storageLabel } from '../device-options';
import ChoiceButton from './ChoiceButton';
import { formatNumber } from '@/lib/format';
import './quote-summary.css';

export default function QuoteResultStep({
  quote,
  model,
  storage,
  conditions,
  expired,
  flow,
  onFlowChange,
  onContinue,
  onReview,
  onReassess,
  onChangeDevice,
}: {
  quote: BuybackQuoteResult;
  model: string;
  storage: string;
  conditions: Array<{ title: string; answer: string }>;
  expired: boolean;
  flow: 'BUYBACK' | 'EXCHANGE';
  onFlowChange: (flow: 'BUYBACK' | 'EXCHANGE') => void;
  onContinue: () => void;
  onReview: () => void;
  onReassess: () => void;
  onChangeDevice: () => void;
}) {
  const exchange = flow === 'EXCHANGE';
  const amount = exchange ? quote.exchangePrice : (quote.cashPrice ?? quote.price);
  const money = (value: string | number | undefined) =>
    formatNumber(Number(value), { maximumFractionDigits: 2 });
  const bonus = Math.max(
    0,
    Number(quote.exchangePrice ?? 0) - Number(quote.cashPrice ?? quote.price ?? 0),
  );
  return (
    <div className="sell-summary space-y-5">
      <aside className="summary-intake" aria-label="เงื่อนไขรับซื้อและเทิร์น">
        <ShieldCheck size={24} aria-hidden="true" className="shrink-0" />
        <div>
          <p className="text-xs font-semibold">เงื่อนไขรับซื้อ / เทิร์น</p>
          <h2 className="mt-1 text-lg font-bold text-foreground">
            ต้องตรวจเครื่องจริงก่อนยืนยันราคา
          </h2>
          <p className="mt-2 text-base text-foreground">
            เครื่องต้อง <strong>ล้างข้อมูลได้</strong> และเจ้าของเครื่องต้อง{' '}
            <strong>ออกจาก iCloud ได้</strong>
          </p>
          <p className="mt-2 text-sm">
            หากล้างเครื่องหรือออกจาก iCloud ไม่ได้ ร้านยังรับซื้อหรือเทิร์นไม่ได้
          </p>
        </div>
      </aside>
      <div
        className="grid grid-cols-2 gap-2 min-[900px]:max-w-[400px]"
        role="group"
        aria-label="เลือกวิธีขาย"
      >
        <ChoiceButton selected={!exchange} onClick={() => onFlowChange('BUYBACK')}>
          ขายสด
        </ChoiceButton>
        <ChoiceButton selected={exchange} onClick={() => onFlowChange('EXCHANGE')}>
          เทิร์นซื้อเครื่อง
        </ChoiceButton>
      </div>
      <article className="summary-card" aria-label="ราคาประเมิน">
        <div className="summary-device">
          <div>
            <p className="text-xs text-muted-foreground">เครื่องที่คุณประเมิน</p>
            <h2 className="mt-1 text-xl font-bold">
              {modelLabel(model)}{' '}
              <span className="inline-block text-base font-medium text-muted-foreground">
                {storageLabel(storage)}
              </span>
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <p
              role="status"
              className={`summary-status ${expired ? 'bg-promo text-promo-foreground' : 'bg-secondary text-secondary-foreground'}`}
            >
              {expired ? 'พ้นช่วงอ้างอิงแล้ว' : 'ราคาประเมินเบื้องต้น'}
            </p>
            <Button variant="ghost" onClick={onChangeDevice}>
              เปลี่ยนเครื่อง
            </Button>
          </div>
        </div>
        <div className="summary-columns">
          <section className="summary-price" aria-label="มูลค่าประเมิน">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-semibold">
                {exchange ? 'มูลค่าเครดิตเทิร์นโดยประมาณ' : 'ราคาขายสดโดยประมาณ'}
              </h3>
              {exchange && bonus > 0 && (
                <p className="rounded-lg bg-promo px-2 py-1 text-xs font-semibold text-promo-foreground">
                  โบนัสเทิร์น +{money(bonus)} บาท
                </p>
              )}
            </div>
            <p
              className={`my-3 break-words text-[40px] font-bold tabular-nums leading-snug min-[900px]:text-[52px] ${expired ? 'text-muted-foreground' : 'text-secondary-foreground'}`}
            >
              {money(amount)} บาท
            </p>
            <p className="text-sm">
              {exchange
                ? 'เครดิตเทิร์นใช้เป็นส่วนลดซื้อเครื่องในร้าน ไม่จ่ายเป็นเงินสด'
                : 'รับเงินที่ร้านหลังตรวจเครื่องและตกลงราคา'}
            </p>
            <div className="mt-5 border-l-[3px] border-primary pl-3">
              <p className="font-bold">ยังไม่ใช่ราคายืนยันรับซื้อ</p>
              <p className="mt-1 text-sm">
                คำนวณจากข้อมูลที่คุณเลือก ร้านจะตรวจเครื่องจริงก่อนเสนอราคาสุดท้าย
              </p>
            </div>
            {exchange && bonus > 0 && (
              <p className="mt-4 text-xs text-muted-foreground">
                ราคาขายสด {money(quote.cashPrice ?? quote.price)} บาท + โบนัสเทิร์น {money(bonus)}{' '}
                บาท
              </p>
            )}
          </section>
          <section className="summary-time" aria-label="วันและเวลาประเมิน">
            <h3 className="mb-4 flex items-center gap-2 text-base font-semibold text-secondary-foreground">
              <Clock3 size={20} aria-hidden="true" />
              วันและเวลาประเมิน
            </h3>
            <dl className="space-y-3">
              <div>
                <dt className="text-sm text-muted-foreground">ประเมินเมื่อ</dt>
                <dd className="mt-1 font-semibold">
                  <time dateTime={quote.assessedAt}>{quoteDate(quote.assessedAt)}</time>
                </dd>
              </div>
              <div className="border-t border-border pt-3">
                <dt className="text-sm text-secondary-foreground">
                  {expired ? 'สิ้นสุดช่วงอ้างอิงเมื่อ' : 'อ้างอิงได้ถึง'}
                </dt>
                <dd className="mt-1 font-semibold text-secondary-foreground">
                  <time dateTime={quote.expiresAt}>{quoteDate(quote.expiresAt)}</time>
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">เวลาไทย (UTC+7)</p>
            <div
              className={`mt-4 rounded-xl p-3 text-sm ${expired ? 'bg-promo text-promo-foreground' : 'bg-sell-footer text-foreground'}`}
            >
              <p className="font-semibold">
                {expired ? 'กรุณาประเมินใหม่ก่อนนัดหมาย' : 'ช่วงอ้างอิง 24 ชั่วโมง'}
              </p>
              <p className="mt-1">
                {expired
                  ? 'ราคาที่แสดงเป็นผลประเมินเดิม ไม่ใช่ราคาปัจจุบัน'
                  : 'เมื่อพ้นเวลานี้ กรุณาประเมินใหม่ ช่วงอ้างอิงนี้ไม่ใช่การล็อคราคา'}
              </p>
            </div>
          </section>
        </div>
        <section className="summary-conditions" aria-label="สภาพตามคำตอบ">
          <h3 className="font-semibold">สภาพที่คุณแจ้ง</h3>
          <p className="mt-1 text-xs text-muted-foreground">ใช้ประกอบการประเมินนี้</p>
          <dl className="mt-4 grid gap-x-8 gap-y-3 min-[900px]:grid-cols-2">
            {conditions.map((item) => (
              <div
                key={item.title}
                className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm"
              >
                <dt className="text-muted-foreground">{item.title}</dt>
                <dd className="font-medium">{item.answer}</dd>
              </div>
            ))}
          </dl>
        </section>
      </article>
      <div className="flex flex-col-reverse gap-3 min-[900px]:grid min-[900px]:grid-cols-2">
        <Button variant="outline" fullWidth onClick={onReview}>
          ตรวจหรือแก้คำตอบ
        </Button>
        <Button fullWidth size="lg" onClick={expired ? onReassess : onContinue}>
          {expired ? 'ประเมินราคาใหม่' : 'นัดตรวจเครื่องที่ร้าน'}
        </Button>
      </div>
      <p className="text-center text-xs text-muted-foreground min-[900px]:text-right">
        {expired
          ? 'ตรวจข้อมูลและราคาปัจจุบันอีกครั้งก่อนนำเครื่องเข้าร้าน'
          : 'การนัดหมายยังไม่ถือเป็นการตกลงขายหรือยืนยันราคา'}
      </p>
    </div>
  );
}
