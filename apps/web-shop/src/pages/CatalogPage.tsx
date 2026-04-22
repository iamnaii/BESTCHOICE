import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import ShopLayout from '@/components/layout/ShopLayout';
import { ProductCard, type ProductGroup } from '@/components/catalog/ProductCard';
import { FilterSidebar, type CatalogFilters } from '@/components/catalog/FilterSidebar';
import { SortDropdown } from '@/components/catalog/SortDropdown';
import { api } from '@/lib/api';
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

  const { data, isLoading } = useQuery<CatalogResponse>({
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
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-6">สินค้าทั้งหมด</h1>
        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6">
          <FilterSidebar filters={filters} onChange={setFilters} />
          <div>
            <div className="flex justify-between items-center mb-4">
              <p className="text-sm text-muted-foreground">
                {isLoading ? 'กำลังโหลด...' : `${data?.total ?? 0} รุ่น`}
              </p>
              <SortDropdown value={sort} onChange={setSort} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {data?.data.map((p) => (
                <ProductCard key={`${p.brand}-${p.model}`} product={p} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </ShopLayout>
  );
}
