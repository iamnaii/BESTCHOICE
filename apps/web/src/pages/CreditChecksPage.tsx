import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import { compressImageForOcr } from '@/lib/compressImage';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { useAuth } from '@/contexts/AuthContext';
import toast from 'react-hot-toast';

interface OcrBookBankResult {
  accountName: string | null;
  accountNo: string | null;
  bankName: string | null;
  branchName: string | null;
  accountType: string | null;
  balance: number | null;
  lastTransactionDate: string | null;
  confidence: number;
}

interface Customer {
  id: string;
  name: string;
  phone: string;
  nationalId: string;
  salary: string | null;
  occupation: string | null;
}

interface CreditCheckItem {
  id: string;
  status: string;
  bankName: string | null;
  statementFiles: string[];
  statementMonths: number;
  aiScore: number | null;
  aiSummary: string | null;
  aiRecommendation: string | null;
  reviewNotes: string | null;
  checkedBy: { id: string; name: string } | null;
  customer: { id: string; name: string; phone: string; salary: string | null; occupation: string | null };
  contract: { id: string; contractNumber: string } | null;
  createdAt: string;
}

const statusLabels: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'รอวิเคราะห์', className: 'bg-gray-100 text-gray-700' },
  APPROVED: { label: 'ผ่าน', className: 'bg-green-100 text-green-700' },
  REJECTED: { label: 'ไม่ผ่าน', className: 'bg-red-100 text-red-700' },
  MANUAL_REVIEW: { label: 'ต้องตรวจเพิ่ม', className: 'bg-amber-100 text-amber-700' },
};

export default function CreditChecksPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [bankName, setBankName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const bookBankFileRef = useRef<HTMLInputElement>(null);
  const [bookBankLoading, setBookBankLoading] = useState(false);
  const [bookBankResult, setBookBankResult] = useState<OcrBookBankResult | null>(null);

  const canOverride = user && ['OWNER', 'BRANCH_MANAGER'].includes(user.role);
  const [overrideId, setOverrideId] = useState<string | null>(null);
  const [overrideCustomerId, setOverrideCustomerId] = useState<string | null>(null);
  const [overrideStatus, setOverrideStatus] = useState('');
  const [overrideNotes, setOverrideNotes] = useState('');

  const { data: creditChecksData, isLoading } = useQuery<{ data: CreditCheckItem[]; total: number }>({
    queryKey: ['credit-checks', search, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      params.set('limit', '999');
      const { data } = await api.get(`/credit-checks?${params}`);
      return data;
    },
  });

  const creditChecks = creditChecksData?.data || [];

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ['customers-search-cc', customerSearch],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (customerSearch) params.set('search', customerSearch);
      const { data } = await api.get(`/customers?${params}`);
      return data.data || [];
    },
    enabled: showCreateModal,
  });

  const uploadMutation = useMutation({
    mutationFn: async (files: FileList) => {
      if (!selectedCustomer) throw new Error('เลือกลูกค้าก่อน');
      const fileUrls: string[] = [];
      for (const file of Array.from(files)) {
        const reader = new FileReader();
        const url = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์ได้'));
          reader.readAsDataURL(file);
        });
        fileUrls.push(url);
      }
      const { data } = await api.post(`/customers/${selectedCustomer.id}/credit-check`, {
        bankName: bankName || undefined,
        statementFiles: fileUrls,
        statementMonths: 3,
      });
      return data;
    },
    onSuccess: () => {
      toast.success('สร้างรายการตรวจเครดิตสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['credit-checks'] });
      setShowCreateModal(false);
      setSelectedCustomer(null);
      setBankName('');
      setCustomerSearch('');
      setBookBankResult(null);
      if (fileRef.current) fileRef.current.value = '';
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const analyzeMutation = useMutation({
    mutationFn: async ({ customerId, creditCheckId }: { customerId: string; creditCheckId: string }) => {
      const { data } = await api.post(`/customers/${customerId}/credit-check/${creditCheckId}/analyze`);
      return data;
    },
    onSuccess: () => {
      toast.success('วิเคราะห์เครดิตเสร็จสิ้น');
      queryClient.invalidateQueries({ queryKey: ['credit-checks'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const overrideMutation = useMutation({
    mutationFn: async () => {
      if (!overrideId || !overrideCustomerId) return;
      const { data } = await api.post(`/customers/${overrideCustomerId}/credit-check/${overrideId}/override`, {
        status: overrideStatus,
        reviewNotes: overrideNotes || undefined,
      });
      return data;
    },
    onSuccess: () => {
      toast.success('อัปเดตสถานะเครดิตเช็คแล้ว');
      queryClient.invalidateQueries({ queryKey: ['credit-checks'] });
      setOverrideId(null);
      setOverrideCustomerId(null);
      setOverrideStatus('');
      setOverrideNotes('');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const handleBookBankScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (bookBankFileRef.current) bookBankFileRef.current.value = '';
    if (file.size > 10 * 1024 * 1024) {
      toast.error('ไฟล์ต้องมีขนาดไม่เกิน 10MB');
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast.error('กรุณาเลือกไฟล์รูปภาพ');
      return;
    }

    setBookBankLoading(true);
    try {
      const imageBase64 = await compressImageForOcr(file);
      const { data } = await api.post<OcrBookBankResult>('/ocr/book-bank', { imageBase64 }, { timeout: 90000 });
      setBookBankResult(data);

      // Auto-fill bank name from OCR
      if (data.bankName) {
        setBankName(data.bankName);
      }

      const pct = (data.confidence * 100).toFixed(0);
      if (data.confidence < 0.7) {
        toast(`อ่านสมุดบัญชีสำเร็จ ความมั่นใจ ${pct}%`, { icon: '!' });
      } else {
        toast.success(`อ่านสมุดบัญชีสำเร็จ (ความมั่นใจ ${pct}%)`);
      }
    } catch (err: any) {
      if (err.code === 'ECONNABORTED' || !err.response) {
        toast.error('ไม่สามารถเชื่อมต่อ OCR ได้ กรุณาลองใหม่');
      } else {
        toast.error(getErrorMessage(err));
      }
    } finally {
      setBookBankLoading(false);
    }
  };

  const columns = [
    {
      key: 'customer',
      label: 'ลูกค้า',
      render: (cc: CreditCheckItem) => (
        <div>
          <button onClick={() => navigate(`/customers/${cc.customer.id}`)} className="text-sm font-medium text-primary-600 hover:underline">{cc.customer.name}</button>
          <div className="text-xs text-gray-400">{cc.customer.phone}</div>
        </div>
      ),
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (cc: CreditCheckItem) => {
        const s = statusLabels[cc.status] || { label: cc.status, className: 'bg-gray-100' };
        return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>{s.label}</span>;
      },
    },
    {
      key: 'aiScore',
      label: 'คะแนน',
      render: (cc: CreditCheckItem) => cc.aiScore !== null ? (
        <div className="flex items-center gap-2">
          <span className={`text-sm font-bold ${cc.aiScore >= 70 ? 'text-green-600' : cc.aiScore >= 50 ? 'text-amber-600' : 'text-red-600'}`}>{cc.aiScore}</span>
          <div className="w-16 bg-gray-200 rounded-full h-1.5">
            <div className={`h-1.5 rounded-full ${cc.aiScore >= 70 ? 'bg-green-500' : cc.aiScore >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${cc.aiScore}%` }} />
          </div>
        </div>
      ) : <span className="text-xs text-gray-400">-</span>,
    },
    {
      key: 'bankName',
      label: 'ธนาคาร',
      render: (cc: CreditCheckItem) => <span className="text-sm">{cc.bankName || '-'}</span>,
    },
    {
      key: 'contract',
      label: 'สัญญา',
      render: (cc: CreditCheckItem) => cc.contract ? (
        <button onClick={() => navigate(`/contracts/${cc.contract!.id}`)} className="text-xs text-primary-600 hover:underline font-mono">{cc.contract.contractNumber}</button>
      ) : <span className="text-xs text-gray-400">ยังไม่มีสัญญา</span>,
    },
    {
      key: 'createdAt',
      label: 'วันที่',
      render: (cc: CreditCheckItem) => <span className="text-xs text-gray-500">{new Date(cc.createdAt).toLocaleDateString('th-TH')}</span>,
    },
    {
      key: 'actions',
      label: '',
      render: (cc: CreditCheckItem) => (
        <div className="flex gap-2">
          {cc.status === 'PENDING' && (
            <button
              onClick={() => analyzeMutation.mutate({ customerId: cc.customer.id, creditCheckId: cc.id })}
              disabled={analyzeMutation.isPending}
              className="px-3 py-1 text-xs bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
            >
              AI วิเคราะห์
            </button>
          )}
          {canOverride && cc.aiScore !== null && (
            <button
              onClick={() => { setOverrideId(cc.id); setOverrideCustomerId(cc.customer.id); }}
              className="px-3 py-1 text-xs bg-primary-100 text-primary-700 rounded-lg hover:bg-primary-200"
            >
              Override
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="ตรวจเครดิต"
        subtitle="ตรวจสอบเครดิตลูกค้าก่อนทำสัญญา"
        action={
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            + ตรวจเครดิตใหม่
          </button>
        }
      />

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <input
          type="text"
          placeholder="ค้นหาชื่อลูกค้า..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-64"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
        >
          <option value="">ทุกสถานะ</option>
          <option value="PENDING">รอวิเคราะห์</option>
          <option value="APPROVED">ผ่าน</option>
          <option value="REJECTED">ไม่ผ่าน</option>
          <option value="MANUAL_REVIEW">ต้องตรวจเพิ่ม</option>
        </select>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg border p-4">
          <div className="text-xs text-gray-500">ทั้งหมด</div>
          <div className="text-xl font-bold">{creditChecks.length}</div>
        </div>
        <div className="bg-green-50 rounded-lg border border-green-200 p-4">
          <div className="text-xs text-green-600">ผ่าน</div>
          <div className="text-xl font-bold text-green-700">{creditChecks.filter((c) => c.status === 'APPROVED').length}</div>
        </div>
        <div className="bg-amber-50 rounded-lg border border-amber-200 p-4">
          <div className="text-xs text-amber-600">รอวิเคราะห์ / ตรวจเพิ่ม</div>
          <div className="text-xl font-bold text-amber-700">{creditChecks.filter((c) => c.status === 'PENDING' || c.status === 'MANUAL_REVIEW').length}</div>
        </div>
        <div className="bg-red-50 rounded-lg border border-red-200 p-4">
          <div className="text-xs text-red-600">ไม่ผ่าน</div>
          <div className="text-xl font-bold text-red-700">{creditChecks.filter((c) => c.status === 'REJECTED').length}</div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      ) : (
        <DataTable columns={columns} data={creditChecks} emptyMessage="ยังไม่มีรายการตรวจเครดิต" />
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <Modal isOpen title="ตรวจเครดิตใหม่" onClose={() => { setShowCreateModal(false); setSelectedCustomer(null); setBankName(''); setCustomerSearch(''); }}>
          <div className="space-y-4">
            {/* Customer selection */}
            {!selectedCustomer ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">เลือกลูกค้า</label>
                <input
                  type="text"
                  placeholder="ค้นหาชื่อ, เบอร์โทร, เลขบัตร..."
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-3"
                />
                <div className="max-h-60 overflow-y-auto space-y-2">
                  {customers.map((c) => (
                    <div
                      key={c.id}
                      onClick={() => setSelectedCustomer(c)}
                      className="p-3 rounded-lg border cursor-pointer hover:border-primary-400 hover:bg-primary-50 transition-colors"
                    >
                      <div className="text-sm font-medium">{c.name}</div>
                      <div className="text-xs text-gray-500">{c.phone} {c.salary ? `| เงินเดือน ${parseFloat(c.salary).toLocaleString()} ฿` : ''}</div>
                    </div>
                  ))}
                  {customers.length === 0 && customerSearch && (
                    <div className="text-center py-4 text-sm text-gray-400">ไม่พบลูกค้า</div>
                  )}
                </div>
              </div>
            ) : (
              <div>
                <div className="bg-primary-50 rounded-lg p-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-primary-800">{selectedCustomer.name}</div>
                    <div className="text-xs text-primary-600">{selectedCustomer.phone} {selectedCustomer.salary ? `| เงินเดือน ${parseFloat(selectedCustomer.salary).toLocaleString()} ฿` : ''}</div>
                  </div>
                  <button onClick={() => setSelectedCustomer(null)} className="text-xs text-primary-600 hover:text-primary-800">เปลี่ยน</button>
                </div>

                <div className="mt-4 space-y-3">
                  {/* Book Bank OCR */}
                  <div className="bg-primary-50 border border-primary-200 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <h4 className="text-sm font-semibold text-primary-800">สแกนหน้าสมุดบัญชี (OCR)</h4>
                    </div>
                    <p className="text-xs text-primary-600 mb-2">ถ่ายรูปหน้าสมุดบัญชีเพื่อกรอกชื่อธนาคารอัตโนมัติ</p>
                    <input
                      ref={bookBankFileRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleBookBankScan}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => bookBankFileRef.current?.click()}
                      disabled={bookBankLoading}
                      className="inline-flex items-center gap-2 px-3 py-1.5 bg-primary-600 text-white rounded-lg text-xs font-medium hover:bg-primary-700 disabled:opacity-50"
                    >
                      {bookBankLoading ? (
                        <>
                          <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white" />
                          กำลังอ่านสมุดบัญชี...
                        </>
                      ) : (
                        <>
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                          สแกนสมุดบัญชี
                        </>
                      )}
                    </button>

                    {/* Book bank OCR result */}
                    {bookBankResult && (
                      <div className="mt-2 p-2 bg-white rounded border border-primary-200 space-y-1">
                        <div className="text-xs text-gray-500">ผลการสแกน:</div>
                        {bookBankResult.accountName && <div className="text-xs"><span className="text-gray-500">ชื่อบัญชี:</span> <span className="font-medium">{bookBankResult.accountName}</span></div>}
                        {bookBankResult.accountNo && <div className="text-xs"><span className="text-gray-500">เลขที่บัญชี:</span> <span className="font-mono">{bookBankResult.accountNo}</span></div>}
                        {bookBankResult.bankName && <div className="text-xs"><span className="text-gray-500">ธนาคาร:</span> {bookBankResult.bankName} {bookBankResult.branchName && `(${bookBankResult.branchName})`}</div>}
                        {bookBankResult.accountType && <div className="text-xs"><span className="text-gray-500">ประเภท:</span> {bookBankResult.accountType}</div>}
                        {bookBankResult.balance !== null && <div className="text-xs"><span className="text-gray-500">ยอดเงิน:</span> <span className="font-bold text-green-700">{bookBankResult.balance.toLocaleString()} ฿</span></div>}
                      </div>
                    )}
                  </div>

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
                    <label className="block text-xs text-gray-500 mb-1">Statement ย้อนหลัง 3 เดือน (ภาพ/PDF)</label>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*,.pdf"
                      multiple
                      onChange={(e) => e.target.files && uploadMutation.mutate(e.target.files)}
                      disabled={uploadMutation.isPending}
                      className="w-full text-sm text-gray-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700"
                    />
                  </div>
                  {uploadMutation.isPending && (
                    <div className="flex items-center gap-2 text-sm text-primary-600">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-600" />
                      กำลังอัปโหลดและสร้างรายการ...
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Override Modal */}
      {overrideId && (
        <Modal isOpen title="Override สถานะเครดิตเช็ค" onClose={() => { setOverrideId(null); setOverrideCustomerId(null); }}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">สถานะใหม่</label>
              <select
                value={overrideStatus}
                onChange={(e) => setOverrideStatus(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value="">เลือกสถานะ...</option>
                <option value="APPROVED">อนุมัติ</option>
                <option value="REJECTED">ปฏิเสธ</option>
                <option value="MANUAL_REVIEW">ตรวจเพิ่มเติม</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุ</label>
              <textarea
                value={overrideNotes}
                onChange={(e) => setOverrideNotes(e.target.value)}
                rows={2}
                placeholder="ระบุเหตุผล..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setOverrideId(null); setOverrideCustomerId(null); }} className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-lg">ยกเลิก</button>
              <button
                onClick={() => overrideMutation.mutate()}
                disabled={!overrideStatus || overrideMutation.isPending}
                className="flex-1 px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
              >
                {overrideMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
