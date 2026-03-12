import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import Modal from '@/components/ui/Modal';
import { useAuth } from '@/contexts/AuthContext';

interface TemplateItem {
  id: string;
  category: string;
  itemName: string;
  scoreType: string;
  isRequired: boolean;
  weight: string;
  sortOrder: number;
}

interface Result {
  id: string;
  templateItemId: string;
  passFail: boolean | null;
  grade: string | null;
  score: string | null;
  numberValue: string | null;
  notes: string | null;
  templateItem: TemplateItem;
}

interface InspectionDetail {
  id: string;
  overallGrade: string | null;
  gradeOverride: string | null;
  overrideReason: string | null;
  isCompleted: boolean;
  inspectedAt: string | null;
  photos: string[];
  notes: string | null;
  createdAt: string;
  template: { id: string; name: string; items: TemplateItem[] };
  inspector: { id: string; name: string };
  products: { id: string; name: string; brand: string; model: string; imeiSerial: string | null }[];
  results: Result[];
}

const gradeColors: Record<string, string> = {
  A: 'bg-green-100 text-green-700 border-green-200',
  B: 'bg-primary-100 text-primary-700 border-primary-200',
  C: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  D: 'bg-red-100 text-red-700 border-red-200',
};

export default function InspectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isManager = user?.role === 'OWNER' || user?.role === 'BRANCH_MANAGER';

  const [isOverrideModalOpen, setIsOverrideModalOpen] = useState(false);
  const [overrideForm, setOverrideForm] = useState({ grade: '', reason: '' });
  const [resultValues, setResultValues] = useState<Record<string, Record<string, unknown>>>({});
  const [initialized, setInitialized] = useState(false);

  const { data: inspection, isLoading } = useQuery<InspectionDetail>({
    queryKey: ['inspection', id],
    queryFn: async () => {
      const { data } = await api.get(`/inspections/${id}`);
      return data;
    },
  });

  // Initialize result values only once when data first loads
  useEffect(() => {
    if (inspection && !initialized) {
      const values: Record<string, Record<string, unknown>> = {};
      inspection.results.forEach((r: Result) => {
        values[r.templateItemId] = {
          passFail: r.passFail,
          grade: r.grade,
          score: r.score ? parseFloat(r.score as string) : null,
          numberValue: r.numberValue ? parseFloat(r.numberValue as string) : null,
          notes: r.notes,
        };
      });
      setResultValues(values);
      setInitialized(true);
    }
  }, [inspection, initialized]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const results = Object.entries(resultValues).map(([templateItemId, vals]) => ({
        templateItemId,
        ...vals,
      }));
      return api.patch(`/inspections/${id}`, { results });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspection', id] });
      toast.success('บันทึกผลตรวจสำเร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const completeMutation = useMutation({
    mutationFn: async () => api.post(`/inspections/${id}/complete`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspection', id] });
      toast.success('ส่งผลตรวจเสร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const overrideMutation = useMutation({
    mutationFn: async () => api.patch(`/inspections/${id}/override-grade`, overrideForm),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspection', id] });
      toast.success('เปลี่ยนเกรดสำเร็จ');
      setIsOverrideModalOpen(false);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const updateResult = (itemId: string, field: string, value: unknown) => {
    setResultValues((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], [field]: value },
    }));
  };

  if (isLoading || !inspection) {
    return <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;
  }

  const product = inspection.products[0];
  const finalGrade = inspection.gradeOverride || inspection.overallGrade;

  // Group items by category
  const grouped = inspection.template.items.reduce<Record<string, TemplateItem[]>>((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});

  return (
    <div>
      <PageHeader
        title={`ตรวจเช็ค: ${product?.brand} ${product?.model}`}
        subtitle={product?.imeiSerial || inspection.template.name}
        action={
          <div className="flex gap-2">
            {!inspection.isCompleted && (
              <>
                <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="px-4 py-2 text-sm text-primary-600 border border-primary-300 rounded-lg hover:bg-primary-50 disabled:opacity-50">
                  บันทึก
                </button>
                <button onClick={() => completeMutation.mutate()} disabled={completeMutation.isPending} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
                  ส่งผลตรวจ
                </button>
              </>
            )}
            {inspection.isCompleted && isManager && (
              <button onClick={() => setIsOverrideModalOpen(true)} className="px-4 py-2 text-sm text-orange-600 border border-orange-300 rounded-lg hover:bg-orange-50">
                Override เกรด
              </button>
            )}
            <button onClick={() => navigate('/inspections')} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg">กลับ</button>
          </div>
        }
      />

      {/* Grade Summary */}
      {finalGrade && (
        <div className={`rounded-lg border-2 p-4 mb-6 ${gradeColors[finalGrade]}`}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">เกรดรวม</div>
              <div className="text-3xl font-bold">{finalGrade}</div>
            </div>
            {inspection.gradeOverride && (
              <div className="text-right text-sm">
                <div>เกรดเดิม: {inspection.overallGrade}</div>
                <div className="text-xs opacity-75">เหตุผล: {inspection.overrideReason}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Checklist */}
      <div className="space-y-6">
        {Object.entries(grouped).map(([category, items]) => (
          <div key={category} className="bg-white rounded-lg border p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-4">{category}</h3>
            <div className="space-y-4">
              {items.map((item) => {
                const val = resultValues[item.id] || {};
                return (
                  <div key={item.id} className="flex items-start gap-4 py-2 border-b border-gray-50 last:border-0">
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-800">
                        {item.itemName}
                        {item.isRequired && <span className="text-red-500 ml-1">*</span>}
                      </div>
                    </div>
                    <div className="w-48">
                      {item.scoreType === 'PASS_FAIL' && (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={inspection.isCompleted}
                            onClick={() => updateResult(item.id, 'passFail', true)}
                            className={`px-3 py-1 rounded text-xs font-medium ${val.passFail === true ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600'}`}
                          >ผ่าน</button>
                          <button
                            type="button"
                            disabled={inspection.isCompleted}
                            onClick={() => updateResult(item.id, 'passFail', false)}
                            className={`px-3 py-1 rounded text-xs font-medium ${val.passFail === false ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600'}`}
                          >ไม่ผ่าน</button>
                        </div>
                      )}
                      {item.scoreType === 'GRADE' && (
                        <div className="flex gap-1">
                          {['A', 'B', 'C', 'D'].map((g) => (
                            <button
                              key={g}
                              type="button"
                              disabled={inspection.isCompleted}
                              onClick={() => updateResult(item.id, 'grade', g)}
                              className={`px-2.5 py-1 rounded text-xs font-bold ${val.grade === g ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600'}`}
                            >{g}</button>
                          ))}
                        </div>
                      )}
                      {item.scoreType === 'SCORE_1_5' && (
                        <div className="flex gap-1">
                          {[1, 2, 3, 4, 5].map((s) => (
                            <button
                              key={s}
                              type="button"
                              disabled={inspection.isCompleted}
                              onClick={() => updateResult(item.id, 'score', s)}
                              className={`w-8 h-8 rounded text-xs font-bold ${Number(val.score) === s ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600'}`}
                            >{s}</button>
                          ))}
                        </div>
                      )}
                      {item.scoreType === 'NUMBER' && (
                        <input
                          type="number"
                          disabled={inspection.isCompleted}
                          value={val.numberValue?.toString() || ''}
                          onChange={(e) => updateResult(item.id, 'numberValue', parseFloat(e.target.value) || 0)}
                          placeholder="ตัวเลข"
                          className="w-full px-2 py-1 border rounded text-sm outline-none"
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Override Modal */}
      <Modal isOpen={isOverrideModalOpen} onClose={() => setIsOverrideModalOpen(false)} title="Override เกรด">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">เกรดใหม่ *</label>
            <select value={overrideForm.grade} onChange={(e) => setOverrideForm({ ...overrideForm, grade: e.target.value })} className="w-full px-3 py-2 border rounded-lg outline-none text-sm">
              <option value="">เลือกเกรด</option>
              {['A', 'B', 'C', 'D'].map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">เหตุผล *</label>
            <textarea value={overrideForm.reason} onChange={(e) => setOverrideForm({ ...overrideForm, reason: e.target.value })} rows={3} className="w-full px-3 py-2 border rounded-lg outline-none text-sm resize-none" required />
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={() => setIsOverrideModalOpen(false)} className="px-4 py-2 text-sm text-gray-600">ยกเลิก</button>
            <button onClick={() => overrideMutation.mutate()} disabled={!overrideForm.grade || !overrideForm.reason} className="px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">ยืนยัน</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
