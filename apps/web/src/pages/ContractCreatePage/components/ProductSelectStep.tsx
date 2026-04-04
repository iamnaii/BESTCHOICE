import type { Product } from '../types';

export interface ProductSelectStepProps {
  products: Product[];
  productSearch: string;
  setProductSearch: (v: string) => void;
  selectedProduct: Product | null;
  setSelectedProduct: (p: Product) => void;
  onNext: () => void;
}

export function ProductSelectStep({
  products,
  productSearch,
  setProductSearch,
  selectedProduct,
  setSelectedProduct,
  onNext,
}: ProductSelectStepProps) {
  return (
    <div>
      <input
        type="text"
        placeholder="ค้นหาสินค้า (ชื่อ, ยี่ห้อ, รุ่น, IMEI)..."
        value={productSearch}
        onChange={(e) => setProductSearch(e.target.value)}
        className="w-full px-3 py-2 border border-input rounded-lg text-sm mb-4 focus:ring-2 focus:ring-ring/30 focus:border-ring transition-colors outline-none"
      />
      <div className="grid gap-3">
        {products.map((p) => (
          <div
            key={p.id}
            onClick={() => setSelectedProduct(p)}
            onDoubleClick={() => { setSelectedProduct(p); onNext(); }}
            className={`p-4 rounded-xl border cursor-pointer transition-all hover:shadow-card-hover ${selectedProduct?.id === p.id ? 'border-primary bg-primary/5 border-l-[3px] border-l-primary' : 'border-border/60 hover:border-border'}`}
          >
            <div className="flex justify-between items-start">
              <div>
                <div className="font-medium text-sm">{p.brand} {p.model}</div>
                <div className="text-xs text-muted-foreground mt-1">{p.name}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  สาขา: {p.branch?.name}
                  <span className="ml-2 px-1.5 py-0.5 bg-secondary rounded text-2xs">{p.category === 'PHONE_NEW' ? 'มือ 1' : p.category === 'PHONE_USED' ? 'มือ 2' : p.category}</span>
                </div>
              </div>
              <div className="text-right">
                {p.prices.map((pr) => (
                  <div key={pr.id} className="text-xs">
                    <span className="text-muted-foreground">{pr.label}: </span>
                    <span className="font-medium">{parseFloat(pr.amount).toLocaleString()} ฿</span>
                    {pr.isDefault && <span className="ml-1 text-primary">(หลัก)</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
        {products.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-sm">ไม่พบสินค้าที่พร้อมขาย</div>
        )}
      </div>
    </div>
  );
}
