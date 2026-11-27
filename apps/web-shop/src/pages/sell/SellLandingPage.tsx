import { Fragment, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { ArrowRight, Check } from '@/lib/icons';
import { copy } from '@/lib/copy';
import ShopLayout from '@/components/layout/ShopLayout';
import { Button, Container } from '@/components';
import { usePageMeta } from '@/hooks/usePageMeta';

const t = copy.sellLanding;

/**
 * ขึ้นบรรทัดใหม่ได้เฉพาะตรงช่องว่างของข้อความ — เบราว์เซอร์ตัดคำไทยกลางวลีเอง ("ค่าใช้ / จ่าย")
 * แต่ละช่วงเป็น inline-block: อยู่บรรทัดเดียวกันถ้าพอ ถ้าช่วงนั้นยาวกว่าบรรทัดจริง ๆ (จอแคบมาก) ก็ยังตัดข้างในได้ ไม่ล้นจอ
 */
function Phrases({ text }: { text: string }) {
  return (
    <>
      {text.split(' ').map((part, i) => (
        <Fragment key={`${i}-${part}`}>
          {i > 0 && ' '}
          <span className="inline-block">{part}</span>
        </Fragment>
      ))}
    </>
  );
}

function Step({ no, title, children }: { no: number; title: string; children?: ReactNode }) {
  return (
    <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 lg:grid-cols-[2.25rem_minmax(0,1fr)] lg:gap-x-3.5">
      <span
        aria-hidden="true"
        className="grid size-8 place-items-center rounded-full border border-emerald-100 bg-mint-tint font-bold text-brand-green-dark lg:size-9"
      >
        {no}
      </span>
      <div className="pt-0.5 lg:pt-1">
        <h3 className="text-[17px] font-bold text-ink">{title}</h3>
        {children}
      </div>
    </li>
  );
}

/**
 * หน้าแรก /sell — แบบ ข (เจ้าของเลือก 2026-11-27): หัวข้อ + ปุ่มเดียว + การ์ด 3 ขั้นตอน ไม่มีรูป
 * - หน้านี้เป็นหน้าสำเร็จรูปที่ไม่พึ่ง API (scripts/prerender.mjs) — ห้ามดึงข้อมูล ห้ามใส่ตัวเลขราคา
 * - ทั้งหน้ามีลิงก์เดียวคือปุ่ม "เริ่มเช็กราคา" (เทสต์ทั้งระบบกดลิงก์ชื่อนี้แบบตรงตัว)
 * - จอใหญ่: แผ่นพื้นเขียวอ่อนใบเดียว ซ้ายหัวข้อ ขวาการ์ดขั้นตอน · จอเล็ก: แผ่นหัวข้อ แล้วการ์ดขั้นตอนต่อท้าย
 * - พื้นเขียวอ่อนไล่ขาวชุดเดียวกับแบนเนอร์หน้ารายการสินค้าและพื้นของ /sell/quote
 * - การ์ดขั้นตอนยืมหน้าตาการ์ดของ /sell/quote (ขาว ขอบบนเขียว หัวเขียวอ่อน) ให้กดปุ่มแล้วไม่สะดุดตา
 */
export default function SellLandingPage() {
  const location = useLocation();
  usePageMeta(copy.sell.pageTitle, copy.sell.description);
  return (
    <ShopLayout>
      <Container className="py-4 leading-snug md:py-8 lg:py-11">
        <div className="flex flex-col gap-4 max-lg:mx-auto max-lg:max-w-xl lg:grid lg:grid-cols-[minmax(0,1fr)_520px] lg:items-center lg:gap-x-[72px] lg:rounded-[40px] lg:border lg:border-border lg:bg-linear-to-br lg:from-mint-tint lg:to-white lg:p-12 lg:pl-16">
          <div className="flex flex-col items-start rounded-3xl p-5 max-lg:border max-lg:border-border max-lg:bg-linear-to-br max-lg:from-mint-tint max-lg:to-white lg:rounded-none lg:p-0">
            <p className="text-sm font-semibold text-brand-green-dark lg:text-[15px]">
              {t.eyebrow}
            </p>
            <h1 className="mt-1 text-3xl font-bold leading-snug text-ink lg:mt-2 lg:text-[52px]">
              <Phrases text={t.title} />
            </h1>
            <p className="mt-1 text-[17px] lg:mt-2 lg:text-xl">{t.lead}</p>
            <Button
              asChild
              size="lg"
              className="mt-4 h-13 w-full rounded-[14px] text-[17px] font-bold lg:mt-7 lg:h-14 lg:w-auto lg:min-w-75 lg:px-9 lg:text-lg"
            >
              <Link to={{ pathname: '/sell/quote', search: location.search }}>
                {t.cta}
                <ArrowRight size={20} aria-hidden="true" />
              </Link>
            </Button>
            <ul className="mt-3.5 flex flex-wrap gap-x-4 gap-y-1 text-[15px] text-muted-foreground lg:mt-4 lg:gap-x-5">
              {t.notes.map((note) => (
                <li key={note} className="inline-flex items-center gap-1.5">
                  <Check size={16} aria-hidden="true" className="shrink-0 text-brand-green" />
                  {note}
                </li>
              ))}
            </ul>
          </div>

          <section
            aria-labelledby="sell-steps-title"
            className="overflow-hidden rounded-3xl border border-border border-t-[3px] border-t-brand-green-dark bg-card lg:shadow-lg"
          >
            <div className="bg-mint-tint px-4.5 py-2.5 lg:px-6 lg:py-3">
              <h2 id="sell-steps-title" className="font-bold text-brand-green-dark">
                {t.stepsTitle}
              </h2>
            </div>
            <ol
              aria-labelledby="sell-steps-title"
              className="flex flex-col gap-4 px-4.5 pt-4.5 pb-5 lg:gap-4.5 lg:px-6 lg:pt-5.5 lg:pb-6 lg:text-[15px]"
            >
              <Step no={1} title={t.step1Title} />
              <Step no={2} title={t.step2Title}>
                <p className="mt-0.5">
                  <Phrases text={copy.sell.priceCondition} />
                </p>
                <div className="mt-2.5 rounded-xl bg-sell-footer px-3 py-2.5 text-[15px] text-muted-foreground lg:text-sm">
                  <p>
                    <Phrases text={copy.contact.address} />
                  </p>
                  <p className="mt-1 font-semibold text-foreground">{copy.contact.hours}</p>
                </div>
              </Step>
              <Step no={3} title={t.step3Title}>
                <p className="mt-0.5">{t.cashNote}</p>
                <p className="mt-1">
                  <Phrases text={copy.sell.exchangeCreditNote} />
                </p>
              </Step>
            </ol>
          </section>
        </div>
      </Container>
    </ShopLayout>
  );
}
