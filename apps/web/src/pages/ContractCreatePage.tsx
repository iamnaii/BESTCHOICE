import { useState, useRef } from 'react';
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
  salary: string | null;
  occupation: string | null;
}

interface InterestConfig {
  id: string;
  name: string;
  productCategories: string[];
  interestRate: string;
  minDownPaymentPct: string;
  minInstallmentMonths: number;
  maxInstallmentMonths: number;
}

const STEPS = ['เลือกสินค้า', 'เลือกลูกค้า', 'เลือกแผนผ่อน', 'แนบเอกสาร', 'ตรวจเครดิต', 'ยืนยัน'];

const DOCUMENT_TYPES = [
  { value: 'ID_CARD_COPY', label: 'สำเนาบัตรประชาชน', required: true },
  { value: 'KYC', label: 'เอกสาร KYC', required: false },
  { value: 'FACEBOOK_PROFILE', label: 'Profile Facebook', required: false },
  { value: 'FACEBOOK_POST', label: 'Post Facebook ล่าสุด (ไม่เกิน 1 เดือน)', required: false },
  { value: 'LINE_PROFILE', label: 'Profile LINE', required: false },
  { value: 'DEVICE_RECEIPT_PHOTO', label: 'รูปรับเครื่อง', required: false },
];

interface PendingDoc {
  id: string;
  type: string;
  file: File;
  preview: string;
}

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
  const [paymentDueDay, setPaymentDueDay] = useState<number>(1);

  // Documents
  const [pendingDocs, setPendingDocs] = useState<PendingDoc[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedDocType, setSelectedDocType] = useState('ID_CARD_COPY');

  // Credit check
  const [bankName, setBankName] = useState('');
  const [statementFiles, setStatementFiles] = useState<File[]>([]);
  const [creditResult, setCreditResult] = useState<any>(null);
  const statementInputRef = useRef<HTMLInputElement>(null);
  const submitForReviewRef = useRef(false);

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

  // Fetch interest config based on selected product category
  const { data: interestConfig } = useQuery<InterestConfig | null>({
    queryKey: ['interest-config', selectedProduct?.category],
    queryFn: async () => {
      const { data } = await api.get(`/interest-configs/by-category/${selectedProduct!.category}`);
      return data;
    },
    enabled: !!selectedProduct,
  });

  // Fallback POS config
  const { data: posConfig } = useQuery<{ interestRate: number; minDownPaymentPct: number; minInstallmentMonths: number; maxInstallmentMonths: number }>({
    queryKey: ['pos-config'],
    queryFn: async () => { const { data } = await api.get('/sales/config'); return data; },
  });

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const { data } = await api.post('/contracts', body);
      return data;
    },
    onSuccess: async (data) => {
      // Upload pending documents
      for (const doc of pendingDocs) {
        try {
          const reader = new FileReader();
          const fileUrl = await new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์ได้'));
            reader.readAsDataURL(doc.file);
          });
          await api.post(`/contracts/${data.id}/documents`, {
            documentType: doc.type,
            fileName: doc.file.name,
            fileUrl,
            fileSize: doc.file.size,
          });
        } catch {
          // Continue uploading other docs
        }
      }

      // Upload credit check if statement files exist
      if (statementFiles.length > 0) {
        try {
          const fileUrls: string[] = [];
          for (const file of statementFiles) {
            const reader = new FileReader();
            const url = await new Promise<string>((resolve, reject) => {
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์ได้'));
              reader.readAsDataURL(file);
            });
            fileUrls.push(url);
          }
          await api.post(`/contracts/${data.id}/credit-check`, {
            bankName: bankName || undefined,
            statementFiles: fileUrls,
          });
        } catch {
          // Non-critical
        }
      }

      // If user clicked "สร้าง + ส่งตรวจสอบ", auto-submit for review
      if (submitForReviewRef.current) {
        try {
          await api.post(`/contracts/${data.id}/submit-review`);
          toast.success('สร้างสัญญาและส่งตรวจสอบสำเร็จ');
        } catch {
          toast.success('สร้างสัญญาสำเร็จ (ส่งตรวจสอบไม่สำเร็จ กรุณาส่งอีกครั้ง)');
        }
      } else {
        toast.success('สร้างสัญญาสำเร็จ');
      }
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

  // Use interest config if available, otherwise use posConfig
  const interestRate = interestConfig ? parseFloat(interestConfig.interestRate) : (posConfig?.interestRate ?? 0.08);
  const minDownPct = interestConfig ? parseFloat(interestConfig.minDownPaymentPct) : (posConfig?.minDownPaymentPct ?? 0.15);
  const minMonths = interestConfig?.minInstallmentMonths ?? posConfig?.minInstallmentMonths ?? 6;
  const maxMonths = interestConfig?.maxInstallmentMonths ?? posConfig?.maxInstallmentMonths ?? 12;

  const interestTotal = (sellingPrice - downPayment) * interestRate * totalMonths;
  const financedAmount = (sellingPrice - downPayment) + interestTotal;
  const monthlyPayment = totalMonths > 0 ? Math.ceil(financedAmount / totalMonths) : 0;

  const handleAddDoc = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error('ไฟล์ต้องมีขนาดไม่เกิน 10MB');
      return;
    }
    const preview = URL.createObjectURL(file);
    setPendingDocs((prev) => [...prev, { id: crypto.randomUUID(), type: selectedDocType, file, preview }]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRemoveDoc = (id: string) => {
    setPendingDocs((prev) => {
      const doc = prev.find((d) => d.id === id);
      if (doc) URL.revokeObjectURL(doc.preview);
      return prev.filter((d) => d.id !== id);
    });
  };

  const handleAddStatement = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    setStatementFiles((prev) => [...prev, ...Array.from(files)]);
    if (statementInputRef.current) statementInputRef.current.value = '';
  };

  const handleSubmit = (submitForReview: boolean) => {
    if (!selectedProduct || !selectedCustomer) return;
    submitForReviewRef.current = submitForReview;
    createMutation.mutate({
      customerId: selectedCustomer.id,
      productId: selectedProduct.id,
      branchId: selectedProduct.branchId,
      planType,
      sellingPrice,
      downPayment,
      totalMonths,
      notes: notes || undefined,
      paymentDueDay,
    });
  };

  const canNext = () => {
    if (step === 0) return !!selectedProduct;
    if (step === 1) return !!selectedCustomer;
    if (step === 2) return downPayment >= sellingPrice * minDownPct && totalMonths >= minMonths && totalMonths <= maxMonths;
    return true;
  };

  const monthOptions = [];
  for (let m = minMonths; m <= maxMonths; m++) {
    monthOptions.push(m);
  }

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
      <div className="flex items-center gap-1 mb-6 flex-wrap">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-1">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${i <= step ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
              {i + 1}
            </div>
            <span className={`text-xs ${i <= step ? 'text-primary-700 font-medium' : 'text-gray-400'} hidden md:inline`}>{s}</span>
            {i < STEPS.length - 1 && <div className={`w-4 h-0.5 ${i < step ? 'bg-primary-600' : 'bg-gray-200'}`} />}
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
                    <div className="text-xs text-gray-400 mt-1">
                      สาขา: {p.branch?.name}
                      <span className="ml-2 px-1.5 py-0.5 bg-gray-100 rounded text-[10px]">{p.category === 'PHONE_NEW' ? 'มือ 1' : p.category === 'PHONE_USED' ? 'มือ 2' : p.category}</span>
                    </div>
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
                    {c.salary && <div className="text-xs text-gray-400 mt-1">เงินเดือน: {parseFloat(c.salary).toLocaleString()} ฿</div>}
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

      {/* Step 3: Plan Details + Due Date */}
      {step === 2 && (
        <div className="max-w-xl">
          <div className="bg-white rounded-lg border p-6 space-y-4">
            {/* Interest Config Badge */}
            {interestConfig && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center gap-2">
                <span className="text-xs text-blue-600">ใช้ดอกเบี้ยตาม:</span>
                <span className="text-sm font-medium text-blue-800">{interestConfig.name}</span>
                <span className="text-xs text-blue-500">({(interestRate * 100).toFixed(1)}% | ดาวน์ขั้นต่ำ {(minDownPct * 100).toFixed(0)}% | {minMonths}-{maxMonths} เดือน)</span>
              </div>
            )}

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
                {monthOptions.map((m) => (
                  <option key={m} value={m}>{m} เดือน</option>
                ))}
              </select>
            </div>

            {/* Payment Due Day */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">วันที่ครบกำหนดชำระ (ตามวันเงินเดือนออก)</label>
              <select
                value={paymentDueDay}
                onChange={(e) => setPaymentDueDay(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>วันที่ {d} ของทุกเดือน</option>
                ))}
              </select>
              <div className="text-xs text-gray-400 mt-1">ลูกค้าจะต้องชำระเงินทุกวันที่ {paymentDueDay} ของเดือน</div>
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
                <span className="text-gray-600">ดอกเบี้ยรวม ({(interestRate * 100).toFixed(1)}% x {totalMonths} เดือน)</span>
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
              <div className="text-xs text-gray-500 text-right">ชำระทุกวันที่ {paymentDueDay}</div>
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Document Attachments */}
      {step === 3 && (
        <div className="max-w-2xl space-y-4">
          <div className="bg-white rounded-lg border p-6 space-y-4">
            <h3 className="text-sm font-semibold text-gray-900">แนบเอกสาร</h3>
            <p className="text-xs text-gray-500">แนบเอกสารที่จำเป็นสำหรับสัญญา เช่น สำเนาบัตรประชาชน, KYC, Profile Facebook/LINE, รูปรับเครื่อง</p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">ประเภทเอกสาร</label>
                <select
                  value={selectedDocType}
                  onChange={(e) => setSelectedDocType(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  {DOCUMENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}{t.required ? ' *' : ''}</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs text-gray-500 mb-1">เลือกไฟล์ (ภาพ/PDF, ไม่เกิน 10MB)</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.pdf"
                  onChange={handleAddDoc}
                  className="w-full text-sm text-gray-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
                />
              </div>
            </div>
          </div>

          {/* Pending documents list */}
          {pendingDocs.length > 0 && (
            <div className="bg-white rounded-lg border">
              <div className="px-4 py-3 border-b">
                <h3 className="text-sm font-semibold text-gray-900">เอกสารที่เลือก ({pendingDocs.length})</h3>
              </div>
              <div className="divide-y">
                {pendingDocs.map((doc) => (
                  <div key={doc.id} className="px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {doc.file.type.startsWith('image/') ? (
                        <img src={doc.preview} alt="" className="w-10 h-10 rounded object-cover" />
                      ) : (
                        <div className="w-10 h-10 rounded bg-red-100 flex items-center justify-center text-xs font-bold text-red-600">PDF</div>
                      )}
                      <div>
                        <div className="text-sm font-medium text-gray-900">{doc.file.name}</div>
                        <div className="text-xs text-gray-500">
                          {DOCUMENT_TYPES.find((t) => t.value === doc.type)?.label}
                          {' | '}{(doc.file.size / 1024).toFixed(0)} KB
                        </div>
                      </div>
                    </div>
                    <button onClick={() => handleRemoveDoc(doc.id)} className="text-xs text-red-600 hover:text-red-800">ลบ</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {pendingDocs.length === 0 && (
            <div className="text-center py-6 text-gray-400 text-sm bg-white rounded-lg border">
              ยังไม่มีเอกสารที่แนบ (สามารถแนบภายหลังได้)
            </div>
          )}
        </div>
      )}

      {/* Step 5: Credit Check */}
      {step === 4 && (
        <div className="max-w-2xl space-y-4">
          <div className="bg-white rounded-lg border p-6 space-y-4">
            <h3 className="text-sm font-semibold text-gray-900">ตรวจสอบเครดิตลูกค้า (ไม่บังคับ)</h3>
            <p className="text-xs text-gray-500">อัปโหลด Statement ธนาคารย้อนหลัง 3 เดือน เพื่อให้ AI วิเคราะห์ความสามารถในการผ่อนชำระ สามารถข้ามขั้นตอนนี้ได้</p>

            {selectedCustomer?.salary && (
              <div className="bg-blue-50 rounded-lg p-3">
                <div className="text-xs text-blue-600">ข้อมูลลูกค้า</div>
                <div className="text-sm">เงินเดือน: {parseFloat(selectedCustomer.salary).toLocaleString()} ฿ | อาชีพ: {selectedCustomer.occupation || '-'}</div>
                <div className="text-sm">ค่างวด: {monthlyPayment.toLocaleString()} ฿ ({selectedCustomer.salary ? ((monthlyPayment / parseFloat(selectedCustomer.salary)) * 100).toFixed(0) : '?'}% ของรายได้)</div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">ธนาคาร</label>
                <input
                  type="text"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  placeholder="เช่น กสิกร, กรุงไทย..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Statement ย้อนหลัง 3 เดือน</label>
                <input
                  ref={statementInputRef}
                  type="file"
                  accept="image/*,.pdf"
                  multiple
                  onChange={handleAddStatement}
                  className="w-full text-sm text-gray-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
                />
              </div>
            </div>

            {statementFiles.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {statementFiles.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-lg text-sm">
                    <span>{f.name}</span>
                    <button
                      onClick={() => setStatementFiles((prev) => prev.filter((_, j) => j !== i))}
                      className="text-red-500 text-xs"
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {statementFiles.length === 0 && (
            <div className="text-center py-4 text-gray-400 text-xs">
              สามารถข้ามขั้นตอนนี้และตรวจสอบเครดิตภายหลังในหน้ารายละเอียดสัญญาได้
            </div>
          )}
        </div>
      )}

      {/* Step 6: Confirm */}
      {step === 5 && (
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
                <div><div className="text-xs text-gray-500">ดอกเบี้ย</div><div className="text-sm font-medium">{(interestRate * 100).toFixed(1)}%{interestConfig ? ` (${interestConfig.name})` : ''}</div></div>
                <div><div className="text-xs text-gray-500">ค่างวด/เดือน</div><div className="text-lg font-bold text-primary-700">{monthlyPayment.toLocaleString()} ฿</div></div>
                <div><div className="text-xs text-gray-500">วันชำระ</div><div className="text-sm font-medium">ทุกวันที่ {paymentDueDay}</div></div>
                <div><div className="text-xs text-gray-500">เอกสารแนบ</div><div className="text-sm font-medium">{pendingDocs.length} ไฟล์</div></div>
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
        {step < 5 ? (
          <button
            onClick={() => canNext() && setStep(step + 1)}
            disabled={!canNext()}
            className="px-6 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ถัดไป
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => handleSubmit(false)}
              disabled={createMutation.isPending}
              className="px-6 py-2 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              {createMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกร่าง'}
            </button>
            <button
              onClick={() => handleSubmit(true)}
              disabled={createMutation.isPending}
              className="px-6 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {createMutation.isPending ? 'กำลังส่ง...' : 'สร้าง + ส่งตรวจสอบ'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
