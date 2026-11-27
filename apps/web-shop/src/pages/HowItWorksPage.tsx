import { Link } from 'react-router';
import {
  MessageCircle,
  CreditCard,
  PartyPopper,
  ShieldCheck,
  Check,
  type AppIcon,
} from '@/lib/icons';
import {
  CategoryHero,
  Container,
  Stack,
  Section,
  SectionHeader,
  Card,
  CardBody,
  TrustStrip,
  StaggerChildren,
} from '@/components';
import ShopLayout from '@/components/layout/ShopLayout';
import { FaqAccordion } from '@/components/shop/FaqAccordion';
import { copy } from '@/lib/copy';
import { usePageMeta } from '@/hooks/usePageMeta';

interface Step {
  number: number;
  title: string;
  description: string;
  Icon: AppIcon;
}

interface FaqItem {
  question: string;
  answer: string;
}

const STEPS: Step[] = [
  {
    number: 1,
    title: copy.howItWorks.step1Title,
    description: copy.howItWorks.step1Description,
    Icon: MessageCircle,
  },
  {
    number: 2,
    title: copy.howItWorks.step2Title,
    description: copy.howItWorks.step2Description,
    Icon: CreditCard,
  },
  {
    number: 3,
    title: copy.howItWorks.step3Title,
    description: copy.howItWorks.step3Description,
    Icon: PartyPopper,
  },
];

/** สิ่งที่ลูกค้าเห็นบนการ์ดและหน้าเครื่องจริง — ไม่ระบุเกณฑ์อนุมัติ/จำนวนงวดสูงสุด (รอเจ้าของร้าน) */
const RATE_POINTS = [
  'ทั้งสองเรทมีเงินดาวน์ จำนวนงวด และค่างวดไม่เท่ากัน บางเครื่องมีแบบไม่ต้องวางดาวน์ (ฟรีดาวน์)',
  'หน้าเครื่องแต่ละเครื่องคิดค่างวดของทั้งสองเรทให้เทียบกัน พร้อมป้ายบอกว่าเรทไหนดาวน์น้อยกว่า ค่างวดต่ำกว่า หรือผ่อนจบเร็วกว่า',
  'เรทที่ได้ขึ้นกับการประเมินของเจ้าหน้าที่ ทักแชทบอกงบกับอาชีพ ทีมงานประเมินแล้วแจ้งเรทที่ได้ให้',
];

const FAQS: FaqItem[] = [
  { question: copy.howItWorks.faq1Q, answer: copy.howItWorks.faq1A },
  { question: copy.howItWorks.faq2Q, answer: copy.howItWorks.faq2A },
  { question: copy.howItWorks.faq3Q, answer: copy.howItWorks.faq3A },
  { question: copy.howItWorks.faq4Q, answer: copy.howItWorks.faq4A },
  { question: copy.howItWorks.faq5Q, answer: copy.howItWorks.faq5A },
];

// FAQPage structured data — เนื้อหาต้องตรงกับ FAQ ที่มองเห็นบนหน้าเสมอ (สร้างจาก FAQS ก้อนเดียวกัน)
const FAQ_JSON_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQS.map((f) => ({
    '@type': 'Question',
    name: f.question,
    acceptedAnswer: { '@type': 'Answer', text: f.answer },
  })),
});

export default function HowItWorksPage() {
  usePageMeta(
    copy.howItWorks.pageTitle,
    'วิธีผ่อน iPhone มือ 1 และมือสองบัตรประชาชนใบเดียว 3 ขั้นตอนง่ายๆ ไม่เช็กบูโร ไม่ต้องใช้บัตรเครดิต ร้านมือถือลพบุรี',
  );

  return (
    <ShopLayout>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: FAQ_JSON_LD }} />
      <CategoryHero
        title={copy.howItWorks.pageTitle}
        description={copy.howItWorks.intro}
        breadcrumbs={[{ label: 'หน้าแรก', to: '/' }, { label: copy.howItWorks.pageTitle }]}
      />
      <Container>
        <Stack gap={6} className="py-8">
          <section>
            <SectionHeader title={copy.howItWorks.stepsTitle} />
            <StaggerChildren
              role="list"
              className="grid grid-cols-1 md:grid-cols-3 gap-4"
              stagger={120}
            >
              {STEPS.map((step) => (
                <Card key={step.number} role="listitem" variant="outlined" className="h-full">
                  <CardBody>
                    <Stack gap={3} className="leading-snug">
                      <div className="flex items-center gap-3">
                        <span className="inline-flex size-9 items-center justify-center rounded-full bg-mint-tint text-brand-green-dark text-sm font-semibold">
                          {step.number}
                        </span>
                        <step.Icon className="size-5 text-brand-green" aria-hidden="true" />
                      </div>
                      <h3 className="text-lg font-semibold leading-snug">{step.title}</h3>
                      <p className="text-sm text-muted-foreground leading-snug">
                        {step.description}
                      </p>
                    </Stack>
                  </CardBody>
                </Card>
              ))}
            </StaggerChildren>
          </section>

          {/* ปลายทางของลิงก์ "เรทต่างกันอย่างไร" บนการ์ดหน้ารวม (ส่วน B2) — scroll-mt กันหัวเว็บที่ติดด้านบนบัง.
              ไม่บอกเกณฑ์ว่าใครได้เรทไหน — เจ้าหน้าที่ประเมิน (เจ้าของ 2026-11-27) */}
          <section id="rates" className="scroll-mt-24 rounded-2xl bg-mint-tint p-5 md:p-6">
            <SectionHeader
              title="เรท 1 กับ เรท 2 ต่างกันอย่างไร"
              description="แต่ละเครื่องมีแผนผ่อนให้เลือกได้สองแบบ เลือกแบบที่ผ่อนสบายกว่า"
              className="mb-4 md:mb-5"
            />
            <ul className="space-y-2.5 text-sm leading-snug">
              {RATE_POINTS.map((point) => (
                <li key={point} className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-brand-green" aria-hidden="true" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <SectionHeader title={copy.howItWorks.faqTitle} />
            <FaqAccordion items={FAQS} />
            <div className="mt-4 text-center">
              <Link
                to="/installment-terms"
                className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline leading-snug"
              >
                <ShieldCheck className="size-4" aria-hidden="true" />
                อ่านเงื่อนไขการผ่อนแบบละเอียด — ดอกเบี้ย กรรมสิทธิ์ และระบบล็อคเครื่อง
              </Link>
            </div>
          </section>
        </Stack>
      </Container>

      <Section padding="md">
        <Container>
          <TrustStrip />
        </Container>
      </Section>
    </ShopLayout>
  );
}
