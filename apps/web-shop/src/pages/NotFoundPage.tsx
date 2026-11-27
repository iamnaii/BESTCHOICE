import { Link } from 'react-router';
import { Compass } from '@/lib/icons';
import ShopLayout from '@/components/layout/ShopLayout';
import { Button, Container } from '@/components';
import { copy } from '@/lib/copy';
import { usePageMeta } from '@/hooks/usePageMeta';

export default function NotFoundPage() {
  // Hosting ตอบ 200 ให้ทุก path (rewrite ** → spa-shell.html) — noindex กัน soft 404
  usePageMeta(copy.notFound.pageTitle, undefined, { noindex: true });
  return (
    <ShopLayout>
      <Container>
        <div className="py-16 md:py-24 flex flex-col items-center text-center leading-snug">
          <Compass className="size-12 text-zinc-300 mb-4" aria-hidden="true" />
          <h1 className="text-2xl md:text-3xl font-semibold">{copy.notFound.pageTitle}</h1>
          <p className="mt-3 text-sm md:text-base text-muted-foreground max-w-sm">
            {copy.notFound.description}
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3">
            <Button asChild variant="primary" size="lg">
              <Link to="/">{copy.notFound.homeCta}</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link to="/products">{copy.notFound.productsCta}</Link>
            </Button>
          </div>
        </div>
      </Container>
    </ShopLayout>
  );
}
