import { useState } from 'react';
import { MessageCircle, Phone, MapPin, Clock, Send } from 'lucide-react';
import {
  CategoryHero,
  Container,
  Stack,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Label,
  StickyBottomBar,
  StickyBottomBarSpacer,
} from '@/components';
import ShopLayout from '@/components/layout/ShopLayout';
import { copy } from '@/lib/copy';

export default function ContactPage() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Submit wiring deferred — Cluster D/form cluster owns integration
  }

  return (
    <ShopLayout>
      <CategoryHero
        title={copy.contact.pageTitle}
        description={copy.contact.intro}
        breadcrumbs={[
          { label: 'หน้าแรก', to: '/' },
          { label: copy.contact.pageTitle },
        ]}
      />
      <Container>
        <Stack gap={6} className="py-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card variant="outlined" className="bg-emerald-50 border-emerald-200">
              <CardBody>
                <Stack gap={4} className="leading-snug">
                  <span className="inline-flex size-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                    <MessageCircle className="size-6" aria-hidden="true" />
                  </span>
                  <div className="space-y-1">
                    <h3 className="text-lg font-semibold leading-snug">
                      {copy.contact.lineTitle}
                    </h3>
                    <p className="text-base font-medium text-emerald-700 leading-snug">
                      {copy.contact.lineHandle}
                    </p>
                    <p className="text-sm text-muted-foreground leading-snug">
                      {copy.contact.lineDescription}
                    </p>
                  </div>
                  <Button asChild variant="primary" size="lg" fullWidth>
                    <a
                      href="https://line.me/R/ti/p/@bestchoice"
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
                    <h3 className="text-lg font-semibold leading-snug">
                      {copy.contact.phoneTitle}
                    </h3>
                    <p className="text-base font-medium leading-snug">
                      {copy.contact.phoneNumber}
                    </p>
                    <p className="text-sm text-muted-foreground leading-snug">
                      {copy.contact.phoneDescription}
                    </p>
                  </div>
                  <Button asChild variant="outline" size="lg" fullWidth>
                    <a href="tel:036-XXX-XXX">
                      <Phone className="size-4" aria-hidden="true" />
                      {copy.contact.phoneCta}
                    </a>
                  </Button>
                </Stack>
              </CardBody>
            </Card>
          </div>

          <Card variant="elevated">
            <CardHeader>
              <CardTitle>{copy.contact.formTitle}</CardTitle>
              <p className="text-sm text-muted-foreground leading-snug mt-1">
                {copy.contact.formDescription}
              </p>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleSubmit} id="contact-form">
                <Stack gap={4}>
                  <div className="space-y-1.5">
                    <Label htmlFor="contact-name" required>
                      {copy.contact.formNameLabel}
                    </Label>
                    <Input
                      id="contact-name"
                      variant="lg"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={copy.contact.formNamePlaceholder}
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="contact-phone" required>
                      {copy.contact.formPhoneLabel}
                    </Label>
                    <Input
                      id="contact-phone"
                      variant="lg"
                      type="tel"
                      inputMode="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder={copy.contact.formPhonePlaceholder}
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="contact-message" required>
                      {copy.contact.formMessageLabel}
                    </Label>
                    <textarea
                      id="contact-message"
                      rows={4}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder={copy.contact.formMessagePlaceholder}
                      className="flex w-full bg-background border border-input shadow-sm rounded-md px-4 py-2.5 text-sm leading-snug text-foreground placeholder:text-muted-foreground/80 focus-visible:ring-ring/30 focus-visible:border-ring focus-visible:outline-hidden focus-visible:ring-[3px]"
                      required
                    />
                  </div>

                  <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    fullWidth
                    className="hidden md:inline-flex"
                  >
                    <Send className="size-4" aria-hidden="true" />
                    {copy.contact.formSubmitCta}
                  </Button>
                </Stack>
              </form>
            </CardBody>
          </Card>

          <Card variant="outlined">
            <CardBody>
              <Stack gap={3} className="leading-snug">
                <h3 className="text-lg font-semibold leading-snug">
                  {copy.contact.addressTitle}
                </h3>
                <div className="flex items-start gap-3">
                  <MapPin className="size-5 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
                  <p className="text-sm text-muted-foreground leading-snug">
                    {copy.contact.address}
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <Clock className="size-5 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
                  <p className="text-sm text-muted-foreground leading-snug">
                    {copy.contact.hours}
                  </p>
                </div>
              </Stack>
            </CardBody>
          </Card>
        </Stack>

        <StickyBottomBarSpacer />
      </Container>

      <StickyBottomBar>
        <Button type="submit" form="contact-form" variant="primary" size="lg" fullWidth>
          <Send className="size-4" aria-hidden="true" />
          {copy.contact.formSubmitCta}
        </Button>
      </StickyBottomBar>
    </ShopLayout>
  );
}
