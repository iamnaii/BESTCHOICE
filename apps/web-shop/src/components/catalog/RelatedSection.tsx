import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Container, Section, ProductCard, type ProductGroup } from '@/components';

export function RelatedSection({ productId }: { productId: string }) {
  const { data } = useQuery<ProductGroup[]>({
    queryKey: ['shop', 'related', productId],
    queryFn: () => api.get(`/api/shop/products/${productId}/related`).then((r) => r.data),
    enabled: !!productId,
    staleTime: 5 * 60_000,
  });

  if (!data || data.length === 0) return null;

  return (
    <Section padding="md">
      <Container>
        <h2 className="font-display text-xl md:text-2xl font-semibold mb-5 leading-snug">
          รุ่นใกล้เคียง
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-3 gap-y-6 md:gap-x-6">
          {data.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </Container>
    </Section>
  );
}
