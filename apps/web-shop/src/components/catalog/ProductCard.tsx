import { Link } from 'react-router';
import { StockIndicator } from './StockIndicator';

export interface ProductGroup {
  brand: string;
  model: string;
  minPrice: number;
  stockCount: number;
  thumbnailUrl?: string;
  monthlyPaymentFrom: number;
  stock: { display: string; tone: string };
}

export function ProductCard({ product }: { product: ProductGroup }) {
  // For now link by brand+model query — when SEO slugs added, replace with /products/:slug
  const href = `/products?brand=${product.brand}&model=${encodeURIComponent(product.model)}`;
  return (
    <Link
      to={href}
      className="border border-border rounded-lg p-4 hover:shadow transition flex flex-col"
    >
      {product.thumbnailUrl && (
        <img
          src={product.thumbnailUrl}
          alt={`${product.brand} ${product.model}`}
          className="w-full aspect-square object-contain mb-3"
        />
      )}
      <h3 className="font-semibold">
        {product.brand} {product.model}
      </h3>
      <p className="text-primary font-bold mt-1">เริ่มต้น ฿{product.minPrice.toLocaleString()}</p>
      <p className="text-xs text-muted-foreground">
        ผ่อน ฿{product.monthlyPaymentFrom.toLocaleString()}/เดือน
      </p>
      <div className="mt-2">
        <StockIndicator display={product.stock.display} tone={product.stock.tone} />
      </div>
    </Link>
  );
}
