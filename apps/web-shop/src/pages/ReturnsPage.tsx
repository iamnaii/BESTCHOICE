import { ShieldCheck, RotateCcw, MessageCircle, Phone } from 'lucide-react';
import {
  CategoryHero,
  Container,
  Stack,
  Section,
  Card,
  CardBody,
  Button,
  TrustStrip,
} from '@/components';
import ShopLayout from '@/components/layout/ShopLayout';
import { copy } from '@/lib/copy';

export default function ReturnsPage() {
  return (
    <ShopLayout>
      <CategoryHero
        title={copy.returns.pageTitle}
        description={copy.returns.intro}
        breadcrumbs={[
          { label: 'หน้าแรก', to: '/' },
          { label: copy.returns.pageTitle },
        ]}
      />
      <Container>
        <Stack gap={6} className="py-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card variant="outlined" className="bg-emerald-50 border-emerald-200">
              <CardBody>
                <Stack gap={3} className="leading-snug">
                  <span className="inline-flex size-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                    <ShieldCheck className="size-6" aria-hidden="true" />
                  </span>
                  <h3 className="text-lg font-semibold leading-snug">
                    {copy.returns.warrantyTitle}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-snug">
                    {copy.returns.warrantyBody}
                  </p>
                </Stack>
              </CardBody>
            </Card>

            <Card variant="outlined">
              <CardBody>
                <Stack gap={3} className="leading-snug">
                  <span className="inline-flex size-11 items-center justify-center rounded-full bg-muted text-foreground">
                    <RotateCcw className="size-6" aria-hidden="true" />
                  </span>
                  <h3 className="text-lg font-semibold leading-snug">
                    {copy.returns.refundTitle}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-snug">
                    {copy.returns.refundBody}
                  </p>
                </Stack>
              </CardBody>
            </Card>

            <Card variant="outlined" className="bg-emerald-50 border-emerald-200">
              <CardBody>
                <Stack gap={3} className="leading-snug">
                  <span className="inline-flex size-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                    <MessageCircle className="size-6" aria-hidden="true" />
                  </span>
                  <h3 className="text-lg font-semibold leading-snug">
                    {copy.returns.contactTitle}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-snug">
                    {copy.returns.contactBody}
                  </p>
                  <Stack gap={2}>
                    <Button asChild variant="primary" size="md" fullWidth>
                      <a
                        href="https://line.me/R/ti/p/@bestchoice"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <MessageCircle className="size-4" aria-hidden="true" />
                        {copy.returns.lineCta}
                      </a>
                    </Button>
                    <Button asChild variant="outline" size="md" fullWidth>
                      <a href="tel:036-XXX-XXX">
                        <Phone className="size-4" aria-hidden="true" />
                        {copy.returns.phoneCta}
                      </a>
                    </Button>
                  </Stack>
                </Stack>
              </CardBody>
            </Card>
          </div>
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
