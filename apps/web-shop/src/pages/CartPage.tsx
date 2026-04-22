import { useNavigate } from 'react-router';
import { ShoppingCart } from 'lucide-react';
import { useCart } from '../hooks/useCart';
import ShopLayout from '../components/layout/ShopLayout';
import {
  CategoryHero,
  Container,
  Card,
  CardBody,
  Button,
  EmptyState,
  StickyBottomBar,
  StickyBottomBarSpacer,
} from '@/components';
import ReservationCountdownBadge from '../components/cart/ReservationCountdownBadge';
import CartSummary from '../components/cart/CartSummary';
import { copy } from '@/lib/copy';
import { media } from '@/lib/media-placeholders';

export default function CartPage() {
  const nav = useNavigate();
  const { data, isLoading } = useCart();

  if (isLoading) {
    return (
      <ShopLayout>
        <Container>
          <div className="py-10 text-muted-foreground leading-snug">{copy.common.loading}</div>
        </Container>
      </ShopLayout>
    );
  }

  if (!data || data.items.length === 0) {
    return (
      <ShopLayout>
        <CategoryHero
          title={copy.cart.pageTitle}
          breadcrumbs={[
            { label: 'หน้าแรก', to: '/' },
            { label: copy.cart.pageTitle },
          ]}
        />
        <Container>
          <EmptyState
            icon={<ShoppingCart className="size-12" aria-hidden="true" />}
            title={copy.cart.emptyTitle}
            description={copy.cart.emptyDescription}
            cta={{ label: copy.cart.emptyCta, to: '/products' }}
          />
        </Container>
      </ShopLayout>
    );
  }

  return (
    <ShopLayout>
      <CategoryHero
        title={copy.cart.pageTitle}
        breadcrumbs={[
          { label: 'หน้าแรก', to: '/' },
          { label: copy.cart.pageTitle },
        ]}
      />
      <Container>
        <div className="py-6 grid md:grid-cols-3 gap-6 leading-snug">
          {/* Mobile compact summary at top */}
          <div className="md:hidden">
            <Card variant="outlined">
              <CardBody className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {copy.checkout.summaryTitle}
                </span>
                <span className="font-bold">฿{data.subtotal.toLocaleString()}</span>
              </CardBody>
            </Card>
          </div>

          <div className="md:col-span-2 space-y-3">
            {data.items.map((i) => {
              const thumb = i.product.gallery?.[0] ?? media('product.placeholder');
              return (
                <Card key={i.reservationId} variant="outlined">
                  <CardBody>
                    <div className="grid grid-cols-[96px_1fr_auto] gap-4 items-start leading-snug">
                      <div className="h-24 w-24 rounded-xl overflow-hidden bg-muted shrink-0">
                        <img
                          src={thumb}
                          alt={i.product.name}
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="space-y-1.5 min-w-0">
                        <div className="font-semibold truncate">{i.product.name}</div>
                        {i.product.conditionGrade && (
                          <div className="text-xs text-muted-foreground">
                            เกรด {i.product.conditionGrade}
                          </div>
                        )}
                        <div className="font-bold">
                          ฿{Number(i.product.sellingPrice).toLocaleString()}
                        </div>
                        <ReservationCountdownBadge expiresAt={i.expiresAt} />
                      </div>
                    </div>
                  </CardBody>
                </Card>
              );
            })}
          </div>

          {/* Desktop sticky summary */}
          <div className="hidden md:block">
            <div className="sticky top-4">
              <Card variant="elevated">
                <CardBody>
                  <CartSummary
                    subtotal={data.subtotal}
                    onCheckout={() => nav('/checkout')}
                  />
                </CardBody>
              </Card>
            </div>
          </div>
        </div>
      </Container>

      {/* Mobile sticky CTA */}
      <StickyBottomBar>
        <Button fullWidth size="lg" onClick={() => nav('/checkout')}>
          {copy.cart.proceedCta}
        </Button>
      </StickyBottomBar>
      <StickyBottomBarSpacer />
    </ShopLayout>
  );
}
