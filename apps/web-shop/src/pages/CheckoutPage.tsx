import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useCart } from '../hooks/useCart';
import { useAuth } from '../hooks/useAuth';
import { useTrackEvent } from '../hooks/useTrackEvent';
import ShopLayout from '../components/layout/ShopLayout';
import CheckoutStepper from '../components/checkout/CheckoutStepper';
import AddressStep from '../components/checkout/AddressStep';
import ShippingStep from '../components/checkout/ShippingStep';
import PaymentStep from '../components/checkout/PaymentStep';
import OrderSummaryCard from '../components/checkout/OrderSummaryCard';
import {
  CategoryHero,
  Container,
  Card,
  CardBody,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components';
import type { ShippingAddress, ShippingMethod } from '../types/shipping';
import { copy } from '@/lib/copy';

export default function CheckoutPage() {
  const nav = useNavigate();
  const { customer, hydrating } = useAuth();
  const { data: cart } = useCart();
  const track = useTrackEvent();

  useEffect(() => {
    track('InitiateCheckout');
  }, [track]);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [address, setAddress] = useState<ShippingAddress | null>(null);
  const [ship, setShip] = useState<{ method: ShippingMethod; fee: number } | null>(null);

  if (hydrating) {
    return (
      <ShopLayout>
        <Container>
          <div className="py-10 text-muted-foreground leading-snug">{copy.common.loading}</div>
        </Container>
      </ShopLayout>
    );
  }
  if (!customer) {
    nav('/login?returnTo=/checkout');
    return null;
  }
  if (!cart || cart.items.length === 0) {
    nav('/cart');
    return null;
  }

  const item = cart.items[0];
  const shippingFee = ship?.fee ?? 0;

  return (
    <ShopLayout>
      <CategoryHero
        title={copy.checkout.pageTitle}
        breadcrumbs={[
          { label: 'หน้าแรก', to: '/' },
          { label: copy.cart.pageTitle, to: '/cart' },
          { label: copy.checkout.pageTitle },
        ]}
      />
      <Container>
        <div className="py-6 space-y-6 leading-snug">
          <CheckoutStepper current={step} />

          {/* Mobile: compact summary as expandable dialog */}
          <div className="md:hidden">
            <Dialog>
              <DialogTrigger asChild>
                <button
                  type="button"
                  className="w-full rounded-2xl border border-zinc-200 bg-card p-4 text-left flex items-center justify-between leading-snug"
                >
                  <span className="text-sm text-muted-foreground">
                    {copy.checkout.toggleSummary}
                  </span>
                  <span className="font-bold">
                    ฿{Number(item.product.sellingPrice + shippingFee).toLocaleString()}
                  </span>
                </button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{copy.checkout.summaryTitle}</DialogTitle>
                </DialogHeader>
                <OrderSummaryCard
                  productPrice={item.product.sellingPrice}
                  shippingFee={shippingFee}
                  promoDiscount={0}
                  loyaltyDiscount={0}
                />
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <div className="md:col-span-2">
              <Card variant="elevated">
                <CardBody>
                  {step === 1 && (
                    <AddressStep
                      onNext={(a) => {
                        setAddress(a);
                        setStep(2);
                      }}
                    />
                  )}
                  {step === 2 && address && (
                    <ShippingStep
                      onBack={() => setStep(1)}
                      onNext={(method, fee) => {
                        setShip({ method, fee });
                        setStep(3);
                      }}
                    />
                  )}
                  {step === 3 && address && ship && (
                    <PaymentStep
                      reservationId={item.reservationId}
                      productPrice={item.product.sellingPrice}
                      shippingMethod={ship.method}
                      shippingFee={ship.fee}
                      shippingAddress={address}
                      onBack={() => setStep(2)}
                      onPlaced={(orderNumber, paymentUrl) => {
                        if (paymentUrl) window.location.href = paymentUrl;
                        else nav(`/checkout/success/${orderNumber}`);
                      }}
                    />
                  )}
                </CardBody>
              </Card>
            </div>

            {/* Desktop sticky summary */}
            <div className="hidden md:block">
              <div className="sticky top-4">
                <Card variant="elevated">
                  <CardBody>
                    <div className="space-y-3">
                      <div className="font-semibold">{copy.checkout.summaryTitle}</div>
                      <OrderSummaryCard
                        productPrice={item.product.sellingPrice}
                        shippingFee={shippingFee}
                        promoDiscount={0}
                        loyaltyDiscount={0}
                      />
                    </div>
                  </CardBody>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </Container>
    </ShopLayout>
  );
}
