import { BadgeCheck, ShieldCheck, MapPin, type LucideIcon } from 'lucide-react';
import {
  CategoryHero,
  Container,
  Stack,
  Section,
  SectionHeader,
  Card,
  CardBody,
} from '@/components';
import ShopLayout from '@/components/layout/ShopLayout';
import { copy } from '@/lib/copy';
import { media } from '@/lib/media-placeholders';

interface Milestone {
  year: string;
  title: string;
  description: string;
}

interface Value {
  Icon: LucideIcon;
  title: string;
  description: string;
}

const MILESTONES: Milestone[] = [
  {
    year: copy.about.milestone1Year,
    title: copy.about.milestone1Title,
    description: copy.about.milestone1Description,
  },
  {
    year: copy.about.milestone2Year,
    title: copy.about.milestone2Title,
    description: copy.about.milestone2Description,
  },
  {
    year: copy.about.milestone3Year,
    title: copy.about.milestone3Title,
    description: copy.about.milestone3Description,
  },
  {
    year: copy.about.milestone4Year,
    title: copy.about.milestone4Title,
    description: copy.about.milestone4Description,
  },
];

const VALUES: Value[] = [
  {
    Icon: BadgeCheck,
    title: copy.about.value1Title,
    description: copy.about.value1Description,
  },
  {
    Icon: ShieldCheck,
    title: copy.about.value2Title,
    description: copy.about.value2Description,
  },
  {
    Icon: MapPin,
    title: copy.about.value3Title,
    description: copy.about.value3Description,
  },
];

export default function AboutPage() {
  return (
    <ShopLayout>
      <CategoryHero
        title={copy.about.pageTitle}
        breadcrumbs={[
          { label: 'หน้าแรก', to: '/' },
          { label: copy.about.pageTitle },
        ]}
      />
      <Container>
        <Stack gap={6} className="py-8">
          <section>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
              <Stack gap={4} className="leading-snug">
                <h2 className="text-2xl md:text-3xl font-bold leading-snug">
                  {copy.about.storyTitle}
                </h2>
                <p className="text-sm md:text-base text-muted-foreground leading-snug">
                  {copy.about.storyP1}
                </p>
                <p className="text-sm md:text-base text-muted-foreground leading-snug">
                  {copy.about.storyP2}
                </p>
              </Stack>
              <img
                src={media('staff.team')}
                alt={copy.about.storyTitle}
                className="w-full rounded-3xl aspect-[4/3] object-cover"
              />
            </div>
          </section>

          <section>
            <SectionHeader title={copy.about.timelineTitle} />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {MILESTONES.map((m, i) => (
                <Card key={i} variant="outlined">
                  <CardBody>
                    <Stack gap={2} className="leading-snug">
                      <span className="inline-flex items-center justify-center px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-sm font-semibold w-fit">
                        {m.year}
                      </span>
                      <h3 className="text-base font-semibold leading-snug">{m.title}</h3>
                      <p className="text-sm text-muted-foreground leading-snug">{m.description}</p>
                    </Stack>
                  </CardBody>
                </Card>
              ))}
            </div>
          </section>

          <section>
            <SectionHeader title={copy.about.valuesTitle} />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {VALUES.map((v, i) => (
                <Card key={i} variant="outlined">
                  <CardBody>
                    <Stack gap={3} className="leading-snug">
                      <span className="inline-flex size-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                        <v.Icon className="size-6" aria-hidden="true" />
                      </span>
                      <h3 className="text-lg font-semibold leading-snug">{v.title}</h3>
                      <p className="text-sm text-muted-foreground leading-snug">{v.description}</p>
                    </Stack>
                  </CardBody>
                </Card>
              ))}
            </div>
          </section>
        </Stack>
      </Container>

      <Section tone="muted" padding="md" />
    </ShopLayout>
  );
}
