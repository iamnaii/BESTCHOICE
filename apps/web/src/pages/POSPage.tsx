import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { saleTypeConfig, paymentMethods, type SaleType } from '@/lib/constants';

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
  useAuth(); // ensure user is authenticated
  const queryClient = useQueryClient();

  // Sale type
  const [saleType, setSaleType] = useState<SaleType>('CASH');

  // Product search
  const [productSearch, setProductSearch] = useState('');
  const debouncedProductSearch = useDebounce(productSearch);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Bundle (freebie) products
  const [bundleSearch, setBundleSearch] = useState('');
  const debouncedBundleSearch = useDebounce(bundleSearch);
  const [bundleProducts, setBundleProducts] = useState<Product[]>([]);

  // Customer search
  const [customerSearch, setCustomerSearch] = useState('');
  const debouncedCustomerSearch = useDebounce(customerSearch);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  // Sale details
  const [selectedPriceId, setSelectedPriceId] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [discount, setDiscount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [amountReceived, setAmountReceived] = useState('');
  const [notes, setNotes] = useState('');

  // Common fields for INSTALLMENT and EXTERNAL_FINANCE
  const [downPayment, setDownPayment] = useState('');
  const [contractNumber, setContractNumber] = useState('');

  // Installment fields
  const planType = 'STORE_DIRECT';
  const [totalMonths, setTotalMonths] = useState('6');

  // External finance fields
  const [financeCompany, setFinanceCompany] = useState('');

  // Product search query
  const { data: products, isFetching: productsFetching } = useQuery<Product[]>({
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
  const { data: customers, isFetching: customersFetching } = useQuery<Customer[]>({
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
      setSellingPrice(String(parseFloat(defaultPrice.amount)));
    } else if (product.prices.length > 0) {
      setSelectedPriceId(product.prices[0].id);
      setSellingPrice(String(parseFloat(product.prices[0].amount)));
    } else {
      setSelectedPriceId('');
      setSellingPrice('');
    }
  };

  // Handle price selection from product prices
  const handlePriceSelect = (priceId: string) => {
    const price = selectedProduct?.prices.find(p => p.id === priceId);
    if (price) {
      setSelectedPriceId(priceId);
      setSellingPrice(String(parseFloat(price.amount)));
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
      if (!sellingPrice || parseFloat(sellingPrice) <= 0) throw new Error('กรุณาใส่ราคาขาย');

      const payload: Record<string, unknown> = {
        saleType,
        customerId: selectedCustomer.id,
        productId: selectedProduct.id,
        branchId: selectedProduct.branchId,
        sellingPrice: parseFloat(sellingPrice),
        discount: parseFloat(discount) || 0,
        notes: notes || undefined,
        bundleProductIds: bundleProducts.map(p => p.id),
      };

      if (saleType === 'CASH') {
        payload.paymentMethod = paymentMethod;
        payload.amountReceived = parseFloat(amountReceived) || netAmount;
      } else if (saleType === 'INSTALLMENT') {
        const down = parseFloat(downPayment) || 0;
        const minDownPct = posConfig?.minDownPaymentPct ?? 0.15;
        const minDown = netAmount * minDownPct;
        if (down < minDown) {
          throw new Error(`เงินดาวน์ขั้นต่ำ ${(minDownPct * 100).toFixed(0)}% = ${minDown.toLocaleString()} บาท`);
        }
        payload.planType = planType;
        payload.downPayment = down;
        payload.totalMonths = parseInt(totalMonths);
        payload.paymentMethod = paymentMethod;
        payload.contractNumber = contractNumber || undefined;
      } else if (saleType === 'EXTERNAL_FINANCE') {
        if (!financeCompany?.trim()) throw new Error('กรุณาใส่ชื่อบริษัทไฟแนนซ์');
        const down = parseFloat(downPayment) || 0;
        payload.financeCompany = financeCompany.trim();
        payload.contractNumber = contractNumber || undefined;
        payload.downPayment = down;
        payload.financeAmount = netAmount - down;
        payload.paymentMethod = paymentMethod;
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
    setSellingPrice('');
    setDiscount('');
    setPaymentMethod('CASH');
    setAmountReceived('');
    setNotes('');
    setDownPayment('');
    setContractNumber('');
    setTotalMonths('6');
    setFinanceCompany('');
    setProductSearch('');
    setCustomerSearch('');
    setBundleSearch('');
  };

  const inputClass = 'w-full px-3 py-2 border border-input rounded-lg text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background';
  const selectClass = inputClass;

  return (
    <div>
      <PageHeader title="POS - ขายสินค้า" subtitle="ระบบขายหน้าร้าน" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 lg:gap-7.5">
        {/* Left Column - Main Form */}
        <div className="lg:col-span-2 flex flex-col gap-5 lg:gap-7.5">

          {/* Sale Type Selector */}
          <Card>
            <CardHeader>
              <div className="text-sm font-semibold text-foreground">ประเภทการขาย</div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-3">
                {(Object.entries(saleTypeConfig) as [SaleType, typeof saleTypeConfig[SaleType]][]).map(([type, config]) => (
                  <button
                    key={type}
                    onClick={() => setSaleType(type)}
                    className={`p-3 rounded-lg border-2 text-center transition-all ${
                      saleType === type
                        ? `${config.bg} ring-2`
                        : 'border-border hover:border-input'
                    }`}
                  >
                    <div className={`text-sm font-semibold ${saleType === type ? config.color : 'text-muted-foreground'}`}>
                      {config.label}
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Product Selection */}
          <Card>
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
                    <div className="absolute z-50 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                      {productsFetching ? (
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
          <Card>
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
                    <div key={p.id} className="flex items-center justify-between bg-green-50 rounded-lg px-3 py-2 border border-green-200">
                      <div>
                        <div className="text-sm font-medium text-green-800">{p.brand} {p.model}</div>
                        <div className="text-xs text-green-600">
                          {p.imeiSerial && <span className="font-mono">IMEI: {p.imeiSerial}</span>}
                          {p.category === 'ACCESSORY' && <span className="ml-1">({p.name})</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-green-600 font-medium">ของแถม</span>
                        <button onClick={() => handleRemoveBundle(p.id)} className="text-xs text-red-500 hover:underline">ลบ</button>
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
                  <div className="absolute z-40 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {bundleSearchFetching ? (
                      <div className="px-3 py-3 text-center text-sm text-muted-foreground">กำลังค้นหา...</div>
                    ) : bundleSearchResults && bundleSearchResults.length > 0 ? (
                      bundleSearchResults.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => handleAddBundle(p)}
                          className="w-full text-left px-3 py-2 hover:bg-green-50 border-b last:border-b-0"
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
          <Card>
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
                  <div className="absolute z-50 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {customersFetching ? (
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
          <Card>
            <CardHeader>
              <div className="text-sm font-semibold text-foreground">รายละเอียดการขาย</div>
            </CardHeader>
            <CardContent>

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
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  ราคาขาย *
                  <span className="ml-1 text-primary">(จากระบบ)</span>
                </label>
                <input
                  type="number"
                  value={sellingPrice}
                  className={`${inputClass} bg-muted`}
                  placeholder="0"
                  readOnly
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">ส่วนลด</label>
                <input type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} className={inputClass} placeholder="0" />
              </div>
            </div>

            {/* Conditional fields by sale type */}
            {saleType === 'CASH' && (
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">วิธีชำระเงิน</label>
                  <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={selectClass}>
                    {paymentMethods.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">เงินที่รับ</label>
                  <input type="number" value={amountReceived} onChange={(e) => setAmountReceived(e.target.value)} className={inputClass} placeholder={String(netAmount)} />
                </div>
              </div>
            )}

            {saleType === 'INSTALLMENT' && (
              <div className="space-y-3 mt-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">เลขที่สัญญา</label>
                    <input type="text" value={contractNumber} onChange={(e) => setContractNumber(e.target.value)} className={inputClass} placeholder="ระบบจะสร้างให้อัตโนมัติ" />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">จำนวนงวด</label>
                    <select value={totalMonths} onChange={(e) => setTotalMonths(e.target.value)} className={selectClass}>
                      {Array.from(
                        { length: (posConfig?.maxInstallmentMonths ?? 12) - (posConfig?.minInstallmentMonths ?? 6) + 1 },
                        (_, i) => (posConfig?.minInstallmentMonths ?? 6) + i,
                      ).map(m => <option key={m} value={m}>{m} เดือน</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">เงินดาวน์</label>
                    <input type="number" value={downPayment} onChange={(e) => setDownPayment(e.target.value)} className={inputClass} placeholder="0" />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">รับเงินดาวน์โดย</label>
                    <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={selectClass}>
                      {paymentMethods.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </div>
                </div>
                {/* Transfer amount highlight */}
                {transferAmount > 0 && (
                  <div className="bg-primary/10 border border-primary/20 rounded-lg p-3">
                    <div className="text-xs text-primary">ยอดที่ BESTCHOICE รับผิดชอบ (หลังหักดาวน์)</div>
                    <div className="text-lg font-bold text-primary">{transferAmount.toLocaleString()} ฿</div>
                  </div>
                )}
              </div>
            )}

            {saleType === 'EXTERNAL_FINANCE' && (
              <div className="space-y-3 mt-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">บริษัทไฟแนนซ์ *</label>
                    <input type="text" value={financeCompany} onChange={(e) => setFinanceCompany(e.target.value)} className={inputClass} placeholder="ชื่อบริษัทไฟแนนซ์" />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">เลขที่สัญญา</label>
                    <input type="text" value={contractNumber} onChange={(e) => setContractNumber(e.target.value)} className={inputClass} placeholder="เลขที่สัญญาไฟแนนซ์" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">เงินดาวน์</label>
                    <input type="number" value={downPayment} onChange={(e) => setDownPayment(e.target.value)} className={inputClass} placeholder="0" />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">รับเงินดาวน์โดย</label>
                    <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={selectClass}>
                      {paymentMethods.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </div>
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
            <div className="mt-3">
              <label className="block text-xs text-muted-foreground mb-1">หมายเหตุ</label>
              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} placeholder="หมายเหตุเพิ่มเติม (ถ้ามี)" />
            </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Summary */}
        <div className="flex flex-col gap-5 lg:gap-7.5">
          <Card className="sticky top-4">
            <CardHeader>
              <div className="text-sm font-semibold text-foreground">สรุปรายการ</div>
            </CardHeader>
            <CardContent>

            {/* Sale type badge */}
            <div className={`inline-block px-3 py-1 rounded-full text-xs font-medium mb-4 ${saleTypeConfig[saleType].bg} ${saleTypeConfig[saleType].color}`}>
              {saleTypeConfig[saleType].label}
            </div>

            {/* Product info */}
            {selectedProduct && (
              <div className="mb-3">
                <div className="text-xs text-muted-foreground">สินค้าหลัก</div>
                <div className="text-sm font-medium">{selectedProduct.brand} {selectedProduct.model}</div>
                {selectedProduct.imeiSerial && <div className="text-xs text-muted-foreground font-mono">{selectedProduct.imeiSerial}</div>}
              </div>
            )}

            {/* Bundle products info */}
            {bundleProducts.length > 0 && (
              <div className="mb-3">
                <div className="text-xs text-muted-foreground mb-1">ของแถม ({bundleProducts.length} รายการ)</div>
                {bundleProducts.map((p) => (
                  <div key={p.id} className="text-xs text-green-700 flex items-center gap-1">
                    <span>+</span>
                    <span>{p.brand} {p.model}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Customer info */}
            {selectedCustomer && (
              <div className="mb-4">
                <div className="text-xs text-muted-foreground">ลูกค้า</div>
                <div className="text-sm font-medium">{selectedCustomer.name}</div>
                <div className="text-xs text-muted-foreground">{selectedCustomer.phone}</div>
              </div>
            )}

            {/* Price breakdown */}
            <div className="border-t pt-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">ราคาขาย</span>
                <span>{(parseFloat(sellingPrice) || 0).toLocaleString()} ฿</span>
              </div>
              {parseFloat(discount) > 0 && (
                <div className="flex justify-between text-sm text-red-500">
                  <span>ส่วนลด</span>
                  <span>-{parseFloat(discount).toLocaleString()} ฿</span>
                </div>
              )}
              <div className="flex justify-between text-base font-bold border-t pt-2">
                <span>ยอดสุทธิ</span>
                <span className="text-primary">{netAmount.toLocaleString()} ฿</span>
              </div>
            </div>

            {/* Installment summary */}
            {saleType === 'INSTALLMENT' && (
              <div className="border-t mt-3 pt-3 space-y-2">
                <div className="text-xs font-semibold text-muted-foreground mb-1">สรุปผ่อนชำระ</div>
                {contractNumber && <div className="text-xs text-muted-foreground">เลขที่สัญญา: <span className="text-foreground font-mono">{contractNumber}</span></div>}
                {totalMonths && <div className="text-xs text-muted-foreground">จำนวนงวด: <span className="text-foreground font-medium">{totalMonths} เดือน</span></div>}
                {parseFloat(downPayment) > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">เงินดาวน์</span>
                    <span>{parseFloat(downPayment).toLocaleString()} ฿</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold text-primary">
                  <span>ยอดที่ BESTCHOICE รับ</span>
                  <span>{transferAmount.toLocaleString()} ฿</span>
                </div>
              </div>
            )}

            {/* Cash change */}
            {saleType === 'CASH' && parseFloat(amountReceived) > 0 && (
              <div className="border-t mt-3 pt-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">เงินรับ</span>
                  <span>{parseFloat(amountReceived).toLocaleString()} ฿</span>
                </div>
                <div className={`flex justify-between text-sm font-bold ${changeAmount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  <span>เงินทอน</span>
                  <span>{changeAmount.toLocaleString()} ฿</span>
                </div>
              </div>
            )}

            {/* External finance summary */}
            {saleType === 'EXTERNAL_FINANCE' && (
              <div className="border-t mt-3 pt-3 space-y-2">
                <div className="text-xs font-semibold text-muted-foreground mb-1">สรุปไฟแนนซ์</div>
                {financeCompany && <div className="text-xs text-muted-foreground">บริษัท: <span className="text-foreground font-medium">{financeCompany}</span></div>}
                {contractNumber && <div className="text-xs text-muted-foreground">เลขที่สัญญา: <span className="text-foreground font-mono">{contractNumber}</span></div>}
                {parseFloat(downPayment) > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">เงินดาวน์</span>
                    <span>{parseFloat(downPayment).toLocaleString()} ฿</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold text-primary">
                  <span>ยอดที่ไฟแนนซ์ต้องโอน</span>
                  <span>{transferAmount.toLocaleString()} ฿</span>
                </div>
              </div>
            )}

            {/* Submit */}
            <div className="mt-6 space-y-2">
              <button
                onClick={() => createSaleMutation.mutate()}
                disabled={!selectedProduct || !selectedCustomer || !sellingPrice || createSaleMutation.isPending}
                className="w-full py-3 bg-primary text-primary-foreground rounded-lg text-sm font-semibold disabled:opacity-50 hover:bg-primary/90 transition-colors"
              >
                {createSaleMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกการขาย'}
              </button>
              <button
                onClick={resetForm}
                className="w-full py-2 text-sm text-muted-foreground hover:text-foreground"
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
