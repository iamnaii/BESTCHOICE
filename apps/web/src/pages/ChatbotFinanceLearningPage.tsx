import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { toast } from 'sonner';
import QueryBoundary from '@/components/QueryBoundary';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, kbSuggestionStatusMap, kbSuggestionSourceMap } from '@/lib/status-badges';

interface LearningStats {
  suggestions: { pending: number; approved: number; rejected: number };
  feedback: { total: number; positiveRate: number };
}

interface KbSuggestion {
  id: string;
  roomId: string;
  customerQuestion: string;
  staffAnswer: string | null;
  suggestedIntent: string;
  suggestedKeywords: string[];
  suggestedTemplate: string | null;
  source: string;
  status: string;
  reviewedAt: string | null;
  createdAt: string;
}

function StatCard({ label, value, accent = 'blue' }: { label: string; value: string | number; accent?: 'blue' | 'orange' | 'green' | 'red' }) {
  const colors = {
    blue: 'border-blue-200 bg-blue-50',
    orange: 'border-orange-200 bg-orange-50',
    green: 'border-green-200 bg-green-50',
    red: 'border-red-200 bg-red-50',
  };
  return (
    <div className={`rounded-xl border p-4 ${colors[accent]}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  const cfg = getStatusBadgeProps(source, kbSuggestionSourceMap);
  return (
    <Badge variant={cfg.variant} appearance={cfg.appearance} className="text-[10px] px-2 py-0.5">
      {cfg.label}
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg = getStatusBadgeProps(status, kbSuggestionStatusMap);
  return (
    <Badge variant={cfg.variant} appearance={cfg.appearance} className="text-[10px] px-2 py-0.5">
      {cfg.label}
    </Badge>
  );
}

export default function ChatbotFinanceLearningPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('PENDING');
  const [selectedSuggestion, setSelectedSuggestion] = useState<KbSuggestion | null>(null);

  const stats = useQuery<LearningStats>({
    queryKey: ['chatbot-learning-stats'],
    queryFn: async () => {
      const { data } = await api.get<LearningStats>('/chatbot/finance/admin/learning/stats');
      return data;
    },
    refetchInterval: 30_000,
  });

  const suggestions = useQuery<{ items: KbSuggestion[]; total: number }>({
    queryKey: ['chatbot-learning-suggestions', statusFilter],
    queryFn: async () => {
      const { data } = await api.get('/chatbot/finance/admin/learning/suggestions', {
        params: { status: statusFilter, page: 1, limit: 50 },
      });
      return data as { items: KbSuggestion[]; total: number };
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/chatbot/finance/admin/learning/suggestions/${id}/approve`);
    },
    onSuccess: () => {
      toast.success('Approve แล้ว — สร้าง KB entry ใหม่');
      queryClient.invalidateQueries({ queryKey: ['chatbot-learning'] });
      queryClient.invalidateQueries({ queryKey: ['chatbot-finance-kb'] });
      setSelectedSuggestion(null);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/chatbot/finance/admin/learning/suggestions/${id}/reject`);
    },
    onSuccess: () => {
      toast.success('Reject แล้ว');
      queryClient.invalidateQueries({ queryKey: ['chatbot-learning'] });
      setSelectedSuggestion(null);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <div>
      <PageHeader
        title="Finance Bot — Learning Hub"
        subtitle="ตรวจสอบและอนุมัติข้อเสนอแนะสำหรับ Knowledge Base"
      />

      {/* Stats */}
      <QueryBoundary
        isLoading={stats.isLoading && !stats.data}
        isError={stats.isError}
        error={stats.error}
        onRetry={stats.refetch}
        errorTitle="ไม่สามารถโหลดสถิติได้"
      >
        <div className="grid grid-cols-5 gap-3 mb-6">
          <StatCard label="Pending" value={stats.data?.suggestions.pending ?? 0} accent="orange" />
          <StatCard label="Approved" value={stats.data?.suggestions.approved ?? 0} accent="green" />
          <StatCard label="Rejected" value={stats.data?.suggestions.rejected ?? 0} />
          <StatCard label="Feedback ทั้งหมด" value={stats.data?.feedback.total ?? 0} />
          <StatCard
            label="Feedback บวก"
            value={`${stats.data?.feedback.positiveRate ?? 0}%`}
            accent={
              (stats.data?.feedback.positiveRate ?? 0) >= 80 ? 'green' :
              (stats.data?.feedback.positiveRate ?? 0) >= 50 ? 'orange' : 'red'
            }
          />
        </div>
      </QueryBoundary>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4">
        {['PENDING', 'APPROVED', 'REJECTED'].map((s) => (
          <button
            key={s}
            onClick={() => { setStatusFilter(s); setSelectedSuggestion(null); }}
            className={`px-4 py-1.5 rounded-full text-sm ${
              statusFilter === s
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {s} {s === 'PENDING' && stats.data?.suggestions.pending ? `(${stats.data.suggestions.pending})` : ''}
          </button>
        ))}
      </div>

      {/* Suggestions list + detail */}
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-5 space-y-2 max-h-[70vh] overflow-y-auto">
          <QueryBoundary
            isLoading={suggestions.isLoading && !suggestions.data}
            isError={suggestions.isError}
            error={suggestions.error}
            onRetry={suggestions.refetch}
            errorTitle="ไม่สามารถโหลด suggestions ได้"
          >
            {suggestions.data?.items.length === 0 ? (
              <p className="text-sm text-gray-400 p-4">ไม่มี suggestions สถานะ {statusFilter}</p>
            ) : (
              suggestions.data?.items.map((s) => (
                <div
                  key={s.id}
                  onClick={() => setSelectedSuggestion(s)}
                  className={`p-3 border rounded-lg cursor-pointer hover:bg-gray-50 ${
                    selectedSuggestion?.id === s.id ? 'border-blue-400 bg-blue-50' : 'bg-white'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <p className="text-sm font-medium line-clamp-2">{s.customerQuestion}</p>
                    <div className="flex flex-col items-end gap-1 ml-2 shrink-0">
                      <SourceBadge source={s.source} />
                      <StatusBadge status={s.status} />
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(s.createdAt).toLocaleDateString('th-TH')} — {s.suggestedIntent}
                  </p>
                </div>
              ))
            )}
          </QueryBoundary>
        </div>

        {/* Detail */}
        <div className="col-span-7 bg-white border rounded-xl p-5">
          {!selectedSuggestion ? (
            <p className="text-gray-400 text-sm">เลือก suggestion จากด้านซ้ายเพื่อดูรายละเอียด</p>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-between items-start">
                <h2 className="font-bold">รายละเอียด Suggestion</h2>
                <div className="flex gap-1">
                  <SourceBadge source={selectedSuggestion.source} />
                  <StatusBadge status={selectedSuggestion.status} />
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500">คำถามลูกค้า</label>
                <p className="text-sm bg-yellow-50 p-3 rounded-lg mt-1">{selectedSuggestion.customerQuestion}</p>
              </div>

              {selectedSuggestion.staffAnswer && (
                <div>
                  <label className="text-xs text-gray-500">คำตอบจากพนักงาน</label>
                  <p className="text-sm bg-green-50 p-3 rounded-lg mt-1 whitespace-pre-wrap">{selectedSuggestion.staffAnswer}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">Intent</label>
                  <p className="text-sm font-mono mt-1">{selectedSuggestion.suggestedIntent}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Source</label>
                  <p className="text-sm mt-1">{selectedSuggestion.source}</p>
                </div>
              </div>

              {selectedSuggestion.suggestedKeywords.length > 0 && (
                <div>
                  <label className="text-xs text-gray-500">Keywords</label>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {selectedSuggestion.suggestedKeywords.map((kw, i) => (
                      <span key={i} className="text-xs bg-gray-100 px-2 py-0.5 rounded">{kw}</span>
                    ))}
                  </div>
                </div>
              )}

              {selectedSuggestion.suggestedTemplate && (
                <div>
                  <label className="text-xs text-gray-500">Suggested Template</label>
                  <p className="text-sm bg-blue-50 p-3 rounded-lg mt-1 whitespace-pre-wrap">{selectedSuggestion.suggestedTemplate}</p>
                </div>
              )}

              {selectedSuggestion.status === 'PENDING' && (
                <div className="flex gap-2 pt-3 border-t">
                  <button
                    onClick={() => approveMutation.mutate(selectedSuggestion.id)}
                    disabled={approveMutation.isPending}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50"
                  >
                    {approveMutation.isPending ? 'กำลัง...' : 'Approve → สร้าง KB'}
                  </button>
                  <button
                    onClick={() => rejectMutation.mutate(selectedSuggestion.id)}
                    disabled={rejectMutation.isPending}
                    className="px-4 py-2 border border-red-300 text-red-600 rounded-lg text-sm hover:bg-red-50 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              )}

              {selectedSuggestion.reviewedAt && (
                <p className="text-xs text-gray-400">
                  Reviewed: {new Date(selectedSuggestion.reviewedAt).toLocaleString('th-TH')}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
