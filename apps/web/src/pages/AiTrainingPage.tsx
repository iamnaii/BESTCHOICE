import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Brain, Upload, CheckCircle, Database, RefreshCw } from 'lucide-react';

interface TrainingStats {
  totalPairs: number;
  usablePairs: number;
  bySource: Record<string, number>;
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  sub?: string;
}

function StatCard({ icon, label, value, sub }: StatCardProps) {
  return (
    <div className="bg-card rounded-xl p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className="text-2xl font-bold text-foreground">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

export default function AiTrainingPage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const statsQuery = useQuery<TrainingStats>({
    queryKey: ['ai-training-stats'],
    queryFn: () => api.get('/staff-chat/ai/training-stats').then((r: any) => r.data),
  });

  const reExtractMutation = useMutation({
    mutationFn: () => api.post('/staff-chat/ai/training-extract'),
    onSuccess: (res: any) => {
      const count = res.data?.created ?? 0;
      toast.success(`สกัด ${count} training pairs สำเร็จ`);
      queryClient.invalidateQueries({ queryKey: ['ai-training-stats'] });
    },
    onError: () => {
      toast.error('สกัดข้อมูลไม่สำเร็จ — กรุณาลองใหม่อีกครั้ง');
    },
  });

  const importMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return api.post('/staff-chat/ai/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: (res: any) => {
      const count = res.data?.imported ?? res.data?.count ?? '?';
      toast.success(`นำเข้าสำเร็จ ${count} รายการ`);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      queryClient.invalidateQueries({ queryKey: ['ai-training-stats'] });
    },
    onError: () => {
      toast.error('นำเข้าไม่สำเร็จ — ตรวจสอบรูปแบบไฟล์อีกครั้ง');
    },
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFile) return;
    importMutation.mutate(selectedFile);
  }

  const stats = statsQuery.data;

  return (
    <div>
      <PageHeader title="AI Training" subtitle="จัดการข้อมูล training สำหรับ AI" />

      {/* Re-extract action */}
      <div className="flex justify-end mb-4">
        <Button
          type="button"
          onClick={() => reExtractMutation.mutate()}
          disabled={reExtractMutation.isPending}
          className="flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${reExtractMutation.isPending ? 'animate-spin' : ''}`} />
          {reExtractMutation.isPending ? 'กำลังสกัด...' : 'Re-extract จาก Chat History'}
        </Button>
      </div>

      {/* Stats */}
      <QueryBoundary
        isLoading={statsQuery.isLoading}
        isError={statsQuery.isError}
        error={statsQuery.error}
        onRetry={() => statsQuery.refetch()}
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard
            icon={<Database className="w-4 h-4 text-muted-foreground" />}
            label="Training Pairs ทั้งหมด"
            value={(stats?.totalPairs ?? 0).toLocaleString()}
          />
          <StatCard
            icon={<CheckCircle className="w-4 h-4 text-success" />}
            label="Pairs ใช้ได้ (quality ≥ 0.7)"
            value={(stats?.usablePairs ?? 0).toLocaleString()}
            sub={
              stats?.totalPairs
                ? `${Math.round(((stats.usablePairs ?? 0) / stats.totalPairs) * 100)}% ของทั้งหมด`
                : undefined
            }
          />
          {Object.entries(stats?.bySource ?? {}).slice(0, 2).map(([source, count]) => (
            <StatCard
              key={source}
              icon={<Brain className="w-4 h-4 text-muted-foreground" />}
              label={source}
              value={(count as number).toLocaleString()}
              sub="pairs"
            />
          ))}
        </div>

        {/* Source breakdown if more than 2 */}
        {Object.keys(stats?.bySource ?? {}).length > 2 && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-base">แหล่งข้อมูลทั้งหมด</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {Object.entries(stats?.bySource ?? {}).map(([source, count]) => (
                  <div key={source} className="flex justify-between items-center text-sm">
                    <span className="text-foreground">{source}</span>
                    <span className="font-medium text-foreground">{(count as number).toLocaleString()} pairs</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </QueryBoundary>

      {/* Import */}
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="w-4 h-4 text-muted-foreground" />
            นำเข้าข้อมูลจาก Chatcone
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div
              className="border-2 border-dashed border-border rounded-xl p-6 text-center hover:border-primary transition-colors cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              {selectedFile ? (
                <p className="text-sm text-foreground font-medium">{selectedFile.name}</p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">คลิกเพื่อเลือกไฟล์</p>
                  <p className="text-xs text-muted-foreground mt-1">รองรับ .csv และ .json</p>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.json"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>

            <Button
              type="submit"
              disabled={!selectedFile || importMutation.isPending}
              className="w-full"
            >
              {importMutation.isPending ? 'กำลังนำเข้า...' : 'นำเข้าข้อมูล'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
