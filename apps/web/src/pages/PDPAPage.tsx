import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { maskNationalId } from '@/utils/mask.util';
import { formatDateShort, formatDateTime } from '@/utils/formatters';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, activeStatusMap, type StatusConfig } from '@/lib/status-badges';

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

const dsarStatusMap: Record<string, StatusConfig> = {
  PENDING: { variant: 'warning', appearance: 'light', label: 'รอดำเนินการ' },
  IN_PROGRESS: { variant: 'info', appearance: 'light', label: 'กำลังดำเนินการ' },
  COMPLETED: { variant: 'success', appearance: 'light', label: 'เสร็จสิ้น' },
  REJECTED: { variant: 'destructive', appearance: 'light', label: 'ปฏิเสธ' },
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
  const [showRevokeModal, setShowRevokeModal] = useState(false);
  const [revokeReason, setRevokeReason] = useState('');
  const [pendingRevokeConsentId, setPendingRevokeConsentId] = useState<string | null>(null);

  // DSAR requests list
  const { data: dsarData, isLoading: dsarLoading, isError: dsarError, error: dsarQueryError, refetch: refetchDsar } = useQuery({
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
    mutationFn: async ({ consentId, reason }: { consentId: string; reason: string }) => {
      await api.post(`/pdpa/consent/${consentId}/revoke`, { reason });
    },
    onSuccess: () => {
      toast.success('ถอน consent สำเร็จ');
      refetchConsents();
      setShowRevokeModal(false);
      setPendingRevokeConsentId(null);
      setRevokeReason('');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
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
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
          >
            สร้างคำร้อง DSAR
          </button>
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-muted rounded-lg p-1 w-fit">
        <button
          onClick={() => setTab('dsar')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${tab === 'dsar' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
        >
          คำร้อง DSAR
        </button>
        <button
          onClick={() => setTab('consent-lookup')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${tab === 'consent-lookup' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
        >
          ค้นหา Consent
        </button>
      </div>

      {tab === 'dsar' && (
        <QueryBoundary
          isLoading={dsarLoading}
          isError={dsarError}
          error={dsarQueryError}
          onRetry={() => refetchDsar()}
          errorTitle="ไม่สามารถโหลดรายการ DSAR ได้"
        >
        <Card>
          <CardContent className="p-0">
          <DataTable
            data={dsarRequests}
            isLoading={dsarLoading}
            columns={[
              {
                key: 'createdAt',
                label: 'วันที่',
                render: (r: DSARRequest) => (
                  <span className="text-xs">{formatDateShort(r.createdAt)}</span>
                ),
              },
              {
                key: 'customer',
                label: 'ลูกค้า',
                render: (r: DSARRequest) => (
                  <div>
                    <div className="text-sm font-medium">{r.customer?.name || '-'}</div>
                    <div className="text-xs text-muted-foreground font-mono">{r.customer ? maskNationalId(r.customer.nationalId) : '-'}</div>
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
                  <span className="text-xs text-muted-foreground truncate max-w-[200px] block">{r.description}</span>
                ),
              },
              {
                key: 'status',
                label: 'สถานะ',
                render: (r: DSARRequest) => {
                  const cfg = getStatusBadgeProps(r.status, dsarStatusMap);
                  return (
                    <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">
                      {cfg.label}
                    </Badge>
                  );
                },
              },
              {
                key: 'actions',
                label: '',
                render: (r: DSARRequest) => (
                  r.status === 'PENDING' && user?.role === 'OWNER' ? (
                    <button
                      onClick={() => { setSelectedDSAR(r); setProcessForm({ status: 'COMPLETED', responseNotes: '' }); setShowProcessModal(true); }}
                      className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90"
                    >
                      ดำเนินการ
                    </button>
                  ) : r.responseNotes ? (
                    <span className="text-xs text-muted-foreground" title={r.responseNotes}>ดูหมายเหตุ</span>
                  ) : null
                ),
              },
            ]}
            emptyMessage="ไม่มีคำร้อง DSAR"
          />
          </CardContent>
        </Card>
        </QueryBoundary>
      )}

      {tab === 'consent-lookup' && (
        <div className="bg-card rounded-xl border border-border/50 shadow-sm p-6">
          <div className="flex gap-3 mb-6">
            <input
              type="text"
              placeholder="ใส่ Customer ID เพื่อค้นหา consent..."
              value={customerIdSearch}
              onChange={(e) => setCustomerIdSearch(e.target.value)}
              className="flex-1 px-3 py-2 border border-input rounded-lg text-sm bg-background focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
            />
            <button
              onClick={() => refetchConsents()}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              ค้นหา
            </button>
          </div>

          {consentLoading && <p className="text-sm text-muted-foreground">กำลังค้นหา...</p>}

          {consents && consents.length > 0 && (
            <div className="space-y-3">
              {consents.map((c) => (
                <div key={c.id} className={`p-4 rounded-xl border shadow-sm ${c.isActive ? 'border-success/20 bg-success/5 dark:bg-success/10' : 'border-destructive/20 bg-destructive/5 dark:bg-destructive/10'}`}>
                  <div className="flex justify-between items-center">
                    <div>
                      {(() => {
                        const cfg = getStatusBadgeProps(c.isActive ? 'active' : 'inactive', activeStatusMap);
                        return (
                          <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">
                            {c.isActive ? 'Active' : 'Revoked'}
                          </Badge>
                        );
                      })()}
                      <span className="text-xs text-muted-foreground ml-2">Version: {c.consentVersion}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      ให้ consent: {formatDateTime(c.consentedAt)}
                      {c.revokedAt && <span className="text-destructive ml-2">ถอน: {formatDateTime(c.revokedAt)}</span>}
                    </div>
                  </div>
                  {c.revokeReason && <div className="text-xs text-destructive mt-1">เหตุผล: {c.revokeReason}</div>}
                  {c.isActive && user?.role === 'OWNER' && (
                    <button
                      onClick={() => {
                        setPendingRevokeConsentId(c.id);
                        setRevokeReason('');
                        setShowRevokeModal(true);
                      }}
                      className="mt-2 px-3 py-1 text-xs bg-destructive text-destructive-foreground rounded hover:bg-destructive/90"
                    >
                      ถอน Consent
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {consents && consents.length === 0 && customerIdSearch && (
            <p className="text-sm text-muted-foreground text-center py-4">ไม่พบ consent สำหรับลูกค้านี้</p>
          )}
        </div>
      )}

      {/* Process DSAR Modal */}
      {showProcessModal && selectedDSAR && (
        <Modal title="ดำเนินการคำร้อง DSAR" onClose={() => setShowProcessModal(false)}>
          <div className="flex flex-col gap-5 lg:gap-7.5">
            <div>
              <div className="text-sm text-muted-foreground">ลูกค้า: {selectedDSAR.customer?.name}</div>
              <div className="text-sm text-muted-foreground">ประเภท: {requestTypeLabels[selectedDSAR.requestType]}</div>
              <div className="text-sm text-muted-foreground mt-1">{selectedDSAR.description}</div>
            </div>
            <div>
              <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">สถานะ</label>
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
              <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">หมายเหตุ</label>
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
                className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
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

      {/* Revoke Consent Modal */}
      {showRevokeModal && pendingRevokeConsentId && (
        <Modal title="ถอน Consent" onClose={() => { if (!revokeMutation.isPending) { setShowRevokeModal(false); setPendingRevokeConsentId(null); } }}>
          <div className="flex flex-col gap-5 lg:gap-7.5">
            <div>
              <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">เหตุผลในการถอน consent</label>
              <textarea
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border rounded-lg text-sm"
                placeholder="ระบุเหตุผล..."
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (!revokeReason.trim()) { toast.error('กรุณาระบุเหตุผล'); return; }
                  revokeMutation.mutate({ consentId: pendingRevokeConsentId, reason: revokeReason.trim() });
                }}
                disabled={!revokeReason.trim() || revokeMutation.isPending}
                className="px-4 py-2 text-sm bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 disabled:opacity-50"
              >
                {revokeMutation.isPending ? 'กำลังถอน...' : 'ยืนยันถอน'}
              </button>
              <button
                onClick={() => { setShowRevokeModal(false); setPendingRevokeConsentId(null); setRevokeReason(''); }}
                disabled={revokeMutation.isPending}
                className="px-4 py-2 text-sm border rounded-lg"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Create DSAR Modal */}
      {showCreateDSAR && (
        <Modal title="สร้างคำร้อง DSAR" onClose={() => setShowCreateDSAR(false)}>
          <div className="flex flex-col gap-5 lg:gap-7.5">
            <div>
              <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Customer ID</label>
              <input
                type="text"
                value={dsarForm.customerId}
                onChange={(e) => setDsarForm({ ...dsarForm, customerId: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-sm"
                placeholder="ใส่ Customer ID..."
              />
            </div>
            <div>
              <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ประเภทคำร้อง</label>
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
              <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">รายละเอียด</label>
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
                className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
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
