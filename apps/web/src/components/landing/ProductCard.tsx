import { SHOP_BASE_URL } from '@/lib/env';

interface ProductCardProps {
  productId?: string;
  brand: string;
  model: string;
  price: string;
  category: string;
}

const categoryLabels: Record<string, string> = {
  PHONE_NEW: 'มือถือใหม่',
  PHONE_USED: 'มือถือมือสอง',
  TABLET: 'แท็บเล็ต',
  ACCESSORY: 'อุปกรณ์เสริม',
};

export default function ProductCard({
  productId,
  brand,
  model,
  price,
  category,
}: ProductCardProps) {
  const categoryLabel = categoryLabels[category] || category;

  return (
    <div className="group bg-card rounded-2xl border border-border overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
      {/* Image Placeholder */}
      <div className="relative h-48 bg-linear-to-br from-muted to-muted/80 flex items-center justify-center overflow-hidden">
        <div className="text-center">
          <svg className="w-16 h-16 text-muted-foreground/50 mx-auto group-hover:scale-110 transition-transform duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
          <p className="text-xs text-muted-foreground mt-1">{brand}</p>
        </div>

        {/* Category Badge */}
        <span className="absolute top-3 left-3 px-2.5 py-1 text-[10px] font-semibold bg-primary-600 text-white rounded-full">
          {categoryLabel}
        </span>
      </div>

      {/* Content */}
      <div className="p-4">
        <h3 className="font-semibold text-foreground text-sm">{brand} {model}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">{categoryLabel}</p>

        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">เริ่มต้นที่</p>
            <p className="text-lg font-bold text-primary-600">
              {(Number(price) || 0).toLocaleString()}
              <span className="text-sm font-normal text-muted-foreground ml-1">฿</span>
            </p>
          </div>
          <a
            data-ui-control="button"
            href={productId
              ? `${SHOP_BASE_URL}/products/${encodeURIComponent(productId)}`
              : `${SHOP_BASE_URL}/products?search=${encodeURIComponent(`${brand} ${model}`)}`}
            className="px-3 py-2 text-sm font-medium text-primary bg-primary/10 hover:bg-primary/15 rounded-lg transition-colors"
          >
            ดูรายละเอียด
          </a>
        </div>
      </div>
    </div>
  );
}
