import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api, { getErrorMessage } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import PageHeader from '@/components/ui/PageHeader';

type SaleType = 'CASH' | 'INSTALLMENT' | 'EXTERNAL_FINANCE';

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

const saleTypeConfig: Record<SaleType, { label: string; color: string; bg: string }> = {
  CASH: { label: 'เงินสด', color: 'text-green-700', bg: 'bg-green-50 border-green-300 ring-green-500' },
  INSTALLMENT: { label: 'ผ่อนร้าน', color: 'text-blue-700', bg: 'bg-blue-50 border-blue-300 ring-blue-500' },
  EXTERNAL_FINANCE: { label: 'ผ่อนไฟแนนซ์', color: 'text-purple-700', bg: 'bg-purple-50 border-purple-300 ring-purple-500' },
};

const planTypes = [
  { value: 'STORE_DIRECT', label: 'ผ่อนกับร้าน' },
  { value: 'CREDIT_CARD', label: 'ผ่อนบัตรเครดิต' },
  { value: 'STORE_WITH_INTEREST', label: 'ผ่อนกับร้าน+ดอกเบี้ย' },
];

const paymentMethods = [
  { value: 'CASH', label: 'เงินสด' },
  { value: 'BANK_TRANSFER', label: 'โอนเงิน' },
  { value: 'QR_EWALLET', label: 'QR / E-Wallet' },
];

export default function POSPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Sale type
  const [saleType, setSaleType] = useState<SaleType>('CASH');

  // Product search
  const [productSearch, setProductSearch] = useState('');
  const debouncedProductSearch = useDebounce(productSearch);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Customer search
  const [customerSearch, setCustomerSearch] = useState('');
  const debouncedCustomerSearch = useDebounce(customerSearch);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  // Sale details
  const [sellingPrice, setSellingPrice] = useState('');
  const [discount, setDiscount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [amountReceived, setAmountReceived] = useState('');
  const [notes, setNotes] = useState('');

  // Installment fields
  const [planType, setPlanType] = useState('STORE_DIRECT');
  const [downPayment, setDownPayment] = useState('');
  const [totalMonths, setTotalMonths] = useState('6');

  // External finance fields
  const [financeCompany, setFinanceCompany] = useState('');
  const [financeRefNumber, setFinanceRefNumber] = useState('');
  const [financeAmount, setFinanceAmount] = useState('');

  // Product search query
  const { data: products } = useQuery<Product[]>({
    queryKey: ['pos-products', debouncedProductSearch],
    queryFn: async () => {
      if (!debouncedProductSearch || debouncedProductSearch.length < 2) return [];
      const { data } = await api.get('/products', {
        params: { search: debouncedProductSearch, status: 'IN_STOCK', limit: '10' },
      });
      return data.data || data;
    },
    enabled: !!debouncedProductSearch && debouncedProductSearch.length >= 2,
  });

  // Customer search query
  const { data: customers } = useQuery<Customer[]>({
    queryKey: ['pos-customers', debouncedCustomerSearch],
    queryFn: async () => {
      if (!debouncedCustomerSearch || debouncedCustomerSearch.length < 2) return [];
      const { data } = await api.get('/customers/search', { params: { q: debouncedCustomerSearch } });
      return data;
    },
    enabled: !!debouncedCustomerSearch && debouncedCustomerSearch.length >= 2,
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

  const installmentCalc = useMemo(() => {
    if (saleType !== 'INSTALLMENT') return null;
    const down = parseFloat(downPayment) || 0;
    const months = parseInt(totalMonths) || 6;
    const principal = netAmount - down;
    if (principal <= 0) return null;
    const rate = 0.08;
    const interestTotal = principal * rate * months;
    const financedAmount = principal + interestTotal;
    const monthly = Math.ceil(financedAmount / months);
    return { principal, interestTotal, financedAmount, monthly, rate };
  }, [saleType, netAmount, downPayment, totalMonths]);

  // Select product handler
  const handleSelectProduct = (product: Product) => {
    setSelectedProduct(product);
    setProductSearch('');
    // Auto-fill price from default price
    const defaultPrice = product.prices.find(p => p.isDefault);
    if (defaultPrice) {
      setSellingPrice(String(parseFloat(defaultPrice.amount)));
    }
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
      };

      if (saleType === 'CASH') {
        payload.paymentMethod = paymentMethod;
        payload.amountReceived = parseFloat(amountReceived) || netAmount;
      } else if (saleType === 'INSTALLMENT') {
        payload.planType = planType;
        payload.downPayment = parseFloat(downPayment) || 0;
        payload.totalMonths = parseInt(totalMonths);
        payload.paymentMethod = paymentMethod;
      } else if (saleType === 'EXTERNAL_FINANCE') {
        payload.financeCompany = financeCompany;
        payload.financeRefNumber = financeRefNumber || undefined;
        payload.financeAmount = parseFloat(financeAmount) || undefined;
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
      navigate(`/pos`);
      resetForm();
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err));
    },
  });

  const resetForm = () => {
    setSelectedProduct(null);
    setSelectedCustomer(null);
    setSellingPrice('');
    setDiscount('');
    setPaymentMethod('CASH');
    setAmountReceived('');
    setNotes('');
    setDownPayment('');
    setTotalMonths('6');
    setFinanceCompany('');
    setFinanceRefNumber('');
    setFinanceAmount('');
    setProductSearch('');
    setCustomerSearch('');
  };

  const inputClass = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';
  const selectClass = `${inputClass} bg-white`;

  return (
    <div>
      <PageHeader title="POS - ขายสินค้า" subtitle="ระบบขายหน้าร้าน" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Main Form */}
        <div className="lg:col-span-2 space-y-4">

          {/* Sale Type Selector */}
          <div className="bg-white rounded-lg border p-4">
            <div className="text-sm font-semibold text-gray-800 mb-3">ประเภทการขาย</div>
            <div className="grid grid-cols-3 gap-3">
              {(Object.entries(saleTypeConfig) as [SaleType, typeof saleTypeConfig[SaleType]][]).map(([type, config]) => (
                <button
                  key={type}
                  onClick={() => setSaleType(type)}
                  className={`p-3 rounded-lg border-2 text-center transition-all ${
                    saleType === type
                      ? `${config.bg} ring-2`
                      : 'bg-white border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className={`text-sm font-semibold ${saleType === type ? config.color : 'text-gray-600'}`}>
                    {config.label}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Product Selection */}
          <div className="bg-white rounded-lg border p-4">
            <div className="text-sm font-semibold text-gray-800 mb-3">เลือกสินค้า</div>
            {selectedProduct ? (
              <div className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
                <div>
                  <div className="text-sm font-medium">{selectedProduct.brand} {selectedProduct.model}</div>
                  <div className="text-xs text-gray-500">
                    {selectedProduct.imeiSerial && <span className="font-mono">IMEI: {selectedProduct.imeiSerial}</span>}
                    {selectedProduct.branch && <span className="ml-2">| {selectedProduct.branch.name}</span>}
                  </div>
                  {selectedProduct.prices.length > 0 && (
                    <div className="flex gap-2 mt-1">
                      {selectedProduct.prices.map(p => (
                        <span key={p.id} className={`text-xs px-2 py-0.5 rounded ${p.isDefault ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-600'}`}>
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
                  placeholder="ค้นหา IMEI, ชื่อ, รุ่น..."
                  className={inputClass}
                />
                {products && products.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {products.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => handleSelectProduct(p)}
                        className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b last:border-b-0"
                      >
                        <div className="text-sm font-medium">{p.brand} {p.model}</div>
                        <div className="text-xs text-gray-500">
                          {p.imeiSerial && <span className="font-mono">IMEI: {p.imeiSerial}</span>}
                          <span className="ml-2">{p.branch?.name}</span>
                          {p.prices.find(pr => pr.isDefault) && (
                            <span className="ml-2 text-primary-600 font-medium">
                              {parseFloat(p.prices.find(pr => pr.isDefault)!.amount).toLocaleString()} ฿
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Customer Selection */}
          <div className="bg-white rounded-lg border p-4">
            <div className="text-sm font-semibold text-gray-800 mb-3">เลือกลูกค้า</div>
            {selectedCustomer ? (
              <div className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
                <div>
                  <div className="text-sm font-medium">{selectedCustomer.name}</div>
                  <div className="text-xs text-gray-500">{selectedCustomer.phone} | สัญญา {selectedCustomer._count.contracts} รายการ</div>
                </div>
                <button onClick={() => setSelectedCustomer(null)} className="text-xs text-red-500 hover:underline">เปลี่ยน</button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  placeholder="ค้นหาชื่อ, เบอร์โทร, เลขบัตร..."
                  className={inputClass}
                />
                {customers && customers.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {customers.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => { setSelectedCustomer(c); setCustomerSearch(''); }}
                        className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b last:border-b-0"
                      >
                        <div className="text-sm font-medium">{c.name}</div>
                        <div className="text-xs text-gray-500">{c.phone}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sale Details */}
          <div className="bg-white rounded-lg border p-4">
            <div className="text-sm font-semibold text-gray-800 mb-3">รายละเอียดการขาย</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">ราคาขาย *</label>
                <input type="number" value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} className={inputClass} placeholder="0" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">ส่วนลด</label>
                <input type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} className={inputClass} placeholder="0" />
              </div>
            </div>

            {/* Conditional fields by sale type */}
            {saleType === 'CASH' && (
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">วิธีชำระเงิน</label>
                  <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={selectClass}>
                    {paymentMethods.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">เงินที่รับ</label>
                  <input type="number" value={amountReceived} onChange={(e) => setAmountReceived(e.target.value)} className={inputClass} placeholder={String(netAmount)} />
                </div>
              </div>
            )}

            {saleType === 'INSTALLMENT' && (
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">แผนผ่อนชำระ</label>
                  <select value={planType} onChange={(e) => setPlanType(e.target.value)} className={selectClass}>
                    {planTypes.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">เงินดาวน์ *</label>
                  <input type="number" value={downPayment} onChange={(e) => setDownPayment(e.target.value)} className={inputClass} placeholder="0" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">จำนวนงวด</label>
                  <select value={totalMonths} onChange={(e) => setTotalMonths(e.target.value)} className={selectClass}>
                    {[6, 7, 8, 9, 10, 11, 12].map(m => <option key={m} value={m}>{m} เดือน</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">รับเงินดาวน์โดย</label>
                  <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={selectClass}>
                    {paymentMethods.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
              </div>
            )}

            {saleType === 'EXTERNAL_FINANCE' && (
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">บริษัทไฟแนนซ์ *</label>
                  <input type="text" value={financeCompany} onChange={(e) => setFinanceCompany(e.target.value)} className={inputClass} placeholder="ชื่อบริษัทไฟแนนซ์" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">เลขอ้างอิง</label>
                  <input type="text" value={financeRefNumber} onChange={(e) => setFinanceRefNumber(e.target.value)} className={inputClass} placeholder="เลขที่สัญญาไฟแนนซ์" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">ยอดที่ไฟแนนซ์จ่ายให้ร้าน</label>
                  <input type="number" value={financeAmount} onChange={(e) => setFinanceAmount(e.target.value)} className={inputClass} placeholder="0" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">วิธีรับเงิน</label>
                  <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={selectClass}>
                    {paymentMethods.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
              </div>
            )}

            {/* Notes */}
            <div className="mt-3">
              <label className="block text-xs text-gray-500 mb-1">หมายเหตุ</label>
              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} placeholder="หมายเหตุเพิ่มเติม (ถ้ามี)" />
            </div>
          </div>
        </div>

        {/* Right Column - Summary */}
        <div className="space-y-4">
          <div className="bg-white rounded-lg border p-4 sticky top-4">
            <div className="text-sm font-semibold text-gray-800 mb-4">สรุปรายการ</div>

            {/* Sale type badge */}
            <div className={`inline-block px-3 py-1 rounded-full text-xs font-medium mb-4 ${saleTypeConfig[saleType].bg} ${saleTypeConfig[saleType].color}`}>
              {saleTypeConfig[saleType].label}
            </div>

            {/* Product info */}
            {selectedProduct && (
              <div className="mb-4">
                <div className="text-xs text-gray-500">สินค้า</div>
                <div className="text-sm font-medium">{selectedProduct.brand} {selectedProduct.model}</div>
                {selectedProduct.imeiSerial && <div className="text-xs text-gray-400 font-mono">{selectedProduct.imeiSerial}</div>}
              </div>
            )}

            {/* Customer info */}
            {selectedCustomer && (
              <div className="mb-4">
                <div className="text-xs text-gray-500">ลูกค้า</div>
                <div className="text-sm font-medium">{selectedCustomer.name}</div>
                <div className="text-xs text-gray-400">{selectedCustomer.phone}</div>
              </div>
            )}

            {/* Price breakdown */}
            <div className="border-t pt-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">ราคาขาย</span>
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
                <span className="text-primary-600">{netAmount.toLocaleString()} ฿</span>
              </div>
            </div>

            {/* Installment calculation */}
            {saleType === 'INSTALLMENT' && installmentCalc && (
              <div className="border-t mt-3 pt-3 space-y-2">
                <div className="text-xs font-semibold text-gray-600 mb-1">คำนวณผ่อนชำระ</div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">เงินดาวน์</span>
                  <span>{(parseFloat(downPayment) || 0).toLocaleString()} ฿</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">เงินต้นคงเหลือ</span>
                  <span>{installmentCalc.principal.toLocaleString()} ฿</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">ดอกเบี้ยรวม ({(installmentCalc.rate * 100).toFixed(0)}%)</span>
                  <span>{installmentCalc.interestTotal.toLocaleString()} ฿</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">ยอดผ่อนรวม</span>
                  <span>{installmentCalc.financedAmount.toLocaleString()} ฿</span>
                </div>
                <div className="flex justify-between text-sm font-bold text-blue-600 border-t pt-1">
                  <span>ค่างวด/เดือน</span>
                  <span>{installmentCalc.monthly.toLocaleString()} ฿ x {totalMonths} งวด</span>
                </div>
              </div>
            )}

            {/* Cash change */}
            {saleType === 'CASH' && parseFloat(amountReceived) > 0 && (
              <div className="border-t mt-3 pt-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">เงินรับ</span>
                  <span>{parseFloat(amountReceived).toLocaleString()} ฿</span>
                </div>
                <div className={`flex justify-between text-sm font-bold ${changeAmount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  <span>เงินทอน</span>
                  <span>{changeAmount.toLocaleString()} ฿</span>
                </div>
              </div>
            )}

            {/* External finance info */}
            {saleType === 'EXTERNAL_FINANCE' && financeCompany && (
              <div className="border-t mt-3 pt-3 space-y-1">
                <div className="text-xs text-gray-500">ไฟแนนซ์: <span className="text-gray-800 font-medium">{financeCompany}</span></div>
                {financeRefNumber && <div className="text-xs text-gray-500">เลขอ้างอิง: <span className="text-gray-800">{financeRefNumber}</span></div>}
                {financeAmount && <div className="text-xs text-gray-500">ยอดรับจากไฟแนนซ์: <span className="text-gray-800 font-medium">{parseFloat(financeAmount).toLocaleString()} ฿</span></div>}
              </div>
            )}

            {/* Submit */}
            <div className="mt-6 space-y-2">
              <button
                onClick={() => createSaleMutation.mutate()}
                disabled={!selectedProduct || !selectedCustomer || !sellingPrice || createSaleMutation.isPending}
                className="w-full py-3 bg-primary-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50 hover:bg-primary-700 transition-colors"
              >
                {createSaleMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกการขาย'}
              </button>
              <button
                onClick={resetForm}
                className="w-full py-2 text-sm text-gray-500 hover:text-gray-700"
              >
                ล้างข้อมูล
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
