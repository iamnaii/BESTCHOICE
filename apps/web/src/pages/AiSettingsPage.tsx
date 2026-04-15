import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
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
    mutationFn: (data: AiSettings) => api.patch('/staff-chat/ai/settings', data),
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
            <Sparkles className="w-4 h-4 text-purple-500" />
            AI Auto Mode
          </CardTitle>
        </CardHeader>
        <CardContent>
          <label className="flex items-center gap-3 cursor-pointer">
            <button
              type="button"
              role="switch"
              aria-checked={form.autoModeEnabled}
              onClick={() => setForm((prev) => ({ ...prev, autoModeEnabled: !prev.autoModeEnabled }))}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 ${
                form.autoModeEnabled ? 'bg-purple-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  form.autoModeEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <span className="text-sm text-gray-700">
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
                    ? 'border-purple-400 bg-purple-50'
                    : 'border-gray-200 bg-white hover:bg-gray-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={form.enabledChannels.includes(ch.value)}
                  onChange={() => toggleChannel(ch.value)}
                  className="accent-purple-600"
                />
                <span className="text-sm text-gray-700">{ch.label}</span>
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
            <span className="text-sm text-gray-500">ยิ่งสูง AI ยิ่งตอบน้อย แต่แม่นกว่า</span>
            <span className="text-lg font-bold text-purple-600">{form.confidenceThreshold}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={form.confidenceThreshold}
            onChange={(e) => setForm((prev) => ({ ...prev, confidenceThreshold: Number(e.target.value) }))}
            className="w-full accent-purple-600"
          />
          <div className="flex justify-between text-xs text-gray-400">
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
            <input
              type="number"
              min={1}
              max={100}
              value={form.maxRepliesPerSession}
              onChange={(e) => setForm((prev) => ({ ...prev, maxRepliesPerSession: Number(e.target.value) }))}
              className="w-28 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <span className="text-sm text-gray-500">ครั้ง — หลังจากนี้จะโอนให้พนักงาน</span>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={mutation.isPending}
          className="px-6 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 transition-colors"
        >
          {mutation.isPending ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า'}
        </button>
      </div>
    </form>
  );
}

export default function AiSettingsPage() {
  const settingsQuery = useQuery<AiSettings>({
    queryKey: ['ai-settings'],
    queryFn: () => api.get('/staff-chat/ai/settings').then((r: any) => r.data),
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
