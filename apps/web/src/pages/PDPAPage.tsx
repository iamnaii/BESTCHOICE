import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import toast from 'react-hot-toast';
import { useAuth } from '@/contexts/AuthContext';
import { maskNationalId } from '@/utils/mask.util';

interface DSARRequest {
  id: string;
  customerId: string;
  customer?: { name: string; nationalId: string };
  requestType: string;
  description: string;
  status: string;
  responseNotes: string | null;
  processedById: string | null;
  processedBy?: { name: string } | null;
  createdAt: string;
  updatedAt: string;
}

interface Consent {
  id: string;
  customerId: string;
  consentVersion: string;
  isActive: boolean;
  consentedAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
}

const dsarStatusLabels: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'รอดำเนินการ', className: 'bg-yellow-100 text-yellow-700' },
  IN_PROGRESS: { label: 'กำลังดำเนินการ', className: 'bg-blue-100 text-blue-700' },
  COMPLETED: { label: 'เสร็จสิ้น', className: 'bg-green-100 text-green-700' },
  REJECTED: { label: 'ปฏิเสธ', className: 'bg-red-100 text-red-700' },
};

const requestTypeLabels: Record<string, string> = {
  ACCESS: 'ขอเข้าถึงข้อมูล',
  CORRECTION: 'ขอแก้ไขข้อมูล',
  DELETION: 'ขอลบข้อมูล',
  PORTABILITY: 'ขอโอนย้ายข้อมูล',
  OBJECTION: 'ขอคัดค้านการประมวลผล',
  RESTRICTION: 'ขอจำกัดการประมวลผล',
};

function PDPAPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'dsar' | 'consent-lookup'>('dsar');
  const [customerIdSearch, setCustomerIdSearch] = useState('');
  const [showProcessModal, setShowProcessModal] = useState(false);
  const [selectedDSAR, setSelectedDSAR] = useState<DSARRequest | null>(null);
  const [processForm, setProcessForm] = useState({ status: 'COMPLETED', responseNotes: '' });
  const [showCreateDSAR, setShowCreateDSAR] = useState(false);
  const [dsarForm, setDsarForm] = useState({ customerId: '', requestType: 'ACCESS', description: '' });

  // DSAR requests list
  const { data: dsarData, isLoading: dsarLoading } = useQuery({
    queryKey: ['dsar-requests'],
    queryFn: async () => {
      const { data } = await api.get('/pdpa/dsar');
      return data;
    },
  });

  // Customer consent lookup
  const { data: consents, isLoading: consentLoading, refetch: refetchConsents } = useQuery<Consent[]>({
    queryKey: ['pdpa-consent', customerIdSearch],
    queryFn: async () => {
      if (!customerIdSearch) return [];
      const { data } = await api.get(`/pdpa/consent/customer/${customerIdSearch}`);
      return data;
    },
    enabled: !!customerIdSearch,
  });

  // Process DSAR
  const processMutation = useMutation({
    mutationFn: async () => {
      if (!selectedDSAR) return;
      await api.patch(`/pdpa/dsar/${selectedDSAR.id}`, processForm);
    },
    onSuccess: () => {
      toast.success('ดำเนินการ DSAR สำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['dsar-requests'] });
      setShowProcessModal(false);
      setSelectedDSAR(null);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  // Submit DSAR
  const submitDSARMutation = useMutation({
    mutationFn: async () => {
      await api.post('/pdpa/dsar', dsarForm);
    },
    onSuccess: () => {
      toast.success('ส่งคำร้อง DSAR สำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['dsar-requests'] });
      setShowCreateDSAR(false);
      setDsarForm({ customerId: '', requestType: 'ACCESS', description: '' });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  // Revoke consent
  const revokeMutation = useMutation({
    mutationFn: async (consentId: string) => {
      const reason = window.prompt('เหตุผลในการถอน consent:');
      if (!reason) throw new Error('ยกเลิก');
      await api.post(`/pdpa/consent/${consentId}/revoke`, { reason });
    },
    onSuccess: () => {
      toast.success('ถอน consent สำเร็จ');
      refetchConsents();
    },
    onError: (err) => {
      const msg = getErrorMessage(err);
      if (msg !== 'ยกเลิก') toast.error(msg);
    },
  });

  const dsarRequests: DSARRequest[] = dsarData?.data || dsarData || [];

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="PDPA & คุ้มครองข้อมูลส่วนบุคคล"
        subtitle="จัดการ Consent และคำร้อง DSAR ตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562"
        action={
          <button
            onClick={() => setShowCreateDSAR(true)}
            className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            สร้างคำร้อง DSAR
          </button>
        }
      />

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setTab('dsar')}
          className={`px-4 py-2 text-sm rounded-lg ${tab === 'dsar' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600'}`}
        >
          คำร้อง DSAR
        </button>
        <button
          onClick={() => setTab('consent-lookup')}
          className={`px-4 py-2 text-sm rounded-lg ${tab === 'consent-lookup' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600'}`}
        >
          ค้นหา Consent
        </button>
      </div>

      {tab === 'dsar' && (
        <div className="bg-white rounded-lg border">
          <DataTable
            data={dsarRequests}
            loading={dsarLoading}
            columns={[
              {
                key: 'createdAt',
                label: 'วันที่',
                render: (r: DSARRequest) => (
                  <span className="text-xs">{new Date(r.createdAt).toLocaleDateString('th-TH')}</span>
                ),
              },
              {
                key: 'customer',
                label: 'ลูกค้า',
                render: (r: DSARRequest) => (
                  <div>
                    <div className="text-sm font-medium">{r.customer?.name || '-'}</div>
                    <div className="text-xs text-gray-400 font-mono">{r.customer ? maskNationalId(r.customer.nationalId) : '-'}</div>
                  </div>
                ),
              },
              {
                key: 'requestType',
                label: 'ประเภท',
                render: (r: DSARRequest) => (
                  <span className="text-xs">{requestTypeLabels[r.requestType] || r.requestType}</span>
                ),
              },
              {
                key: 'description',
                label: 'รายละเอียด',
                render: (r: DSARRequest) => (
                  <span className="text-xs text-gray-600 truncate max-w-[200px] block">{r.description}</span>
                ),
              },
              {
                key: 'status',
                label: 'สถานะ',
                render: (r: DSARRequest) => {
                  const s = dsarStatusLabels[r.status] || { label: r.status, className: 'bg-gray-100 text-gray-700' };
                  return <span className={`px-2 py-1 rounded-full text-xs font-medium ${s.className}`}>{s.label}</span>;
                },
              },
              {
                key: 'actions',
                label: '',
                render: (r: DSARRequest) => (
                  r.status === 'PENDING' && user?.role === 'OWNER' ? (
                    <button
                      onClick={() => { setSelectedDSAR(r); setProcessForm({ status: 'COMPLETED', responseNotes: '' }); setShowProcessModal(true); }}
                      className="px-3 py-1 text-xs bg-primary-600 text-white rounded hover:bg-primary-700"
                    >
                      ดำเนินการ
                    </button>
                  ) : r.responseNotes ? (
                    <span className="text-xs text-gray-400" title={r.responseNotes}>ดูหมายเหตุ</span>
                  ) : null
                ),
              },
            ]}
            emptyText="ไม่มีคำร้อง DSAR"
          />
        </div>
      )}

      {tab === 'consent-lookup' && (
        <div className="bg-white rounded-lg border p-6">
          <div className="flex gap-3 mb-6">
            <input
              type="text"
              placeholder="ใส่ Customer ID เพื่อค้นหา consent..."
              value={customerIdSearch}
              onChange={(e) => setCustomerIdSearch(e.target.value)}
              className="flex-1 px-3 py-2 border rounded-lg text-sm"
            />
            <button
              onClick={() => refetchConsents()}
              className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              ค้นหา
            </button>
          </div>

          {consentLoading && <p className="text-sm text-gray-400">กำลังค้นหา...</p>}

          {consents && consents.length > 0 && (
            <div className="space-y-3">
              {consents.map((c) => (
                <div key={c.id} className={`p-4 rounded-lg border ${c.isActive ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                  <div className="flex justify-between items-center">
                    <div>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${c.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {c.isActive ? 'Active' : 'Revoked'}
                      </span>
                      <span className="text-xs text-gray-500 ml-2">Version: {c.consentVersion}</span>
                    </div>
                    <div className="text-xs text-gray-400">
                      ให้ consent: {new Date(c.consentedAt).toLocaleString('th-TH')}
                      {c.revokedAt && <span className="text-red-500 ml-2">ถอน: {new Date(c.revokedAt).toLocaleString('th-TH')}</span>}
                    </div>
                  </div>
                  {c.revokeReason && <div className="text-xs text-red-600 mt-1">เหตุผล: {c.revokeReason}</div>}
                  {c.isActive && user?.role === 'OWNER' && (
                    <button
                      onClick={() => revokeMutation.mutate(c.id)}
                      className="mt-2 px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                    >
                      ถอน Consent
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {consents && consents.length === 0 && customerIdSearch && (
            <p className="text-sm text-gray-400 text-center py-4">ไม่พบ consent สำหรับลูกค้านี้</p>
          )}
        </div>
      )}

      {/* Process DSAR Modal */}
      {showProcessModal && selectedDSAR && (
        <Modal title="ดำเนินการคำร้อง DSAR" onClose={() => setShowProcessModal(false)}>
          <div className="space-y-4">
            <div>
              <div className="text-sm text-gray-500">ลูกค้า: {selectedDSAR.customer?.name}</div>
              <div className="text-sm text-gray-500">ประเภท: {requestTypeLabels[selectedDSAR.requestType]}</div>
              <div className="text-sm text-gray-500 mt-1">{selectedDSAR.description}</div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">สถานะ</label>
              <select
                value={processForm.status}
                onChange={(e) => setProcessForm({ ...processForm, status: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              >
                <option value="COMPLETED">เสร็จสิ้น</option>
                <option value="IN_PROGRESS">กำลังดำเนินการ</option>
                <option value="REJECTED">ปฏิเสธ</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">หมายเหตุ</label>
              <textarea
                value={processForm.responseNotes}
                onChange={(e) => setProcessForm({ ...processForm, responseNotes: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border rounded-lg text-sm"
                placeholder="บันทึกผลการดำเนินการ..."
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => processMutation.mutate()}
                disabled={!processForm.responseNotes || processMutation.isPending}
                className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
              >
                {processMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
              <button onClick={() => setShowProcessModal(false)} className="px-4 py-2 text-sm border rounded-lg">
                ยกเลิก
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Create DSAR Modal */}
      {showCreateDSAR && (
        <Modal title="สร้างคำร้อง DSAR" onClose={() => setShowCreateDSAR(false)}>
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Customer ID</label>
              <input
                type="text"
                value={dsarForm.customerId}
                onChange={(e) => setDsarForm({ ...dsarForm, customerId: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-sm"
                placeholder="ใส่ Customer ID..."
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">ประเภทคำร้อง</label>
              <select
                value={dsarForm.requestType}
                onChange={(e) => setDsarForm({ ...dsarForm, requestType: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              >
                {Object.entries(requestTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">รายละเอียด</label>
              <textarea
                value={dsarForm.description}
                onChange={(e) => setDsarForm({ ...dsarForm, description: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border rounded-lg text-sm"
                placeholder="อธิบายรายละเอียดคำร้อง..."
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => submitDSARMutation.mutate()}
                disabled={!dsarForm.customerId || !dsarForm.description || submitDSARMutation.isPending}
                className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
              >
                {submitDSARMutation.isPending ? 'กำลังส่ง...' : 'ส่งคำร้อง'}
              </button>
              <button onClick={() => setShowCreateDSAR(false)} className="px-4 py-2 text-sm border rounded-lg">
                ยกเลิก
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default PDPAPage;
