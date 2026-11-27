import { MessageCircle, Phone, MapPin, Clock } from '@/lib/icons';
import { CategoryHero, Container, Stack, Card, CardBody, Button } from '@/components';
import ShopLayout from '@/components/layout/ShopLayout';
import { copy, shopInfo } from '@/lib/copy';
import { usePageMeta } from '@/hooks/usePageMeta';

export default function ContactPage() {
  usePageMeta(
    copy.contact.pageTitle,
    'ติดต่อ BESTCHOICE ร้านมือถือลพบุรี ทักไลน์หรือโทรสอบถามซื้อ-ผ่อน iPhone มือ 1 และมือสอง',
  );

  // ไม่มีฟอร์มฝากข้อความ (เจ้าของ 2026-11-27) — ฟอร์มเดิมไม่เคยส่งไปไหน ลูกค้ากดแล้วข้อความหาย ·
  // ช่องทางติดต่อมีแค่ LINE / โทร ที่การ์ดด้านล่าง + ปุ่มลอย "ทักแชท"
  return (
    <ShopLayout>
      <CategoryHero
        title={copy.contact.pageTitle}
        description={copy.contact.intro}
        breadcrumbs={[{ label: 'หน้าแรก', to: '/' }, { label: copy.contact.pageTitle }]}
      />
      <Container>
        <Stack gap={6} className="py-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card variant="outlined" className="bg-mint-tint border-border">
              <CardBody>
                <Stack gap={4} className="leading-snug">
                  <span className="inline-flex size-11 items-center justify-center rounded-full bg-mint-tint text-brand-green-dark">
                    <MessageCircle className="size-6" aria-hidden="true" />
                  </span>
                  <div className="space-y-1">
                    <h2 className="text-lg font-semibold leading-snug">{copy.contact.lineTitle}</h2>
                    <p className="text-base font-medium text-primary leading-snug">
                      {copy.contact.lineHandle}
                    </p>
                    <p className="text-sm text-muted-foreground leading-snug">
                      {copy.contact.lineDescription}
                    </p>
                  </div>
                  <Button asChild variant="line" size="lg" fullWidth>
                    <a
                      href={shopInfo.lineUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <MessageCircle className="size-4" aria-hidden="true" />
                      {copy.contact.lineCta}
                    </a>
                  </Button>
                </Stack>
              </CardBody>
            </Card>

            <Card variant="outlined">
              <CardBody>
                <Stack gap={4} className="leading-snug">
                  <span className="inline-flex size-11 items-center justify-center rounded-full bg-muted text-foreground">
                    <Phone className="size-6" aria-hidden="true" />
                  </span>
                  <div className="space-y-1">
                    <h2 className="text-lg font-semibold leading-snug">
                      {copy.contact.phoneTitle}
                    </h2>
                    <p className="text-base font-medium leading-snug">{copy.contact.phoneNumber}</p>
                    <p className="text-sm text-muted-foreground leading-snug">
                      {copy.contact.phoneDescription}
                    </p>
                  </div>
                  <Button asChild variant="outline" size="lg" fullWidth>
                    <a href={shopInfo.phoneHref}>
                      <Phone className="size-4" aria-hidden="true" />
                      {copy.contact.phoneCta}
                    </a>
                  </Button>
                </Stack>
              </CardBody>
            </Card>
          </div>

          <Card variant="outlined">
            <CardBody>
              <Stack gap={3} className="leading-snug">
                <h2 className="text-lg font-semibold leading-snug">{copy.contact.addressTitle}</h2>
                <div className="flex items-start gap-3">
                  <MapPin className="size-5 text-brand-green shrink-0 mt-0.5" aria-hidden="true" />
                  <p className="text-sm text-muted-foreground leading-snug">
                    {copy.contact.address}
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <Clock className="size-5 text-brand-green shrink-0 mt-0.5" aria-hidden="true" />
                  <p className="text-sm text-muted-foreground leading-snug">{copy.contact.hours}</p>
                </div>
              </Stack>
            </CardBody>
          </Card>
        </Stack>
      </Container>
    </ShopLayout>
  );
}
