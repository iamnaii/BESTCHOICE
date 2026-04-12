import { useState, useMemo } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useForm } from 'react-hook-form';
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Copy } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { useDebounce } from '@/hooks/useDebounce';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { saleTypeConfig, paymentMethods, type SaleType } from '@/lib/constants';
import {
  Form,
  FormField,
  FormItem,
  FormControl,
  FormMessage,
} from '@/components/ui/form';
import { posSaleSchema, type PosSaleFormData } from '@/lib/schemas';

// Only show CASH and EXTERNAL_FINANCE in POS (INSTALLMENT requires formal contract via /contracts/create)
const posSaleTypes = Object.entries(saleTypeConfig).filter(([type]) => type !== 'INSTALLMENT') as [SaleType, typeof saleTypeConfig[SaleType]][];

interface TopProduct {
  id: string;
  name: string;
  brand: string;
  model: string;
  count: number;
}

interface Product {
  id: string;
  name: string;
  brand: string;
  model: string;
  imeiSerial: string | null;
  category: string;
  costPrice: string;
  branchId: string;
  branch: { id: string; name: string };
  prices: { id: string; label: string; amount: string; isDefault: boolean }[];
}

interface Customer {
  id: string;
  name: string;
  phone: string;
  nationalId: string;
  _count: { contracts: number };
}

interface PosConfig {
  interestRate: number;
  minDownPaymentPct: number;
  minInstallmentMonths: number;
  maxInstallmentMonths: number;
}

export default function POSPage() {
  useDocumentTitle('ขายสินค้า');
  useAuth(); // ensure user is authenticated
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { copy } = useCopyToClipboard();

  // Sale type (kept as separate state — drives conditional UI sections)
  const [saleType, setSaleType] = useState<SaleType>('CASH');

  // Product search (search-selection state — not part of sale form)
  const [productSearch, setProductSearch] = useState('');
  const debouncedProductSearch = useDebounce(productSearch);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Bundle (freebie) products
  const [bundleSearch, setBundleSearch] = useState('');
  const debouncedBundleSearch = useDebounce(bundleSearch);
  const [bundleProducts, setBundleProducts] = useState<Product[]>([]);

  // Customer search (search-selection state — not part of sale form)
  const [customerSearch, setCustomerSearch] = useState('');
  const debouncedCustomerSearch = useDebounce(customerSearch);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  // Price selection UI state (not submitted directly — maps to sellingPrice via form)
  const [selectedPriceId, setSelectedPriceId] = useState('');

  // Sale form — replaces individual useState for sale detail fields
  const saleForm = useForm<PosSaleFormData>({
    resolver: standardSchemaResolver(posSaleSchema),
    defaultValues: {
      saleType: 'CASH',
      sellingPrice: 0,
      discount: 0,
      paymentMethod: 'CASH',
      amountReceived: undefined,
      downPayment: 0,
      financeCompany: '',
      contractNumber: '',
      totalMonths: '6',
      notes: '',
    },
    mode: 'onChange',
  });

  // Convenient watched values for derived calculations and summary display
  const sellingPrice = String(saleForm.watch('sellingPrice') || 0);
  const discount = String(saleForm.watch('discount') || 0);
  const paymentMethod = saleForm.watch('paymentMethod');
  const amountReceived = String(saleForm.watch('amountReceived') || '');
  const notes = saleForm.watch('notes') ?? '';
  const downPayment = String(saleForm.watch('downPayment') || 0);
  const contractNumber = saleForm.watch('contractNumber') ?? '';
  const totalMonths = saleForm.watch('totalMonths') ?? '6';
  const financeCompany = saleForm.watch('financeCompany') ?? '';

  // Installment fields
  const planType = 'STORE_DIRECT';

  // Product search query
  const { data: products, isFetching: productsFetching, isError: productsError } = useQuery<Product[]>({
    queryKey: ['pos-products', debouncedProductSearch],
    queryFn: async () => {
      if (!debouncedProductSearch || debouncedProductSearch.length < 2) return [];
      const { data } = await api.get('/products', {
        params: { search: debouncedProductSearch, status: 'IN_STOCK', limit: '10' },
      });
      return data.data ?? [];
    },
    enabled: !!debouncedProductSearch && debouncedProductSearch.length >= 2,
  });

  // Bundle product search query (exclude already selected)
  const excludeIds = useMemo(() => {
    const ids = bundleProducts.map(p => p.id);
    if (selectedProduct) ids.push(selectedProduct.id);
    return ids;
  }, [bundleProducts, selectedProduct]);

  const { data: bundleSearchResults, isFetching: bundleSearchFetching } = useQuery<Product[]>({
    queryKey: ['pos-bundle-products', debouncedBundleSearch, excludeIds],
    queryFn: async () => {
      if (!debouncedBundleSearch || debouncedBundleSearch.length < 2) return [];
      const { data } = await api.get('/products', {
        params: { search: debouncedBundleSearch, status: 'IN_STOCK', limit: '10' },
      });
      const all: Product[] = data.data ?? [];
      return all.filter(p => !excludeIds.includes(p.id));
    },
    enabled: !!debouncedBundleSearch && debouncedBundleSearch.length >= 2,
  });

  // Customer search query
  const { data: customers, isFetching: customersFetching, isError: customersError } = useQuery<Customer[]>({
    queryKey: ['pos-customers', debouncedCustomerSearch],
    queryFn: async () => {
      if (!debouncedCustomerSearch || debouncedCustomerSearch.length < 2) return [];
      const { data } = await api.get('/customers/search', { params: { q: debouncedCustomerSearch } });
      return data;
    },
    enabled: !!debouncedCustomerSearch && debouncedCustomerSearch.length >= 2,
  });

  // POS config (interest rate, down payment %, months range)
  const { data: posConfig } = useQuery<PosConfig>({
    queryKey: ['pos-config'],
    queryFn: async () => {
      const { data } = await api.get('/sales/config');
      return data;
    },
    staleTime: 5 * 60 * 1000, // cache 5 minutes
  });

  // Top selling products for quick picks
  const { data: topProducts = [] } = useQuery<TopProduct[]>({
    queryKey: ['top-products'],
    queryFn: async () => {
      const { data } = await api.get('/sales/top-products');
      return data;
    },
    staleTime: 10 * 60 * 1000,
  });

  // Calculations
  const netAmount = useMemo(() => {
    const price = parseFloat(sellingPrice) || 0;
    const disc = parseFloat(discount) || 0;
    return price - disc;
  }, [sellingPrice, discount]);

  const changeAmount = useMemo(() => {
    const received = parseFloat(amountReceived) || 0;
    return received - netAmount;
  }, [amountReceived, netAmount]);

  // Amount after deducting down payment (for INSTALLMENT and EXTERNAL_FINANCE)
  const transferAmount = useMemo(() => {
    const down = parseFloat(downPayment) || 0;
    return netAmount - down;
  }, [netAmount, downPayment]);

  // Select product handler
  const handleSelectProduct = (product: Product) => {
    setSelectedProduct(product);
    setProductSearch('');
    // Auto-fill price from default price in the system
    const defaultPrice = product.prices.find(p => p.isDefault);
    if (defaultPrice) {
      setSelectedPriceId(defaultPrice.id);
      saleForm.setValue('sellingPrice', parseFloat(defaultPrice.amount), { shouldValidate: true });
    } else if (product.prices.length > 0) {
      setSelectedPriceId(product.prices[0].id);
      saleForm.setValue('sellingPrice', parseFloat(product.prices[0].amount), { shouldValidate: true });
    } else {
      setSelectedPriceId('');
      saleForm.setValue('sellingPrice', 0);
    }
  };

  // Handle price selection from product prices
  const handlePriceSelect = (priceId: string) => {
    const price = selectedProduct?.prices.find(p => p.id === priceId);
    if (price) {
      setSelectedPriceId(priceId);
      saleForm.setValue('sellingPrice', parseFloat(price.amount), { shouldValidate: true });
    }
  };

  // Add bundle product
  const handleAddBundle = (product: Product) => {
    setBundleProducts(prev => [...prev, product]);
    setBundleSearch('');
  };

  // Remove bundle product
  const handleRemoveBundle = (productId: string) => {
    setBundleProducts(prev => prev.filter(p => p.id !== productId));
  };

  // Create sale mutation
  const createSaleMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProduct) throw new Error('กรุณาเลือกสินค้า');
      if (!selectedCustomer) throw new Error('กรุณาเลือกลูกค้า');

      // Validate the form before submitting
      const valid = await saleForm.trigger();
      if (!valid) throw new Error('กรุณาตรวจสอบข้อมูลในฟอร์ม');

      const formValues = saleForm.getValues();

      const payload: Record<string, unknown> = {
        saleType,
        customerId: selectedCustomer.id,
        productId: selectedProduct.id,
        branchId: selectedProduct.branchId,
        sellingPrice: formValues.sellingPrice,
        discount: formValues.discount ?? 0,
        notes: formValues.notes || undefined,
        bundleProductIds: bundleProducts.map(p => p.id),
      };

      if (saleType === 'CASH') {
        payload.paymentMethod = formValues.paymentMethod;
        payload.amountReceived = formValues.amountReceived ?? netAmount;
      } else if (saleType === 'INSTALLMENT') {
        const down = formValues.downPayment ?? 0;
        const minDownPct = posConfig?.minDownPaymentPct ?? 0.15;
        const minDown = netAmount * minDownPct;
        if (down < minDown) {
          throw new Error(`เงินดาวน์ขั้นต่ำ ${(minDownPct * 100).toFixed(0)}% = ${minDown.toLocaleString()} บาท`);
        }
        payload.planType = planType;
        payload.downPayment = down;
        payload.totalMonths = parseInt(formValues.totalMonths ?? '6');
        payload.paymentMethod = formValues.paymentMethod;
        payload.contractNumber = formValues.contractNumber || undefined;
      } else if (saleType === 'EXTERNAL_FINANCE') {
        const down = formValues.downPayment ?? 0;
        payload.financeCompany = (formValues.financeCompany ?? '').trim();
        payload.contractNumber = formValues.contractNumber || undefined;
        payload.downPayment = down;
        payload.financeAmount = netAmount - down;
        payload.paymentMethod = formValues.paymentMethod;
      }

      const { data } = await api.post('/sales', payload);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['pos-products'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      const typeLabel = saleTypeConfig[saleType].label;
      toast.success(`ขาย${typeLabel}สำเร็จ - ${data.saleNumber}`);
      resetForm();
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err));
    },
  });

  const resetForm = () => {
    setSaleType('CASH');
    setSelectedProduct(null);
    setSelectedCustomer(null);
    setBundleProducts([]);
    setSelectedPriceId('');
    setProductSearch('');
    setCustomerSearch('');
    setBundleSearch('');
    saleForm.reset({
      saleType: 'CASH',
      sellingPrice: 0,
      discount: 0,
      paymentMethod: 'CASH',
      amountReceived: undefined,
      downPayment: 0,
      financeCompany: '',
      contractNumber: '',
      totalMonths: '6',
      notes: '',
    });
  };

  const inputClass = 'w-full px-3 py-2 border border-input rounded-lg text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background';
  const selectClass = inputClass;

  return (
    <div>
      <PageHeader title="POS - ขายสินค้า" subtitle="ระบบขายหน้าร้าน" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 lg:gap-7.5">
        {/* Left Column - Main Form */}
        <div className="lg:col-span-2 flex flex-col gap-5">

          {/* Sale Type Selector — Metronic segmented control style */}
          <Card className="border-border/60 shadow-sm">
            <CardHeader>
              <div className="text-sm font-semibold text-foreground">ประเภทการขาย</div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                {posSaleTypes.map(([type, config]) => (
                  <button
                    key={type}
                    onClick={() => { setSaleType(type); saleForm.setValue('saleType', type as 'CASH' | 'EXTERNAL_FINANCE'); }}
                    className={`p-4 rounded-xl border-2 text-center transition-all ${
                      saleType === type
                        ? `${config.bg} border-transparent ring-2 ring-offset-1 shadow-sm`
                        : 'border-border/60 hover:border-border hover:shadow-sm hover:-translate-y-0.5'
                    }`}
                  >
                    <div className={`text-sm font-semibold ${saleType === type ? config.color : 'text-muted-foreground'}`}>
                      {config.label}
                    </div>
                  </button>
                ))}
              </div>
              <div className="mt-4 p-3 rounded-xl bg-primary/5 border border-primary/10 text-center">
                <button onClick={() => navigate('/contracts/create')} className="text-xs text-primary font-semibold hover:underline flex items-center gap-1 justify-center">
                  ต้องการผ่อนกับ BESTCHOICE?
                  <svg className="size-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" /></svg>
                  ไปสร้างสัญญาผ่อนชำระ
                </button>
              </div>
            </CardContent>
          </Card>

          {/* Quick Picks - Top Selling Products — Metronic product card grid */}
          {!selectedProduct && topProducts.length > 0 && (
            <Card className="border-border/60 shadow-sm">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <svg className="size-4 text-amber-500" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
                  <div className="text-sm font-semibold text-foreground">สินค้าขายดี</div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {topProducts.slice(0, 6).map((tp) => (
                    <button
                      key={tp.id}
                      onClick={() => { setProductSearch(tp.brand + ' ' + tp.model); }}
                      className="p-3.5 rounded-xl border border-border/60 hover:border-primary/40 hover:bg-primary/5 hover:shadow-sm hover:-translate-y-0.5 text-left transition-all group"
                    >
                      <div className="size-8 rounded-lg bg-muted mb-2 flex items-center justify-center text-muted-foreground text-xs font-bold group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                        {tp.brand.charAt(0)}
                      </div>
                      <div className="text-xs font-semibold text-foreground truncate group-hover:text-primary transition-colors">{tp.brand} {tp.model}</div>
                      <div className="text-2xs text-muted-foreground mt-0.5">ขายแล้ว {tp.count} เครื่อง</div>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Product Selection */}
          <Card className="border-border/60 shadow-sm">
            <CardHeader>
              <div className="text-sm font-semibold text-foreground">สินค้าหลัก</div>
            </CardHeader>
            <CardContent>
              {selectedProduct ? (
                <div className="flex items-center justify-between bg-muted rounded-lg p-3">
                  <div>
                    <div className="text-sm font-medium">{selectedProduct.brand} {selectedProduct.model}</div>
                    <div className="text-xs text-muted-foreground">
                      {selectedProduct.imeiSerial && <span className="font-mono">IMEI: {selectedProduct.imeiSerial}</span>}
                      {selectedProduct.branch && <span className="ml-2">| {selectedProduct.branch.name}</span>}
                    </div>
                    {selectedProduct.prices.length > 0 && (
                      <div className="flex gap-2 mt-1">
                        {selectedProduct.prices.map(p => (
                          <span key={p.id} className={`text-xs px-2 py-0.5 rounded ${p.isDefault ? 'bg-primary/10 text-primary' : 'bg-secondary text-muted-foreground'}`}>
                            {p.label}: {parseFloat(p.amount).toLocaleString()}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button onClick={() => setSelectedProduct(null)} className="text-xs text-red-500 hover:underline">เปลี่ยน</button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    type="text"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="พิมพ์อย่างน้อย 2 ตัวอักษร เช่น IMEI, ชื่อ, รุ่น..."
                    className={inputClass}
                  />
                  {productSearch.length >= 2 && (
                    <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-xl shadow-xl max-h-60 overflow-y-auto">
                      {productsError ? (
                        <div className="px-3 py-4 text-center text-sm text-destructive">
                          ค้นหาสินค้าไม่สำเร็จ กรุณาลองใหม่
                        </div>
                      ) : productsFetching ? (
                        <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary mx-auto mb-2"></div>
                          กำลังค้นหา...
                        </div>
                      ) : products && products.length > 0 ? (
                        products.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => handleSelectProduct(p)}
                            className="w-full text-left px-3 py-2 hover:bg-muted/50 border-b last:border-b-0"
                          >
                            <div className="text-sm font-medium">{p.brand} {p.model}</div>
                            <div className="text-xs text-muted-foreground">
                              {p.imeiSerial && <span className="font-mono">IMEI: {p.imeiSerial}</span>}
                              <span className="ml-2">{p.branch?.name}</span>
                              {p.prices.find(pr => pr.isDefault) && (
                                <span className="ml-2 text-primary font-medium">
                                  {parseFloat(p.prices.find(pr => pr.isDefault)!.amount).toLocaleString()} ฿
                                </span>
                              )}
                            </div>
                          </button>
                        ))
                      ) : (
                        <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                          ไม่พบสินค้าที่ตรงกับ &quot;{productSearch}&quot;
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Bundle / Freebie Products */}
          <Card className="border-border/60 shadow-sm">
            <CardHeader>
              <div className="flex items-center justify-between w-full">
                <div className="text-sm font-semibold text-foreground">ของแถม / อุปกรณ์เสริม</div>
                <span className="text-xs text-muted-foreground">ตัดสต๊อกให้ลูกค้า (ราคา 0 บาท)</span>
              </div>
            </CardHeader>
            <CardContent>
              {/* Selected bundle products */}
              {bundleProducts.length > 0 && (
                <div className="space-y-2 mb-3">
                  {bundleProducts.map((p) => (
                    <div key={p.id} className="flex items-center justify-between bg-success/5 dark:bg-success/10 rounded-xl px-3 py-2.5 border border-success/20">
                      <div>
                        <div className="text-sm font-medium text-success">{p.brand} {p.model}</div>
                        <div className="text-xs text-success/70">
                          {p.imeiSerial && <span className="font-mono">IMEI: {p.imeiSerial}</span>}
                          {p.category === 'ACCESSORY' && <span className="ml-1">({p.name})</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-success font-medium">ของแถม</span>
                        <button onClick={() => handleRemoveBundle(p.id)} className="text-xs text-destructive hover:underline">ลบ</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Bundle search */}
              <div className="relative">
                <input
                  type="text"
                  value={bundleSearch}
                  onChange={(e) => setBundleSearch(e.target.value)}
                  placeholder="ค้นหาของแถม เช่น ฟิล์ม, เคส, ชุดชาร์จ..."
                  className={inputClass}
                />
                {bundleSearch.length >= 2 && (
                  <div className="absolute z-40 w-full mt-1 bg-popover border border-border rounded-xl shadow-xl max-h-48 overflow-y-auto">
                    {bundleSearchFetching ? (
                      <div className="px-3 py-3 text-center text-sm text-muted-foreground">กำลังค้นหา...</div>
                    ) : bundleSearchResults && bundleSearchResults.length > 0 ? (
                      bundleSearchResults.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => handleAddBundle(p)}
                          className="w-full text-left px-3 py-2 hover:bg-success/5 dark:hover:bg-success/10 border-b last:border-b-0"
                        >
                          <div className="text-sm font-medium">{p.brand} {p.model}</div>
                          <div className="text-xs text-muted-foreground">
                            {p.name}
                            {p.imeiSerial && <span className="ml-2 font-mono">IMEI: {p.imeiSerial}</span>}
                            <span className="ml-2">ทุน: {parseFloat(p.costPrice).toLocaleString()} ฿</span>
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-3 text-center text-sm text-muted-foreground">
                        ไม่พบสินค้า &quot;{bundleSearch}&quot;
                      </div>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Customer Selection */}
          <Card className="border-border/60 shadow-sm">
            <CardHeader>
              <div className="text-sm font-semibold text-foreground">เลือกลูกค้า</div>
            </CardHeader>
            <CardContent>
            {selectedCustomer ? (
              <div className="flex items-center justify-between bg-muted rounded-lg p-3">
                <div>
                  <div className="text-sm font-medium">{selectedCustomer.name}</div>
                  <div className="text-xs text-muted-foreground">{selectedCustomer.phone} | สัญญา {selectedCustomer._count.contracts} รายการ</div>
                </div>
                <button onClick={() => setSelectedCustomer(null)} className="text-xs text-red-500 hover:underline">เปลี่ยน</button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  placeholder="พิมพ์อย่างน้อย 2 ตัวอักษร เช่น ชื่อ, เบอร์โทร, เลขบัตร..."
                  className={inputClass}
                />
                {customerSearch.length >= 2 && (
                  <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-xl shadow-xl max-h-60 overflow-y-auto">
                    {customersError ? (
                      <div className="px-3 py-4 text-center text-sm text-destructive">
                        ค้นหาลูกค้าไม่สำเร็จ กรุณาลองใหม่
                      </div>
                    ) : customersFetching ? (
                      <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary mx-auto mb-2"></div>
                        กำลังค้นหา...
                      </div>
                    ) : customers && customers.length > 0 ? (
                      customers.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => { setSelectedCustomer(c); setCustomerSearch(''); }}
                          className="w-full text-left px-3 py-2 hover:bg-muted/50 border-b last:border-b-0"
                        >
                          <div className="text-sm font-medium">{c.name}</div>
                          <div className="text-xs text-muted-foreground">{c.phone}</div>
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                        ไม่พบลูกค้าที่ตรงกับ &quot;{customerSearch}&quot;
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            </CardContent>
          </Card>

          {/* Sale Details */}
          <Card className="border-border/60 shadow-sm">
            <CardHeader>
              <div className="text-sm font-semibold text-foreground">รายละเอียดการขาย</div>
            </CardHeader>
            <CardContent>
            <Form {...saleForm}>

            {/* Price picker from product system */}
            {selectedProduct && selectedProduct.prices.length > 0 && (
              <div className="mb-3">
                <label className="block text-xs text-muted-foreground mb-2">เลือกราคาขาย (จากระบบ) *</label>
                <div className="flex flex-wrap gap-2">
                  {selectedProduct.prices.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handlePriceSelect(p.id)}
                      className={`px-3 py-2 rounded-lg border-2 text-sm transition-all ${
                        selectedPriceId === p.id
                          ? 'border-primary bg-primary/10 text-primary ring-2 ring-primary/20'
                          : 'border-border text-foreground hover:border-input'
                      }`}
                    >
                      <div className="font-semibold">{parseFloat(p.amount).toLocaleString()} ฿</div>
                      <div className="text-xs text-muted-foreground">{p.label}{p.isDefault ? ' (ค่าเริ่มต้น)' : ''}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={saleForm.control as any}
                name="sellingPrice"
                render={({ field }) => (
                  <FormItem>
                    <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                      ราคาขาย *
                      <span className="ml-1 text-primary">(จากระบบ)</span>
                    </label>
                    <FormControl>
                      <input
                        type="number"
                        {...field}
                        value={field.value || 0}
                        className={`${inputClass} bg-muted`}
                        placeholder="0"
                        readOnly
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={saleForm.control as any}
                name="discount"
                render={({ field }) => (
                  <FormItem>
                    <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ส่วนลด</label>
                    <FormControl>
                      <input
                        type="number"
                        {...field}
                        value={field.value ?? 0}
                        onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                        className={inputClass}
                        placeholder="0"
                      />
                    </FormControl>
                    {parseFloat(sellingPrice) > 0 && (
                      <div className="flex gap-1 mt-1">
                        {[0, 5, 10].map(pct => (
                          <button
                            key={pct}
                            type="button"
                            onClick={() => saleForm.setValue('discount', pct === 0 ? 0 : Math.round(parseFloat(sellingPrice) * pct / 100), { shouldValidate: true })}
                            className={`px-2 py-0.5 text-[10px] rounded border ${parseFloat(discount) === Math.round(parseFloat(sellingPrice) * pct / 100) && pct > 0 ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-input'}`}
                          >
                            {pct}%
                          </button>
                        ))}
                      </div>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Conditional fields by sale type */}
            {saleType === 'CASH' && (
              <div className="grid grid-cols-2 gap-3 mt-3">
                <FormField
                  control={saleForm.control as any}
                  name="paymentMethod"
                  render={({ field }) => (
                    <FormItem>
                      <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">วิธีชำระเงิน</label>
                      <FormControl>
                        <select {...field} className={selectClass}>
                          {paymentMethods.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={saleForm.control as any}
                  name="amountReceived"
                  render={({ field }) => (
                    <FormItem>
                      <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">เงินที่รับ</label>
                      <FormControl>
                        <input
                          type="number"
                          {...field}
                          value={field.value ?? ''}
                          onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                          className={inputClass}
                          placeholder={String(netAmount)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            {saleType === 'EXTERNAL_FINANCE' && (
              <div className="space-y-3 mt-3">
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={saleForm.control as any}
                    name="financeCompany"
                    render={({ field }) => (
                      <FormItem>
                        <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">บริษัทไฟแนนซ์ *</label>
                        <FormControl>
                          <input
                            type="text"
                            {...field}
                            value={field.value ?? ''}
                            className={inputClass}
                            placeholder="ชื่อบริษัทไฟแนนซ์"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={saleForm.control as any}
                    name="contractNumber"
                    render={({ field }) => (
                      <FormItem>
                        <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">เลขที่สัญญา</label>
                        <FormControl>
                          <input
                            type="text"
                            {...field}
                            value={field.value ?? ''}
                            className={inputClass}
                            placeholder="เลขที่สัญญาไฟแนนซ์"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={saleForm.control as any}
                    name="downPayment"
                    render={({ field }) => (
                      <FormItem>
                        <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">เงินดาวน์</label>
                        <FormControl>
                          <input
                            type="number"
                            {...field}
                            value={field.value ?? 0}
                            onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                            className={inputClass}
                            placeholder="0"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={saleForm.control as any}
                    name="paymentMethod"
                    render={({ field }) => (
                      <FormItem>
                        <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">รับเงินดาวน์โดย</label>
                        <FormControl>
                          <select {...field} className={selectClass}>
                            {paymentMethods.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                          </select>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                {/* Finance transfer amount highlight */}
                {transferAmount > 0 && (
                  <div className="bg-primary/10 border border-primary/20 rounded-lg p-3">
                    <div className="text-xs text-primary">ยอดที่ไฟแนนซ์ต้องโอนให้ร้าน (หลังหักดาวน์)</div>
                    <div className="text-lg font-bold text-primary">{transferAmount.toLocaleString()} ฿</div>
                  </div>
                )}
              </div>
            )}

            {/* Notes */}
            <FormField
              control={saleForm.control as any}
              name="notes"
              render={({ field }) => (
                <FormItem className="mt-3">
                  <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">หมายเหตุ</label>
                  <FormControl>
                    <input
                      type="text"
                      {...field}
                      value={field.value ?? ''}
                      className={inputClass}
                      placeholder="หมายเหตุเพิ่มเติม (ถ้ามี)"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            </Form>
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Summary (sticky) */}
        <div className="flex flex-col gap-5">
          <Card className="sticky top-20 border-border/60 shadow-md overflow-hidden">
            {/* Card accent header */}
            <div className="h-1.5 w-full bg-gradient-to-r from-primary to-primary/60" />
            <CardHeader>
              <div className="flex items-center justify-between w-full">
                <div className="text-sm font-semibold text-foreground">สรุปรายการ</div>
                <div className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${saleTypeConfig[saleType].bg} ${saleTypeConfig[saleType].color}`}>
                  {saleTypeConfig[saleType].label}
                </div>
              </div>
            </CardHeader>
            <CardContent>

            {/* Product info */}
            {selectedProduct ? (
              <div className="mb-4 p-3.5 rounded-xl bg-muted/50 border border-border/50">
                <div className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">สินค้าหลัก</div>
                <div className="text-sm font-semibold text-foreground">{selectedProduct.brand} {selectedProduct.model}</div>
                {selectedProduct.imeiSerial && (
                  <div className="flex items-center gap-1 mt-1">
                    <span className="text-2xs text-muted-foreground font-mono">{selectedProduct.imeiSerial}</span>
                    <button
                      onClick={() => { copy(selectedProduct.imeiSerial!); toast.success('คัดลอกแล้ว'); }}
                      className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      aria-label="คัดลอก IMEI"
                    >
                      <Copy className="size-3" />
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="mb-4 p-3.5 rounded-xl bg-muted/30 border border-dashed border-border/60 text-center">
                <div className="text-xs text-muted-foreground">ยังไม่ได้เลือกสินค้า</div>
              </div>
            )}

            {/* Bundle products info */}
            {bundleProducts.length > 0 && (
              <div className="mb-3 p-3 rounded-xl bg-success/5 border border-success/20">
                <div className="text-2xs font-semibold text-success uppercase tracking-wider mb-1.5">ของแถม ({bundleProducts.length} รายการ)</div>
                {bundleProducts.map((p) => (
                  <div key={p.id} className="text-xs text-success flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full bg-success inline-block shrink-0" />
                    <span>{p.brand} {p.model}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Customer info */}
            {selectedCustomer ? (
              <div className="mb-4 p-3.5 rounded-xl bg-muted/50 border border-border/50">
                <div className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">ลูกค้า</div>
                <div className="text-sm font-semibold text-foreground">{selectedCustomer.name}</div>
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="text-xs text-muted-foreground">{selectedCustomer.phone}</span>
                  <button
                    onClick={() => { copy(selectedCustomer.phone); toast.success('คัดลอกแล้ว'); }}
                    className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="คัดลอกเบอร์โทร"
                  >
                    <Copy className="size-3" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="mb-4 p-3.5 rounded-xl bg-muted/30 border border-dashed border-border/60 text-center">
                <div className="text-xs text-muted-foreground">ยังไม่ได้เลือกลูกค้า</div>
              </div>
            )}

            {/* Price breakdown — clean divider list */}
            <div className="space-y-2 pt-3 border-t border-border/50">
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">ราคาขาย</span>
                <span className="font-medium tabular-nums">{(parseFloat(sellingPrice) || 0).toLocaleString()} ฿</span>
              </div>
              {parseFloat(discount) > 0 && (
                <div className="flex justify-between items-center text-sm text-destructive">
                  <span>ส่วนลด</span>
                  <span className="tabular-nums">-{parseFloat(discount).toLocaleString()} ฿</span>
                </div>
              )}
              <div className="flex justify-between items-center pt-2 border-t border-border/50">
                <span className="text-sm font-semibold text-foreground">ยอดสุทธิ</span>
                <span className="text-lg font-bold text-primary tabular-nums">{netAmount.toLocaleString()} ฿</span>
              </div>
            </div>

            {/* Cash change */}
            {saleType === 'CASH' && parseFloat(amountReceived) > 0 && (
              <div className="space-y-2 mt-3 pt-3 border-t border-border/50">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">เงินรับ</span>
                  <span className="tabular-nums">{parseFloat(amountReceived).toLocaleString()} ฿</span>
                </div>
                <div className={`flex justify-between items-center text-sm font-bold ${changeAmount >= 0 ? 'text-success' : 'text-destructive'}`}>
                  <span>เงินทอน</span>
                  <span className="text-base tabular-nums">{changeAmount.toLocaleString()} ฿</span>
                </div>
              </div>
            )}

            {/* External finance summary */}
            {saleType === 'EXTERNAL_FINANCE' && (
              <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">สรุปไฟแนนซ์</div>
                {financeCompany && (
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground">บริษัท</span>
                    <span className="font-semibold text-foreground">{financeCompany}</span>
                  </div>
                )}
                {contractNumber && (
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground">เลขที่สัญญา</span>
                    <span className="font-mono font-medium text-foreground">{contractNumber}</span>
                  </div>
                )}
                {parseFloat(downPayment) > 0 && (
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">เงินดาวน์</span>
                    <span className="tabular-nums">{parseFloat(downPayment).toLocaleString()} ฿</span>
                  </div>
                )}
                <div className="flex justify-between items-center pt-2 border-t border-border/50">
                  <span className="text-sm font-semibold text-foreground">ยอดที่ไฟแนนซ์ต้องโอน</span>
                  <span className="text-base font-bold text-primary tabular-nums">{transferAmount.toLocaleString()} ฿</span>
                </div>
              </div>
            )}

            {/* Submit Buttons */}
            <div className="mt-6 space-y-2">
              <button
                onClick={() => createSaleMutation.mutate()}
                disabled={!selectedProduct || !selectedCustomer || !sellingPrice || createSaleMutation.isPending}
                className="w-full py-3 bg-primary text-primary-foreground rounded-xl text-sm font-semibold disabled:opacity-50 hover:bg-primary/90 transition-all hover:shadow-lg shadow-sm active:scale-[0.98]"
              >
                {createSaleMutation.isPending ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                    กำลังบันทึก...
                  </span>
                ) : 'บันทึกการขาย'}
              </button>
              <button
                onClick={resetForm}
                className="w-full py-2.5 text-sm text-muted-foreground hover:text-foreground rounded-xl hover:bg-muted/80 transition-colors"
              >
                ล้างข้อมูล
              </button>
            </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
