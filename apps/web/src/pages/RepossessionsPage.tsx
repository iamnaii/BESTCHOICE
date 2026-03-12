import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';

interface Repossession {
  id: string;
  repossessedDate: string;
  conditionGrade: string;
  appraisalPrice: string;
  repairCost: string;
  resellPrice: string | null;
  status: string;
  notes: string | null;
  contract: {
    id: string;
    contractNumber: string;
    sellingPrice: string;
    financedAmount: string;
    customer: { id: string; name: string; phone: string };
    branch: { id: string; name: string };
  };
  product: { id: string; name: string; brand: string; model: string; imeiSerial: string | null };
  appraisedBy: { id: string; name: string };
}

const statusLabels: Record<string, string> = {
  REPOSSESSED: 'ยึดคืนแล้ว',
  UNDER_REPAIR: 'กำลังซ่อม',
  READY_FOR_SALE: 'พร้อมขาย',
  SOLD: 'ขายแล้ว',
};

const statusColors: Record<string, string> = {
  REPOSSESSED: 'bg-red-100 text-red-700',
  UNDER_REPAIR: 'bg-yellow-100 text-yellow-700',
  READY_FOR_SALE: 'bg-green-100 text-green-700',
  SOLD: 'bg-primary-100 text-primary-700',
};

const gradeColors: Record<string, string> = {
  A: 'bg-green-100 text-green-700',
  B: 'bg-primary-100 text-primary-700',
  C: 'bg-yellow-100 text-yellow-700',
  D: 'bg-red-100 text-red-700',
};

export default function RepossessionsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<Repossession | null>(null);
  const [createForm, setCreateForm] = useState({
    contractId: '',
    repossessedDate: new Date().toISOString().split('T')[0],
    conditionGrade: 'C',
    appraisalPrice: '',
    repairCost: '0',
    notes: '',
  });
  const [updateForm, setUpdateForm] = useState({
    repairCost: '',
    resellPrice: '',
    status: '',
    notes: '',
  });

  // Fetch contracts that can be repossessed (OVERDUE or DEFAULT)
  const { data: overdueContracts = [] } = useQuery<{ id: string; contractNumber: string; customer: { name: string }; product: { name: string } }[]>({
    queryKey: ['contracts-for-repo'],
    queryFn: async () => {
      const [overdue, defaulted] = await Promise.all([
        api.get('/contracts?status=OVERDUE'),
        api.get('/contracts?status=DEFAULT'),
      ]);
      return [...(overdue.data.data || []), ...(defaulted.data.data || [])];
    },
  });

  const { data: repos = [], isLoading } = useQuery<Repossession[]>({
    queryKey: ['repossessions', statusFilter],
    queryFn: async () => {
      const params = statusFilter ? `?status=${statusFilter}` : '';
      return (await api.get(`/repossessions${params}`)).data;
    },
  });

  const { data: profitLoss } = useQuery({
    queryKey: ['repossessions-pl'],
    queryFn: async () => (await api.get('/repossessions/profit-loss')).data,
  });

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => api.post('/repossessions', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repossessions'] });
      toast.success('บันทึกการยึดคืนสำเร็จ');
      setIsCreateModalOpen(false);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.patch(`/repossessions/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repossessions'] });
      queryClient.invalidateQueries({ queryKey: ['repossessions-pl'] });
      toast.success('อัพเดทสำเร็จ');
      setIsUpdateModalOpen(false);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const openUpdate = (repo: Repossession) => {
    setSelectedRepo(repo);
    setUpdateForm({
      repairCost: repo.repairCost,
      resellPrice: repo.resellPrice || '',
      status: repo.status,
      notes: repo.notes || '',
    });
    setIsUpdateModalOpen(true);
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      ...createForm,
      appraisalPrice: Number(createForm.appraisalPrice),
      repairCost: Number(createForm.repairCost),
    });
  };

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRepo) return;
    updateMutation.mutate({
      id: selectedRepo.id,
      data: {
        repairCost: Number(updateForm.repairCost),
        resellPrice: updateForm.resellPrice ? Number(updateForm.resellPrice) : undefined,
        status: updateForm.status,
        notes: updateForm.notes,
      },
    });
  };

  const columns = [
    {
      key: 'contract',
      label: 'สัญญา',
      render: (r: Repossession) => (
        <div>
          <div className="font-medium text-primary-600">{r.contract.contractNumber}</div>
          <div className="text-xs text-gray-500">{r.contract.customer.name}</div>
        </div>
      ),
    },
    {
      key: 'product',
      label: 'สินค้า',
      render: (r: Repossession) => (
        <div className="text-sm">
          {r.product.brand} {r.product.model}
          {r.product.imeiSerial && (
            <div className="text-xs text-gray-400">{r.product.imeiSerial}</div>
          )}
        </div>
      ),
    },
    {
      key: 'grade',
      label: 'สภาพ',
      render: (r: Repossession) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${gradeColors[r.conditionGrade]}`}>
          เกรด {r.conditionGrade}
        </span>
      ),
    },
    {
      key: 'appraisalPrice',
      label: 'ราคาตี',
      render: (r: Repossession) => (
        <span className="text-sm">{Number(r.appraisalPrice).toLocaleString()} บาท</span>
      ),
    },
    {
      key: 'resellPrice',
      label: 'ราคาขาย',
      render: (r: Repossession) =>
        r.resellPrice ? (
          <span className="text-sm">{Number(r.resellPrice).toLocaleString()} บาท</span>
        ) : (
          <span className="text-xs text-gray-400">ยังไม่กำหนด</span>
        ),
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (r: Repossession) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[r.status]}`}>
          {statusLabels[r.status]}
        </span>
      ),
    },
    {
      key: 'date',
      label: 'วันที่ยึด',
      render: (r: Repossession) => (
        <span className="text-sm">{new Date(r.repossessedDate).toLocaleDateString('th-TH')}</span>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (r: Repossession) => (
        <button
          onClick={() => openUpdate(r)}
          className="text-primary-600 hover:text-primary-700 text-sm font-medium"
        >
          จัดการ
        </button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="ยึดคืน & ขายต่อ"
        subtitle="จัดการเครื่องที่ยึดคืนจากลูกค้า"
        action={
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors"
          >
            + บันทึกการยึดคืน
          </button>
        }
      />

      {/* Profit/Loss Summary */}
      {profitLoss?.summary && (
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-4 mb-6">
          <div className="bg-white rounded-lg border p-4">
            <div className="text-sm text-gray-500">เครื่องที่ขายแล้ว</div>
            <div className="text-2xl font-bold">{profitLoss.summary.count}</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-sm text-gray-500">ราคาตีรวม</div>
            <div className="text-lg font-bold">{profitLoss.summary.totalAppraisal?.toLocaleString()} บาท</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-sm text-gray-500">ค่าซ่อมรวม</div>
            <div className="text-lg font-bold">{profitLoss.summary.totalRepairCost?.toLocaleString()} บาท</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-sm text-gray-500">ราคาขายรวม</div>
            <div className="text-lg font-bold">{profitLoss.summary.totalResellPrice?.toLocaleString()} บาท</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-sm text-gray-500">กำไร/ขาดทุน</div>
            <div className={`text-lg font-bold ${(profitLoss.summary.totalProfit ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {profitLoss.summary.totalProfit?.toLocaleString()} บาท
            </div>
          </div>
        </div>
      )}

      {/* Itemized P&L Table */}
      {(profitLoss?.items?.length ?? 0) > 0 && (
        <div className="bg-white rounded-lg border mb-6 overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50">
            <h3 className="text-sm font-medium text-gray-700">รายละเอียดกำไร/ขาดทุน</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs">
                <tr>
                  <th className="px-4 py-2 text-left">สัญญา</th>
                  <th className="px-4 py-2 text-left">ลูกค้า</th>
                  <th className="px-4 py-2 text-left">สินค้า</th>
                  <th className="px-4 py-2 text-center">เกรด</th>
                  <th className="px-4 py-2 text-right">ราคาตี</th>
                  <th className="px-4 py-2 text-right">ค่าซ่อม</th>
                  <th className="px-4 py-2 text-right">ราคาขาย</th>
                  <th className="px-4 py-2 text-right">กำไร</th>
                  <th className="px-4 py-2 text-right">Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {profitLoss?.items?.map((item: { id: string; contract: string; customer: string; product: string; conditionGrade: string; appraisalPrice: number; repairCost: number; resellPrice: number; profit: number; marginPct: string }) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium text-primary-600">{item.contract}</td>
                    <td className="px-4 py-2">{item.customer}</td>
                    <td className="px-4 py-2">{item.product}</td>
                    <td className="px-4 py-2 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${gradeColors[item.conditionGrade] || ''}`}>
                        {item.conditionGrade}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">{item.appraisalPrice.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right">{item.repairCost.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right">{item.resellPrice.toLocaleString()}</td>
                    <td className={`px-4 py-2 text-right font-medium ${item.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {item.profit.toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-500">{item.marginPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="mb-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
        >
          <option value="">ทุกสถานะ</option>
          <option value="REPOSSESSED">ยึดคืนแล้ว</option>
          <option value="UNDER_REPAIR">กำลังซ่อม</option>
          <option value="READY_FOR_SALE">พร้อมขาย</option>
          <option value="SOLD">ขายแล้ว</option>
        </select>
      </div>

      <DataTable columns={columns} data={repos} isLoading={isLoading} emptyMessage="ยังไม่มีการยึดคืน" />

      {/* Create Modal */}
      <Modal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} title="บันทึกการยึดคืน" size="lg">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">เลือกสัญญา (OVERDUE/DEFAULT) *</label>
            <select
              value={createForm.contractId}
              onChange={(e) => setCreateForm({ ...createForm, contractId: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
              required
            >
              <option value="">-- เลือกสัญญา --</option>
              {overdueContracts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.contractNumber} - {c.customer.name} ({c.product.name})
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">วันที่ยึดคืน *</label>
              <input
                type="date"
                value={createForm.repossessedDate}
                onChange={(e) => setCreateForm({ ...createForm, repossessedDate: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">สภาพเครื่อง *</label>
              <select
                value={createForm.conditionGrade}
                onChange={(e) => setCreateForm({ ...createForm, conditionGrade: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
              >
                <option value="A">A - ดีมาก</option>
                <option value="B">B - ดี</option>
                <option value="C">C - พอใช้</option>
                <option value="D">D - เสียหาย</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ราคาตี (บาท) *</label>
              <input
                type="number"
                value={createForm.appraisalPrice}
                onChange={(e) => setCreateForm({ ...createForm, appraisalPrice: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ค่าซ่อม (บาท)</label>
              <input
                type="number"
                value={createForm.repairCost}
                onChange={(e) => setCreateForm({ ...createForm, repairCost: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุ</label>
            <textarea
              value={createForm.notes}
              onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setIsCreateModalOpen(false)} className="px-4 py-2 text-sm text-gray-600">
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              {createMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Update Modal */}
      <Modal isOpen={isUpdateModalOpen} onClose={() => setIsUpdateModalOpen(false)} title="จัดการเครื่องยึดคืน">
        {selectedRepo && (
          <form onSubmit={handleUpdate} className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-3 text-sm">
              <div><strong>สินค้า:</strong> {selectedRepo.product.brand} {selectedRepo.product.model}</div>
              <div><strong>สัญญา:</strong> {selectedRepo.contract.contractNumber}</div>
              <div><strong>ลูกค้า:</strong> {selectedRepo.contract.customer.name}</div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">สถานะ</label>
              <select
                value={updateForm.status}
                onChange={(e) => setUpdateForm({ ...updateForm, status: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
              >
                <option value="REPOSSESSED">ยึดคืนแล้ว</option>
                <option value="UNDER_REPAIR">กำลังซ่อม</option>
                <option value="READY_FOR_SALE">พร้อมขาย</option>
                <option value="SOLD">ขายแล้ว</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ค่าซ่อม (บาท)</label>
                <input
                  type="number"
                  value={updateForm.repairCost}
                  onChange={(e) => setUpdateForm({ ...updateForm, repairCost: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ราคาขายต่อ (บาท)</label>
                <input
                  type="number"
                  value={updateForm.resellPrice}
                  onChange={(e) => setUpdateForm({ ...updateForm, resellPrice: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุ</label>
              <textarea
                value={updateForm.notes}
                onChange={(e) => setUpdateForm({ ...updateForm, notes: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setIsUpdateModalOpen(false)} className="px-4 py-2 text-sm text-gray-600">
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={updateMutation.isPending}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
              >
                {updateMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
