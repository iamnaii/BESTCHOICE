import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';

interface Contract {
  id: string;
  contractNumber: string;
  status: string;
  customer: { id: string; name: string };
  product: { id: string; name: string; brand: string; model: string };
}

interface Product {
  id: string;
  name: string;
  brand: string;
  model: string;
  status: string;
  prices: Array<{ id: string; label: string; amount: string }>;
}

interface ExchangeQuote {
  oldContract: {
    id: string;
    contractNumber: string;
    customer: { id: string; name: string };
    product: { id: string; name: string; brand: string; model: string };
    remainingPrincipal: number;
    totalLateFees: number;
    outstandingBalance: number;
  };
  newProduct: {
    id: string;
    name: string;
    brand: string;
    model: string;
    selectedPrice: { label: string; amount: number };
  };
  summary: {
    outstandingBalance: number;
    newProductPrice: number;
    difference: number;
  };
}

export default function ExchangePage() {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<'select' | 'quote' | 'confirm' | 'done'>('select');
  const [selectedContractId, setSelectedContractId] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedPriceId, setSelectedPriceId] = useState('');
  const [downPayment, setDownPayment] = useState('');
  const [totalMonths, setTotalMonths] = useState('10');
  const [notes, setNotes] = useState('');
  const [quote, setQuote] = useState<ExchangeQuote | null>(null);
  const [exchangeResult, setExchangeResult] = useState<{
    oldContract: { contractNumber: string; status: string };
    newContract: { contractNumber: string; monthlyPayment: number; totalMonths: number; financedAmount: number };
  } | null>(null);

  // Fetch eligible contracts (ACTIVE or OVERDUE)
  const { data: contracts = [] } = useQuery<Contract[]>({
    queryKey: ['exchange-contracts'],
    queryFn: async () => {
      const [active, overdue] = await Promise.all([
        api.get('/contracts?status=ACTIVE'),
        api.get('/contracts?status=OVERDUE'),
      ]);
      return [...(active.data.data || []), ...(overdue.data.data || [])];
    },
  });

  // Fetch available products (IN_STOCK)
  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ['exchange-products'],
    queryFn: async () => (await api.get('/products?status=IN_STOCK&limit=999')).data.data || [],
  });

  const selectedProduct = products.find((p) => p.id === selectedProductId);

  // Get quote
  const quoteMutation = useMutation({
    mutationFn: async () => {
      const params = new URLSearchParams({
        oldContractId: selectedContractId,
        newProductId: selectedProductId,
        newPriceId: selectedPriceId,
      });
      return (await api.get(`/exchange/quote?${params}`)).data;
    },
    onSuccess: (data: ExchangeQuote) => {
      setQuote(data);
      setStep('quote');
    },
    onError: (err: { response?: { data?: { message?: string } } }) =>
      toast.error(err.response?.data?.message || 'ไม่สามารถคำนวณได้'),
  });

  // Execute exchange
  const exchangeMutation = useMutation({
    mutationFn: async () =>
      (await api.post('/exchange', {
        oldContractId: selectedContractId,
        newProductId: selectedProductId,
        newPriceId: selectedPriceId,
        newDownPayment: Number(downPayment),
        newTotalMonths: Number(totalMonths),
        notes: notes || undefined,
      })).data,
    onSuccess: (data) => {
      setExchangeResult(data);
      setStep('done');
      queryClient.invalidateQueries({ queryKey: ['exchange-contracts'] });
      queryClient.invalidateQueries({ queryKey: ['exchange-products'] });
      toast.success('เปลี่ยนเครื่องสำเร็จ');
    },
    onError: (err: { response?: { data?: { message?: string } } }) =>
      toast.error(err.response?.data?.message || 'เกิดข้อผิดพลาด'),
  });

  const handleGetQuote = () => {
    if (!selectedContractId || !selectedProductId || !selectedPriceId) {
      toast.error('กรุณาเลือกข้อมูลให้ครบ');
      return;
    }
    quoteMutation.mutate();
  };

  const handleConfirm = () => {
    if (!downPayment || Number(downPayment) <= 0) {
      toast.error('กรุณาระบุเงินดาวน์');
      return;
    }
    if (quote) {
      const minDown = quote.summary.newProductPrice * 0.15;
      if (Number(downPayment) < minDown) {
        toast.error(`เงินดาวน์ขั้นต่ำ 15% = ${minDown.toLocaleString()} บาท`);
        return;
      }
    }
    setStep('confirm');
  };

  const handleExecute = () => {
    exchangeMutation.mutate();
  };

  const resetForm = () => {
    setStep('select');
    setSelectedContractId('');
    setSelectedProductId('');
    setSelectedPriceId('');
    setDownPayment('');
    setTotalMonths('10');
    setNotes('');
    setQuote(null);
    setExchangeResult(null);
  };

  return (
    <div>
      <PageHeader title="เปลี่ยนเครื่อง" subtitle="เปลี่ยนเครื่องจากสัญญาเดิมเป็นเครื่องใหม่" />

      {/* Step Indicator */}
      <div className="flex items-center gap-2 mb-6">
        {['เลือกข้อมูล', 'ใบเสนอราคา', 'ยืนยัน', 'เสร็จสิ้น'].map((label, idx) => {
          const stepIdx = ['select', 'quote', 'confirm', 'done'].indexOf(step);
          const isActive = idx <= stepIdx;
          return (
            <div key={label} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${isActive ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
                {idx + 1}
              </div>
              <span className={`text-sm ${isActive ? 'text-primary-700 font-medium' : 'text-gray-400'}`}>{label}</span>
              {idx < 3 && <div className={`w-8 h-0.5 ${isActive ? 'bg-primary-300' : 'bg-gray-200'}`} />}
            </div>
          );
        })}
      </div>

      {/* Step 1: Select */}
      {step === 'select' && (
        <div className="bg-white rounded-lg border p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">เลือกสัญญาเดิม (ACTIVE/OVERDUE) *</label>
            <select
              value={selectedContractId}
              onChange={(e) => setSelectedContractId(e.target.value)}
              className="w-full max-w-lg px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
            >
              <option value="">-- เลือกสัญญา --</option>
              {contracts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.contractNumber} - {c.customer.name} ({c.product.brand} {c.product.model}) [{c.status}]
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">เลือกสินค้าใหม่ (IN_STOCK) *</label>
            <select
              value={selectedProductId}
              onChange={(e) => { setSelectedProductId(e.target.value); setSelectedPriceId(''); }}
              className="w-full max-w-lg px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
            >
              <option value="">-- เลือกสินค้า --</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.brand} {p.model} - {p.name}
                </option>
              ))}
            </select>
          </div>

          {selectedProduct && selectedProduct.prices.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">เลือกราคา *</label>
              <select
                value={selectedPriceId}
                onChange={(e) => setSelectedPriceId(e.target.value)}
                className="w-full max-w-lg px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
              >
                <option value="">-- เลือกราคา --</option>
                {selectedProduct.prices.map((pr) => (
                  <option key={pr.id} value={pr.id}>
                    {pr.label} - {Number(pr.amount).toLocaleString()} บาท
                  </option>
                ))}
              </select>
            </div>
          )}

          {selectedProduct && selectedProduct.prices.length === 0 && (
            <div className="text-sm text-yellow-600 bg-yellow-50 p-3 rounded-lg">
              สินค้านี้ยังไม่มีราคา กรุณาเพิ่มราคาก่อน
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={handleGetQuote}
              disabled={!selectedContractId || !selectedProductId || !selectedPriceId || quoteMutation.isPending}
              className="px-6 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              {quoteMutation.isPending ? 'กำลังคำนวณ...' : 'คำนวณใบเสนอราคา'}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Quote */}
      {step === 'quote' && quote && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg border p-6">
            <h3 className="text-lg font-medium mb-4">ใบเสนอราคาเปลี่ยนเครื่อง</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              {/* Old Contract */}
              <div className="bg-red-50 rounded-lg p-4">
                <div className="text-sm font-medium text-red-700 mb-2">สัญญาเดิม</div>
                <div className="text-sm space-y-1">
                  <div><strong>สัญญา:</strong> {quote.oldContract.contractNumber}</div>
                  <div><strong>ลูกค้า:</strong> {quote.oldContract.customer.name}</div>
                  <div><strong>สินค้า:</strong> {quote.oldContract.product.brand} {quote.oldContract.product.model}</div>
                  <div><strong>ยอมคงเหลือ:</strong> <span className="text-red-600 font-medium">{quote.oldContract.remainingPrincipal.toLocaleString()} บาท</span></div>
                  <div><strong>ค่าปรับ:</strong> {quote.oldContract.totalLateFees.toLocaleString()} บาท</div>
                  <div><strong>ยอดค้างชำระรวม:</strong> <span className="text-red-700 font-bold">{quote.oldContract.outstandingBalance.toLocaleString()} บาท</span></div>
                </div>
              </div>

              {/* New Product */}
              <div className="bg-green-50 rounded-lg p-4">
                <div className="text-sm font-medium text-green-700 mb-2">สินค้าใหม่</div>
                <div className="text-sm space-y-1">
                  <div><strong>สินค้า:</strong> {quote.newProduct.brand} {quote.newProduct.model}</div>
                  <div><strong>แผนราคา:</strong> {quote.newProduct.selectedPrice.label}</div>
                  <div><strong>ราคา:</strong> <span className="text-green-700 font-bold">{quote.newProduct.selectedPrice.amount.toLocaleString()} บาท</span></div>
                </div>
              </div>
            </div>

            {/* Summary */}
            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <div className="text-sm font-medium text-gray-700 mb-2">สรุป</div>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-xs text-gray-500">ยอดค้างเดิม</div>
                  <div className="text-lg font-bold text-red-600">{quote.summary.outstandingBalance.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">ราคาเครื่องใหม่</div>
                  <div className="text-lg font-bold text-green-600">{quote.summary.newProductPrice.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">ส่วนต่าง</div>
                  <div className={`text-lg font-bold ${quote.summary.difference >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>
                    {quote.summary.difference.toLocaleString()}
                  </div>
                </div>
              </div>
            </div>

            {/* New Contract Details */}
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">เงินดาวน์ (บาท) *</label>
                  <input
                    type="number"
                    value={downPayment}
                    onChange={(e) => setDownPayment(e.target.value)}
                    placeholder="ขั้นต่ำ 15% ของราคาสินค้า"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                  />
                  <div className="text-xs text-gray-400 mt-1">
                    ขั้นต่ำ ~{Math.ceil(quote.newProduct.selectedPrice.amount * 0.15).toLocaleString()} บาท (15%)
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">จำนวนงวด *</label>
                  <select
                    value={totalMonths}
                    onChange={(e) => setTotalMonths(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                  >
                    {[6, 7, 8, 9, 10, 11, 12].map((m) => (
                      <option key={m} value={m}>{m} เดือน</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุ</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                  placeholder="หมายเหตุเพิ่มเติม..."
                />
              </div>
            </div>

            <div className="flex justify-between pt-4">
              <button
                onClick={() => setStep('select')}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                ย้อนกลับ
              </button>
              <button
                onClick={handleConfirm}
                disabled={!downPayment || Number(downPayment) <= 0}
                className="px-6 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors"
              >
                ดำเนินการต่อ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Confirm */}
      {step === 'confirm' && quote && (
        <div className="bg-white rounded-lg border p-6">
          <h3 className="text-lg font-medium mb-4">ยืนยันการเปลี่ยนเครื่อง</h3>

          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <div className="text-sm text-yellow-700 font-medium mb-2">กรุณาตรวจสอบข้อมูลก่อนยืนยัน</div>
            <div className="text-sm text-yellow-600">
              การเปลี่ยนเครื่องจะปิดสัญญาเดิมและสร้างสัญญาใหม่ ไม่สามารถย้อนกลับได้
            </div>
          </div>

          <div className="space-y-3 text-sm mb-6">
            <div className="flex justify-between py-2 border-b">
              <span className="text-gray-500">ลูกค้า</span>
              <span className="font-medium">{quote.oldContract.customer.name}</span>
            </div>
            <div className="flex justify-between py-2 border-b">
              <span className="text-gray-500">สัญญาเดิม</span>
              <span className="font-medium">{quote.oldContract.contractNumber}</span>
            </div>
            <div className="flex justify-between py-2 border-b">
              <span className="text-gray-500">เครื่องเดิม</span>
              <span>{quote.oldContract.product.brand} {quote.oldContract.product.model}</span>
            </div>
            <div className="flex justify-between py-2 border-b">
              <span className="text-gray-500">เครื่องใหม่</span>
              <span className="font-medium text-primary-600">{quote.newProduct.brand} {quote.newProduct.model}</span>
            </div>
            <div className="flex justify-between py-2 border-b">
              <span className="text-gray-500">ราคาเครื่องใหม่</span>
              <span>{quote.newProduct.selectedPrice.amount.toLocaleString()} บาท</span>
            </div>
            <div className="flex justify-between py-2 border-b">
              <span className="text-gray-500">เงินดาวน์</span>
              <span>{Number(downPayment).toLocaleString()} บาท</span>
            </div>
            <div className="flex justify-between py-2 border-b">
              <span className="text-gray-500">จำนวนงวด</span>
              <span>{totalMonths} เดือน</span>
            </div>
          </div>

          <div className="flex justify-between">
            <button
              onClick={() => setStep('quote')}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
            >
              ย้อนกลับ
            </button>
            <button
              onClick={handleExecute}
              disabled={exchangeMutation.isPending}
              className="px-6 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              {exchangeMutation.isPending ? 'กำลังดำเนินการ...' : 'ยืนยันเปลี่ยนเครื่อง'}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Done */}
      {step === 'done' && exchangeResult && (
        <div className="bg-white rounded-lg border p-6 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">เปลี่ยนเครื่องสำเร็จ!</h3>

          <div className="bg-gray-50 rounded-lg p-4 text-sm text-left max-w-md mx-auto mb-6 space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-500">สัญญาเดิม</span>
              <span className="line-through text-gray-400">{exchangeResult.oldContract.contractNumber}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">สัญญาใหม่</span>
              <span className="font-medium text-primary-600">{exchangeResult.newContract.contractNumber}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">ค่างวด/เดือน</span>
              <span className="font-medium">{exchangeResult.newContract.monthlyPayment.toLocaleString()} บาท</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">จำนวนงวด</span>
              <span>{exchangeResult.newContract.totalMonths} เดือน</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">ยอมผ่อนรวม</span>
              <span>{exchangeResult.newContract.financedAmount.toLocaleString()} บาท</span>
            </div>
          </div>

          <button
            onClick={resetForm}
            className="px-6 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors"
          >
            เปลี่ยนเครื่องรายการใหม่
          </button>
        </div>
      )}
    </div>
  );
}
