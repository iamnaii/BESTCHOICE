import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Sparkles } from 'lucide-react';

const CHANNELS = [
  { value: 'LINE_FINANCE', label: 'LINE Finance' },
  { value: 'LINE_SHOP', label: 'LINE Shop' },
  { value: 'FACEBOOK', label: 'Facebook' },
  { value: 'TIKTOK', label: 'TikTok' },
  { value: 'WEB', label: 'Web' },
] as const;

interface AiSettings {
  autoModeEnabled: boolean;
  enabledChannels: string[];
  confidenceThreshold: number;
  maxRepliesPerSession: number;
}

function AiSettingsForm({ initial }: { initial: AiSettings }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<AiSettings>(initial);

  useEffect(() => {
    setForm(initial);
  }, [initial]);

  const mutation = useMutation({
    mutationFn: (data: AiSettings) => api.patch('/staff-chat/ai/settings', {
      aiAutoEnabled: data.autoModeEnabled,
      aiAutoChannels: data.enabledChannels,
      aiAutoConfidenceThreshold: data.confidenceThreshold,
      aiAutoMaxRepliesPerSession: data.maxRepliesPerSession,
    }),
    onSuccess: () => {
      toast.success('บันทึกการตั้งค่า AI เรียบร้อย');
      queryClient.invalidateQueries({ queryKey: ['ai-settings'] });
    },
    onError: () => {
      toast.error('ไม่สามารถบันทึกการตั้งค่าได้');
    },
  });

  function toggleChannel(channel: string) {
    setForm((prev) => ({
      ...prev,
      enabledChannels: prev.enabledChannels.includes(channel)
        ? prev.enabledChannels.filter((c) => c !== channel)
        : [...prev.enabledChannels, channel],
    }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    mutation.mutate(form);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* AI Auto Mode toggle */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-muted-foreground" />
            AI Auto Mode
          </CardTitle>
        </CardHeader>
        <CardContent>
          <label className="flex items-center gap-3 cursor-pointer">
            <Switch
              checked={form.autoModeEnabled}
              onCheckedChange={(checked) => setForm((prev) => ({ ...prev, autoModeEnabled: checked }))}
            />
            <span className="text-sm text-foreground">
              {form.autoModeEnabled ? 'เปิดใช้งาน — AI จะตอบอัตโนมัติ' : 'ปิดใช้งาน — ไม่มีการตอบอัตโนมัติ'}
            </span>
          </label>
        </CardContent>
      </Card>

      {/* Channels */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">ช่องทางที่เปิดใช้</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {CHANNELS.map((ch) => (
              <label
                key={ch.value}
                className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${
                  form.enabledChannels.includes(ch.value)
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-card hover:bg-accent'
                }`}
              >
                <input
                  type="checkbox"
                  checked={form.enabledChannels.includes(ch.value)}
                  onChange={() => toggleChannel(ch.value)}
                  className="accent-primary"
                />
                <span className="text-sm text-foreground">{ch.label}</span>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Confidence threshold */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">ความมั่นใจขั้นต่ำ (Confidence Threshold)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">ยิ่งสูง AI ยิ่งตอบน้อย แต่แม่นกว่า</span>
            <span className="text-lg font-bold text-primary">{form.confidenceThreshold}%</span>
          </div>
          <Slider
            value={[form.confidenceThreshold]}
            onValueChange={([val]) => setForm((prev) => ({ ...prev, confidenceThreshold: val }))}
            min={0}
            max={100}
            step={1}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0% — ตอบมาก</span>
            <span>100% — ตอบเฉพาะที่แน่ใจมาก</span>
          </div>
        </CardContent>
      </Card>

      {/* Max replies per session */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">จำนวนตอบสูงสุดต่อ Session</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Input
              type="number"
              min={1}
              max={100}
              value={form.maxRepliesPerSession}
              onChange={(e) => setForm((prev) => ({ ...prev, maxRepliesPerSession: Number(e.target.value) }))}
              className="w-28"
            />
            <span className="text-sm text-muted-foreground">ครั้ง — หลังจากนี้จะโอนให้พนักงาน</span>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า'}
        </Button>
      </div>
    </form>
  );
}

export default function AiSettingsPage() {
  const settingsQuery = useQuery<AiSettings>({
    queryKey: ['ai-settings'],
    queryFn: () => api.get('/staff-chat/ai/settings').then((r: any) => {
      const d = r.data?.data ?? r.data;
      return {
        autoModeEnabled: d.aiAutoEnabled ?? false,
        enabledChannels: d.aiAutoChannels ?? [],
        confidenceThreshold: d.aiAutoConfidenceThreshold ?? 70,
        maxRepliesPerSession: d.aiAutoMaxRepliesPerSession ?? 5,
      };
    }),
  });

  const defaultSettings: AiSettings = {
    autoModeEnabled: false,
    enabledChannels: [],
    confidenceThreshold: 70,
    maxRepliesPerSession: 5,
  };

  return (
    <div>
      <PageHeader title="AI Settings" subtitle="ตั้งค่า AI Auto Mode สำหรับตอบแชทอัตโนมัติ" />
      <div className="max-w-2xl">
        <QueryBoundary
          isLoading={settingsQuery.isLoading}
          isError={settingsQuery.isError}
          error={settingsQuery.error}
          onRetry={() => settingsQuery.refetch()}
        >
          <AiSettingsForm initial={settingsQuery.data ?? defaultSettings} />
        </QueryBoundary>
      </div>
    </div>
  );
}
