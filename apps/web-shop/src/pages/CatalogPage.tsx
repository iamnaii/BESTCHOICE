import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, SlidersHorizontal } from 'lucide-react';
import ShopLayout from '@/components/layout/ShopLayout';
import { FilterSidebar, type CatalogFilters } from '@/components/catalog/FilterSidebar';
import { SortDropdown } from '@/components/catalog/SortDropdown';
import {
  Container,
  CategoryHero,
  StatefulList,
  ProductCard,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  type ProductGroup,
} from '@/components';
import { api } from '@/lib/api';
import { copy } from '@/lib/copy';
import { useTrackEvent } from '@/hooks/useTrackEvent';

interface CatalogResponse {
  data: ProductGroup[];
  total: number;
  page: number;
  limit: number;
}

export default function CatalogPage() {
  const [filters, setFilters] = useState<CatalogFilters>({});
  const [sort, setSort] = useState<string>('popular');
  const track = useTrackEvent();

  useEffect(() => {
    track('ViewContent', { content_type: 'catalog' });
  }, [track]);

  const { data, isLoading, isError, refetch } = useQuery<CatalogResponse>({
    queryKey: ['shop', 'catalog', filters, sort],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters.brand) params.set('brand', filters.brand);
      if (filters.conditionGrade) params.set('conditionGrade', filters.conditionGrade);
      if (filters.minPrice !== undefined) params.set('minPrice', String(filters.minPrice));
      if (filters.maxPrice !== undefined) params.set('maxPrice', String(filters.maxPrice));
      params.set('sort', sort);
      return api.get(`/api/shop/products?${params}`).then((r) => r.data);
    },
  });

  return (
    <ShopLayout>
      <CategoryHero
        title={copy.catalog.pageTitle}
        breadcrumbs={[{ label: 'หน้าแรก', to: '/' }, { label: copy.catalog.pageTitle }]}
      />

      <Container className="py-6 md:py-8">
        <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-6">
          <aside className="hidden md:block">
            <FilterSidebar filters={filters} onChange={setFilters} />
          </aside>

          <div className="space-y-4 leading-snug">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {isLoading ? copy.common.loading : `${data?.total ?? 0} รุ่น`}
              </p>
              <div className="flex items-center gap-2">
                <div className="md:hidden">
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="md">
                        <SlidersHorizontal className="size-4" />
                        ตัวกรอง
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>ตัวกรอง</DialogTitle>
                      </DialogHeader>
                      <FilterSidebar filters={filters} onChange={setFilters} />
                    </DialogContent>
                  </Dialog>
                </div>
                <SortDropdown value={sort} onChange={setSort} />
              </div>
            </div>

            <StatefulList<ProductGroup>
              isLoading={isLoading}
              isError={isError}
              data={data?.data}
              loadingVariant="card-grid"
              onRetry={() => refetch()}
              emptyState={{
                icon: <Search className="size-12" />,
                title: copy.catalog.emptyTitle,
                description: copy.catalog.emptyDescription,
              }}
              wrapperClassName="grid grid-cols-2 md:grid-cols-3 gap-4"
              renderItem={(p) => <ProductCard key={`${p.brand}-${p.model}`} product={p} />}
            />
          </div>
        </div>
      </Container>
    </ShopLayout>
  );
}
