import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useCart } from '../hooks/useCart';
import { useAuth } from '../hooks/useAuth';
import ShopLayout from '../components/layout/ShopLayout';
import CheckoutStepper from '../components/checkout/CheckoutStepper';
import AddressStep from '../components/checkout/AddressStep';
import ShippingStep from '../components/checkout/ShippingStep';
import PaymentStep from '../components/checkout/PaymentStep';
import type { ShippingAddress, ShippingMethod } from '../types/shipping';

export default function CheckoutPage() {
  const nav = useNavigate();
  const { customer, hydrating } = useAuth();
  const { data: cart } = useCart();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [address, setAddress] = useState<ShippingAddress | null>(null);
  const [ship, setShip] = useState<{ method: ShippingMethod; fee: number } | null>(null);

  if (hydrating) {
    return (
      <ShopLayout>
        <div className="p-8 text-muted-foreground">กำลังโหลด...</div>
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

  return (
    <ShopLayout>
      <div className="container mx-auto px-4 py-4">
        <CheckoutStepper step={step} />
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
      </div>
    </ShopLayout>
  );
}
