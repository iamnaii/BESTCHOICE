import {
  Smartphone,
  Clock,
  FileText,
  MapPin,
  Wallet,
  PartyPopper,
  type LucideIcon,
} from 'lucide-react';
import {
  CategoryHero,
  Container,
  Stack,
  Section,
  SectionHeader,
  Card,
  CardBody,
  TrustStrip,
} from '@/components';
import ShopLayout from '@/components/layout/ShopLayout';
import { copy } from '@/lib/copy';

interface Step {
  number: number;
  title: string;
  description: string;
  Icon: LucideIcon;
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
    Icon: Smartphone,
  },
  {
    number: 2,
    title: copy.howItWorks.step2Title,
    description: copy.howItWorks.step2Description,
    Icon: Clock,
  },
  {
    number: 3,
    title: copy.howItWorks.step3Title,
    description: copy.howItWorks.step3Description,
    Icon: FileText,
  },
  {
    number: 4,
    title: copy.howItWorks.step4Title,
    description: copy.howItWorks.step4Description,
    Icon: MapPin,
  },
  {
    number: 5,
    title: copy.howItWorks.step5Title,
    description: copy.howItWorks.step5Description,
    Icon: Wallet,
  },
  {
    number: 6,
    title: copy.howItWorks.step6Title,
    description: copy.howItWorks.step6Description,
    Icon: PartyPopper,
  },
];

const FAQS: FaqItem[] = [
  { question: copy.howItWorks.faq1Q, answer: copy.howItWorks.faq1A },
  { question: copy.howItWorks.faq2Q, answer: copy.howItWorks.faq2A },
  { question: copy.howItWorks.faq3Q, answer: copy.howItWorks.faq3A },
  { question: copy.howItWorks.faq4Q, answer: copy.howItWorks.faq4A },
  { question: copy.howItWorks.faq5Q, answer: copy.howItWorks.faq5A },
];

export default function HowItWorksPage() {
  return (
    <ShopLayout>
      <CategoryHero
        title={copy.howItWorks.pageTitle}
        description={copy.howItWorks.intro}
        breadcrumbs={[
          { label: 'หน้าแรก', to: '/' },
          { label: copy.howItWorks.pageTitle },
        ]}
      />
      <Container>
        <Stack gap={6} className="py-8">
          <section>
            <SectionHeader title={copy.howItWorks.stepsTitle} />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {STEPS.map((step) => (
                <Card key={step.number} variant="outlined">
                  <CardBody>
                    <Stack gap={3} className="leading-snug">
                      <div className="flex items-center gap-3">
                        <span className="inline-flex size-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 text-sm font-semibold">
                          {step.number}
                        </span>
                        <step.Icon className="size-5 text-emerald-600" aria-hidden="true" />
                      </div>
                      <h3 className="text-lg font-semibold leading-snug">{step.title}</h3>
                      <p className="text-sm text-muted-foreground leading-snug">
                        {step.description}
                      </p>
                    </Stack>
                  </CardBody>
                </Card>
              ))}
            </div>
          </section>

          <section>
            <SectionHeader title={copy.howItWorks.faqTitle} />
            <Stack gap={3}>
              {FAQS.map((faq, i) => (
                <Card key={i} variant="outlined">
                  <CardBody>
                    <Stack gap={2} className="leading-snug">
                      <h3 className="text-base font-semibold leading-snug">{faq.question}</h3>
                      <p className="text-sm text-muted-foreground leading-snug">{faq.answer}</p>
                    </Stack>
                  </CardBody>
                </Card>
              ))}
            </Stack>
          </section>
        </Stack>
      </Container>

      <Section tone="muted" padding="md">
        <Container>
          <TrustStrip />
        </Container>
      </Section>
    </ShopLayout>
  );
}
