import { Store, Truck, Package, MapPin, Clock, type LucideIcon } from 'lucide-react';
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

interface ShippingMethod {
  key: string;
  Icon: LucideIcon;
  name: string;
  fee: string;
  eta: string;
  description: string;
}

const METHODS: ShippingMethod[] = [
  {
    key: 'BRANCH_PICKUP',
    Icon: Store,
    name: copy.shipping.branchPickupName,
    fee: copy.shipping.branchPickupFee,
    eta: copy.shipping.branchPickupEta,
    description: copy.shipping.branchPickupDescription,
  },
  {
    key: 'KERRY',
    Icon: Truck,
    name: copy.shipping.kerryName,
    fee: copy.shipping.kerryFee,
    eta: copy.shipping.kerryEta,
    description: copy.shipping.kerryDescription,
  },
  {
    key: 'FLASH',
    Icon: Truck,
    name: copy.shipping.flashName,
    fee: copy.shipping.flashFee,
    eta: copy.shipping.flashEta,
    description: copy.shipping.flashDescription,
  },
  {
    key: 'JT',
    Icon: Truck,
    name: copy.shipping.jtName,
    fee: copy.shipping.jtFee,
    eta: copy.shipping.jtEta,
    description: copy.shipping.jtDescription,
  },
  {
    key: 'THAILAND_POST',
    Icon: Package,
    name: copy.shipping.thailandPostName,
    fee: copy.shipping.thailandPostFee,
    eta: copy.shipping.thailandPostEta,
    description: copy.shipping.thailandPostDescription,
  },
];

export default function ShippingPage() {
  return (
    <ShopLayout>
      <CategoryHero
        title={copy.shipping.pageTitle}
        breadcrumbs={[
          { label: 'หน้าแรก', to: '/' },
          { label: copy.shipping.pageTitle },
        ]}
      />
      <Container>
        <Stack gap={6} className="py-8">
          <Stack gap={3} className="leading-snug">
            <p className="text-sm md:text-base text-muted-foreground leading-snug">
              {copy.shipping.intro1}
            </p>
            <p className="text-sm md:text-base text-muted-foreground leading-snug">
              {copy.shipping.intro2}
            </p>
          </Stack>

          <section>
            <SectionHeader title={copy.shipping.methodsTitle} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {METHODS.map((m) => (
                <Card key={m.key} variant="outlined">
                  <CardBody>
                    <Stack gap={3} className="leading-snug">
                      <div className="flex items-start justify-between gap-3">
                        <span className="inline-flex size-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                          <m.Icon className="size-5" aria-hidden="true" />
                        </span>
                        <span className="text-base font-semibold text-emerald-700">{m.fee}</span>
                      </div>
                      <div className="space-y-1">
                        <h3 className="text-base font-semibold leading-snug">{m.name}</h3>
                        <p className="text-xs text-muted-foreground leading-snug">{m.eta}</p>
                      </div>
                      <p className="text-sm text-muted-foreground leading-snug">{m.description}</p>
                    </Stack>
                  </CardBody>
                </Card>
              ))}
            </div>
          </section>

          <section>
            <SectionHeader title={copy.shipping.branchTitle} />
            <Card variant="outlined">
              <div className="grid grid-cols-1 md:grid-cols-2">
                <CardBody>
                  <Stack gap={3} className="leading-snug">
                    <div className="flex items-start gap-3">
                      <MapPin className="size-5 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
                      <p className="text-sm text-muted-foreground leading-snug">
                        {copy.shipping.branchAddress}
                      </p>
                    </div>
                    <div className="flex items-start gap-3">
                      <Clock className="size-5 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
                      <p className="text-sm text-muted-foreground leading-snug">
                        {copy.shipping.branchHours}
                      </p>
                    </div>
                  </Stack>
                </CardBody>
                <div className="aspect-video md:aspect-auto md:min-h-[200px]">
                  <img
                    src={media('shop.map')}
                    alt={copy.shipping.branchTitle}
                    className="size-full object-cover"
                  />
                </div>
              </div>
            </Card>
          </section>
        </Stack>
      </Container>

      <Section tone="muted" padding="md" />
    </ShopLayout>
  );
}
