import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import toast from 'react-hot-toast';

interface Product {
  id: string;
  name: string;
  brand: string;
  model: string;
  category: string;
  status: string;
  branchId: string;
  branch: { id: string; name: string };
  prices: { id: string; planType: string; price: string; isDefault: boolean }[];
}

interface Customer {
  id: string;
  name: string;
  phone: string;
  nationalId: string;
}

interface Branch {
  id: string;
  name: string;
}

const STEPS = ['เลือกสินค้า', 'เลือกลูกค้า', 'เลือกแผนผ่อน', 'ยืนยัน'];

export default function ContractCreatePage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  // Form state
  const [productSearch, setProductSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [planType, setPlanType] = useState('STORE_DIRECT');
  const [downPayment, setDownPayment] = useState(0);
  const [totalMonths, setTotalMonths] = useState(6);
  const [notes, setNotes] = useState('');

  // Queries
  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ['products-available', productSearch],
    queryFn: async () => {
      const params = new URLSearchParams({ status: 'IN_STOCK' });
      if (productSearch) params.set('search', productSearch);
      const { data } = await api.get(`/products?${params}&limit=999`);
      return data.data || [];
    },
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ['customers-search', customerSearch],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (customerSearch) params.set('search', customerSearch);
      const { data } = await api.get(`/customers?${params}`);
      return data.data || [];
    },
    enabled: step >= 1,
  });

  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: async () => { const { data } = await api.get('/branches'); return data; },
  });

  // Fetch system config for interest rate instead of hardcoding
  const { data: posConfig } = useQuery<{ interestRate: number; minDownPaymentPct: number; minInstallmentMonths: number; maxInstallmentMonths: number }>({
    queryKey: ['pos-config'],
    queryFn: async () => { const { data } = await api.get('/sales/config'); return data; },
  });

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const { data } = await api.post('/contracts', body);
      return data;
    },
    onSuccess: (data) => {
      toast.success('สร้างสัญญาสำเร็จ');
      navigate(`/contracts/${data.id}`);
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'เกิดข้อผิดพลาด');
    },
  });

  // Calculate installment
  const getSellingPrice = () => {
    if (!selectedProduct) return 0;
    const price = selectedProduct.prices.find((p) => p.planType === planType) || selectedProduct.prices.find((p) => p.isDefault);
    return price ? parseFloat(price.price) : 0;
  };

  const sellingPrice = getSellingPrice();
  const interestRate = posConfig?.interestRate ?? 0.08;
  const minDownPct = posConfig?.minDownPaymentPct ?? 0.15;
  const interestTotal = (sellingPrice - downPayment) * interestRate * totalMonths;
  const financedAmount = (sellingPrice - downPayment) + interestTotal;
  const monthlyPayment = totalMonths > 0 ? Math.ceil(financedAmount / totalMonths) : 0;

  const handleSubmit = () => {
    if (!selectedProduct || !selectedCustomer) return;
    createMutation.mutate({
      customerId: selectedCustomer.id,
      productId: selectedProduct.id,
      branchId: selectedProduct.branchId,
      planType,
      sellingPrice,
      downPayment,
      totalMonths,
      notes: notes || undefined,
    });
  };

  const canNext = () => {
    if (step === 0) return !!selectedProduct;
    if (step === 1) return !!selectedCustomer;
    if (step === 2) return downPayment >= sellingPrice * minDownPct && totalMonths >= (posConfig?.minInstallmentMonths ?? 6);
    return true;
  };

  return (
    <div>
      <PageHeader
        title="สร้างสัญญาผ่อนชำระ"
        subtitle={STEPS[step]}
        action={
          <button onClick={() => navigate('/contracts')} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg">
            ยกเลิก
          </button>
        }
      />

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${i <= step ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
              {i + 1}
            </div>
            <span className={`text-sm ${i <= step ? 'text-primary-700 font-medium' : 'text-gray-400'}`}>{s}</span>
            {i < STEPS.length - 1 && <div className={`w-8 h-0.5 ${i < step ? 'bg-primary-600' : 'bg-gray-200'}`} />}
          </div>
        ))}
      </div>

      {/* Step 1: Select Product */}
      {step === 0 && (
        <div>
          <input
            type="text"
            placeholder="ค้นหาสินค้า (ชื่อ, ยี่ห้อ, รุ่น, IMEI)..."
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-4"
          />
          <div className="grid gap-3">
            {products.map((p) => (
              <div
                key={p.id}
                onClick={() => setSelectedProduct(p)}
                className={`p-4 rounded-lg border cursor-pointer transition-colors ${selectedProduct?.id === p.id ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300'}`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-medium text-sm">{p.brand} {p.model}</div>
                    <div className="text-xs text-gray-500 mt-1">{p.name}</div>
                    <div className="text-xs text-gray-400 mt-1">สาขา: {p.branch?.name}</div>
                  </div>
                  <div className="text-right">
                    {p.prices.map((pr) => (
                      <div key={pr.id} className="text-xs">
                        <span className="text-gray-500">{pr.planType}: </span>
                        <span className="font-medium">{parseFloat(pr.price).toLocaleString()} ฿</span>
                        {pr.isDefault && <span className="ml-1 text-primary-600">(หลัก)</span>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
            {products.length === 0 && (
              <div className="text-center py-8 text-gray-400 text-sm">ไม่พบสินค้าที่พร้อมขาย</div>
            )}
          </div>
        </div>
      )}

      {/* Step 2: Select Customer */}
      {step === 1 && (
        <div>
          <input
            type="text"
            placeholder="ค้นหาลูกค้า (ชื่อ, เบอร์โทร, เลขบัตร)..."
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-4"
          />
          <div className="grid gap-3">
            {customers.map((c) => (
              <div
                key={c.id}
                onClick={() => setSelectedCustomer(c)}
                className={`p-4 rounded-lg border cursor-pointer transition-colors ${selectedCustomer?.id === c.id ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300'}`}
              >
                <div className="flex justify-between items-center">
                  <div>
                    <div className="font-medium text-sm">{c.name}</div>
                    <div className="text-xs text-gray-500 mt-1">{c.phone}</div>
                  </div>
                  <div className="text-xs text-gray-400 font-mono">
                    {c.nationalId.replace(/(\d{1})(\d{4})(\d{5})(\d{2})(\d{1})/, '$1-$2-$3-$4-$5')}
                  </div>
                </div>
              </div>
            ))}
            {customers.length === 0 && (
              <div className="text-center py-8 text-gray-400 text-sm">ไม่พบลูกค้า</div>
            )}
          </div>
        </div>
      )}

      {/* Step 3: Plan Details */}
      {step === 2 && (
        <div className="max-w-xl">
          <div className="bg-white rounded-lg border p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ประเภทแผน</label>
              <select value={planType} onChange={(e) => setPlanType(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="STORE_DIRECT">ผ่อนกับร้าน (STORE_DIRECT)</option>
                <option value="CREDIT_CARD">ผ่อนบัตรเครดิต (CREDIT_CARD)</option>
                <option value="STORE_WITH_INTEREST">ผ่อนกับร้าน+ดอกเบี้ย (STORE_WITH_INTEREST)</option>
              </select>
            </div>

            <div className="bg-gray-50 rounded-lg p-4">
              <div className="text-sm font-medium text-gray-700 mb-2">สินค้า: {selectedProduct?.brand} {selectedProduct?.model}</div>
              <div className="text-lg font-bold text-primary-700">{sellingPrice.toLocaleString()} ฿</div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">เงินดาวน์</label>
              <input
                type="number"
                value={downPayment}
                onChange={(e) => setDownPayment(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                min={0}
              />
              <div className="text-xs text-gray-400 mt-1">ขั้นต่ำ {(minDownPct * 100).toFixed(0)}% = {(sellingPrice * minDownPct).toLocaleString()} ฿</div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">จำนวนงวด (เดือน)</label>
              <select value={totalMonths} onChange={(e) => setTotalMonths(Number(e.target.value))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                {[6, 7, 8, 9, 10, 11, 12].map((m) => (
                  <option key={m} value={m}>{m} เดือน</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุ</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>

            {/* Calculation Summary */}
            <div className="bg-primary-50 rounded-lg p-4 space-y-2">
              <h3 className="text-sm font-semibold text-primary-800">สรุปการคำนวณ</h3>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">ราคาขาย</span>
                <span>{sellingPrice.toLocaleString()} ฿</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">เงินดาวน์</span>
                <span>-{downPayment.toLocaleString()} ฿</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">ดอกเบี้ยรวม ({(interestRate * 100).toFixed(0)}% × {totalMonths} เดือน)</span>
                <span>{interestTotal.toLocaleString()} ฿</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">ยอดผ่อนรวม</span>
                <span>{financedAmount.toLocaleString()} ฿</span>
              </div>
              <div className="border-t pt-2 flex justify-between text-base font-bold text-primary-700">
                <span>ค่างวด/เดือน</span>
                <span>{monthlyPayment.toLocaleString()} ฿</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Confirm */}
      {step === 3 && (
        <div className="max-w-xl">
          <div className="bg-white rounded-lg border p-6 space-y-4">
            <h3 className="text-lg font-semibold">ยืนยันสัญญาผ่อนชำระ</h3>

            <div className="space-y-3">
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="text-xs text-gray-500">สินค้า</div>
                <div className="font-medium">{selectedProduct?.brand} {selectedProduct?.model}</div>
                <div className="text-sm text-gray-500">{selectedProduct?.name}</div>
              </div>

              <div className="bg-gray-50 rounded-lg p-4">
                <div className="text-xs text-gray-500">ลูกค้า</div>
                <div className="font-medium">{selectedCustomer?.name}</div>
                <div className="text-sm text-gray-500">{selectedCustomer?.phone}</div>
              </div>

              <div className="bg-gray-50 rounded-lg p-4 grid grid-cols-2 gap-3">
                <div><div className="text-xs text-gray-500">ประเภท</div><div className="text-sm font-medium">{planType}</div></div>
                <div><div className="text-xs text-gray-500">ราคาขาย</div><div className="text-sm font-medium">{sellingPrice.toLocaleString()} ฿</div></div>
                <div><div className="text-xs text-gray-500">เงินดาวน์</div><div className="text-sm font-medium">{downPayment.toLocaleString()} ฿</div></div>
                <div><div className="text-xs text-gray-500">จำนวนงวด</div><div className="text-sm font-medium">{totalMonths} เดือน</div></div>
                <div><div className="text-xs text-gray-500">ดอกเบี้ยรวม</div><div className="text-sm font-medium">{interestTotal.toLocaleString()} ฿</div></div>
                <div><div className="text-xs text-gray-500">ค่างวด/เดือน</div><div className="text-lg font-bold text-primary-700">{monthlyPayment.toLocaleString()} ฿</div></div>
              </div>

              {notes && (
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="text-xs text-gray-500">หมายเหตุ</div>
                  <div className="text-sm">{notes}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Navigation buttons */}
      <div className="flex justify-between mt-6">
        <button
          onClick={() => step > 0 && setStep(step - 1)}
          className={`px-6 py-2 text-sm rounded-lg border ${step === 0 ? 'invisible' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
        >
          ย้อนกลับ
        </button>
        {step < 3 ? (
          <button
            onClick={() => canNext() && setStep(step + 1)}
            disabled={!canNext()}
            className="px-6 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ถัดไป
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={createMutation.isPending}
            className="px-6 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            {createMutation.isPending ? 'กำลังสร้าง...' : 'สร้างสัญญา'}
          </button>
        )}
      </div>
    </div>
  );
}
