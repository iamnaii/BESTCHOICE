import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import ShopLayout from '@/components/layout/ShopLayout';
import { api } from '@/lib/api';

interface ProductGroup {
  brand: string;
  model: string;
  minPrice: number;
  stockCount: number;
  thumbnailUrl?: string;
  monthlyPaymentFrom: number;
  stock: { display: string; tone: string };
}

export default function HomePage() {
  const { data, isLoading } = useQuery<{ data: ProductGroup[] }>({
    queryKey: ['shop', 'home', 'featured'],
    queryFn: () => api.get('/api/shop/products?limit=8&sort=popular').then((r) => r.data),
  });

  return (
    <ShopLayout>
      {/* Hero */}
      <section className="bg-primary text-primary-foreground py-16">
        <div className="container mx-auto px-4 text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            iPhone มือสองคุณภาพ ผ่อนได้บัตร ปชช. ใบเดียว
          </h1>
          <p className="text-lg mb-8 opacity-90">
            ร้านมือถือลพบุรี — ของแท้ 100% รับประกันร้าน 30 วัน
          </p>
          <Link
            to="/products"
            className="inline-block bg-white text-primary px-8 py-3 rounded-lg font-semibold hover:opacity-90"
          >
            ดูสินค้าทั้งหมด
          </Link>
        </div>
      </section>

      {/* Featured products */}
      <section className="container mx-auto px-4 py-12">
        <h2 className="text-2xl font-bold mb-6">รุ่นยอดนิยม</h2>
        {isLoading && <div>กำลังโหลด...</div>}
        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {data.data.map((p) => (
              <Link
                key={`${p.brand}-${p.model}`}
                to={`/products?brand=${p.brand}&model=${encodeURIComponent(p.model)}`}
                className="border border-border rounded-lg p-4 hover:shadow transition"
              >
                {p.thumbnailUrl && (
                  <img
                    src={p.thumbnailUrl}
                    alt={`${p.brand} ${p.model}`}
                    className="w-full aspect-square object-contain mb-3"
                  />
                )}
                <h3 className="font-semibold">
                  {p.brand} {p.model}
                </h3>
                <p className="text-primary font-bold">เริ่มต้น ฿{p.minPrice.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">
                  ผ่อน ฿{p.monthlyPaymentFrom.toLocaleString()}/เดือน
                </p>
                <p className="text-xs mt-1">{p.stock.display}</p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </ShopLayout>
  );
}
