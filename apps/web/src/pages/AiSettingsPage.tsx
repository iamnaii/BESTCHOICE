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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Sparkles, Bot, Route, Store } from 'lucide-react';

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
      queryClient.invalidateQueries({ queryKey: ['ai-settings', 'full'] });
      queryClient.invalidateQueries({ queryKey: ['ai-settings', 'lite'] });
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

interface ShopBotConfig {
  shopBotCentralBranchId: string | null;
  shopBotPromptpayId: string | null;
  shopBotTestUserId: string | null;
}

function ShopBotSetupForm() {
  const queryClient = useQueryClient();
  const [branchId, setBranchId] = useState('');
  const [promptpayId, setPromptpayId] = useState('');
  const [testUserId, setTestUserId] = useState('');

  // Read SHOP bot config from same ai-settings endpoint (extended in Task 20a).
  // Use a distinct query key so the raw response shape doesn't conflict with
  // the existing transformed ['ai-settings'] cache entry.
  const shopBotQuery = useQuery<ShopBotConfig>({
    queryKey: ['ai-settings-shop-bot'],
    queryFn: () =>
      api.get('/staff-chat/ai/settings').then((r: any) => {
        const d = r.data?.data ?? r.data;
        return {
          shopBotCentralBranchId: d.shopBotCentralBranchId ?? null,
          shopBotPromptpayId: d.shopBotPromptpayId ?? null,
          shopBotTestUserId: d.shopBotTestUserId ?? null,
        };
      }),
  });

  const branchesQuery = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: () => api.get('/branches').then((r: any) => r.data),
  });

  useEffect(() => {
    if (!shopBotQuery.data) return;
    setBranchId(shopBotQuery.data.shopBotCentralBranchId ?? '');
    setPromptpayId(shopBotQuery.data.shopBotPromptpayId ?? '');
    setTestUserId(shopBotQuery.data.shopBotTestUserId ?? '');
  }, [shopBotQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.patch('/staff-chat/ai/settings', {
        shopBotCentralBranchId: branchId || null,
        shopBotPromptpayId: promptpayId || null,
        shopBotTestUserId: testUserId || null,
      }),
    onSuccess: () => {
      toast.success('บันทึก SHOP Bot Setup เรียบร้อย');
      queryClient.invalidateQueries({ queryKey: ['ai-settings-shop-bot'] });
      queryClient.invalidateQueries({ queryKey: ['ai-settings', 'full'] });
      queryClient.invalidateQueries({ queryKey: ['ai-settings', 'lite'] });
    },
    onError: () => {
      toast.error('ไม่สามารถบันทึก SHOP Bot Setup ได้');
    },
  });

  const testSendMutation = useMutation({
    mutationFn: () =>
      api.post<{ success: boolean; error?: string }>('/staff-chat/ai/test-send'),
    onSuccess: (res: any) => {
      const data = res.data?.data ?? res.data;
      if (data?.success) {
        toast.success('ส่งข้อความทดสอบสำเร็จ — เช็คใน LINE');
      } else {
        toast.error(`ส่งไม่สำเร็จ: ${data?.error ?? 'unknown'}`);
      }
    },
    onError: (err: any) => {
      toast.error(`Error: ${err?.response?.data?.message ?? err.message}`);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2 leading-snug">
          <Store className="w-4 h-4 text-muted-foreground" />
          SHOP Bot Setup
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label className="leading-snug">Central Branch (เก็บ AI-captured leads)</Label>
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger>
              <SelectValue placeholder="เลือกสาขา" />
            </SelectTrigger>
            <SelectContent>
              {(branchesQuery.data ?? []).map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="leading-snug">
            PromptPay ID (เบอร์มือถือ / เลข ปชช. / เลขผู้เสียภาษีนิติบุคคล)
          </Label>
          <Input
            value={promptpayId}
            onChange={(e) => setPromptpayId(e.target.value)}
            placeholder="เช่น 0812345678"
          />
        </div>
        <div className="space-y-2">
          <Label className="leading-snug">
            Test LINE userId (owner — ใช้ส่งข้อความทดสอบ)
          </Label>
          <Input
            value={testUserId}
            onChange={(e) => setTestUserId(e.target.value)}
            placeholder="U1234567890abcdef..."
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => testSendMutation.mutate()}
            disabled={
              testSendMutation.isPending || !shopBotQuery.data?.shopBotTestUserId
            }
          >
            {testSendMutation.isPending ? 'กำลังส่ง...' : '🧪 ส่งข้อความทดสอบไปยัง LINE'}
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || shopBotQuery.isLoading}
          >
            {saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface PerBotSettings {
  salesBotMode: string;
  serviceBotMode: string;
  salesBotConfidenceThreshold: number;
  serviceBotConfidenceThreshold: number;
}

function PerBotModeCard() {
  const queryClient = useQueryClient();

  const query = useQuery<PerBotSettings>({
    queryKey: ['ai-settings-per-bot'],
    queryFn: () =>
      api.get('/ai-settings').then((r: any) => {
        const d = r.data?.data ?? r.data;
        return {
          salesBotMode: d.salesBotMode ?? 'HYBRID',
          serviceBotMode: d.serviceBotMode ?? 'HYBRID',
          salesBotConfidenceThreshold: d.salesBotConfidenceThreshold ?? 0.7,
          serviceBotConfidenceThreshold: d.serviceBotConfidenceThreshold ?? 0.75,
        };
      }),
  });

  const update = useMutation({
    mutationFn: (body: Partial<PerBotSettings>) => api.patch('/ai-settings', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-settings-per-bot'] });
      toast.success('บันทึกการตั้งค่าแล้ว');
    },
    onError: () => toast.error('บันทึกไม่สำเร็จ'),
  });

  const settings = query.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2 leading-snug">
          <Bot className="w-4 h-4 text-muted-foreground" />
          โหมด AI ต่อบอท (Week 1 Hybrid C)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {settings ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <Label className="leading-snug">บอทขาย (Sales Bot)</Label>
              <Select
                value={settings.salesBotMode}
                onValueChange={(v) => update.mutate({ salesBotMode: v })}
                disabled={update.isPending}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OFF">OFF (ปิด)</SelectItem>
                  <SelectItem value="HYBRID">HYBRID (แนะนำ)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-2">
              <Label className="leading-snug">น้องเบส (Service Bot)</Label>
              <Select
                value={settings.serviceBotMode}
                onValueChange={(v) => update.mutate({ serviceBotMode: v })}
                disabled={update.isPending}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OFF">OFF (ปิด)</SelectItem>
                  <SelectItem value="HYBRID">HYBRID (แนะนำ)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground leading-snug">
              HYBRID: AI สร้าง draft ให้พนักงานตรวจก่อนส่ง · OFF: ไม่สร้าง draft. การส่งอัตโนมัติควบคุมที่ SystemConfig `ai.autoEnabled`
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground leading-snug">กำลังโหลดการตั้งค่า...</p>
        )}
      </CardContent>
    </Card>
  );
}

const CHANNEL_BOT_ROUTING = [
  { channel: 'LINE FINANCE', bot: 'น้องเบส (Service Bot)', desc: 'ลูกค้าผ่อน — ตอบยอดค้าง/วันครบกำหนด/ติดต่อ' },
  { channel: 'LINE SHOP', bot: 'บอทขาย (Sales Bot)', desc: 'ลูกค้าใหม่ — ตอบสินค้า/ราคา/โปร/สาขา' },
  { channel: 'Facebook', bot: 'บอทขาย (Sales Bot)', desc: 'ลูกค้าใหม่ — ตอบสินค้า/ราคา/โปร/สาขา' },
  { channel: 'TikTok', bot: 'บอทขาย (Sales Bot)', desc: 'ลูกค้าใหม่ — ตอบสินค้า/ราคา/โปร/สาขา' },
  { channel: 'Web', bot: 'บอทขาย (Sales Bot)', desc: 'ลูกค้าใหม่ — ตอบสินค้า/ราคา/โปร/สาขา' },
];

function ChannelRoutingCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2 leading-snug">
          <Route className="w-4 h-4 text-muted-foreground" />
          ช่องทาง → บอท ที่ใช้ตอบ
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground leading-snug mb-3">
          การจับคู่อ้างอิงประเภทห้องแชท: ห้องที่มาจาก LINE FINANCE ใช้ Service Bot ส่วนช่องทางอื่น ๆ ใช้ Sales Bot
          ตัวเดียวกัน (knowledge base เดียวกัน — สินค้า/ราคา/โปร/สาขา)
        </p>
        <div className="rounded-lg border border-border divide-y divide-border">
          {CHANNEL_BOT_ROUTING.map((row) => (
            <div key={row.channel} className="flex items-start justify-between gap-3 p-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground leading-snug">{row.channel}</p>
                <p className="text-xs text-muted-foreground leading-snug mt-0.5">{row.desc}</p>
              </div>
              <div className="shrink-0 text-right">
                <span
                  className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium leading-snug ${
                    row.bot.startsWith('น้องเบส')
                      ? 'bg-primary/10 text-primary'
                      : 'bg-accent text-accent-foreground'
                  }`}
                >
                  {row.bot}
                </span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function AiSettingsPage() {
  const settingsQuery = useQuery<AiSettings>({
    queryKey: ['ai-settings', 'full'],
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
      <div className="max-w-2xl space-y-6">
        <ChannelRoutingCard />
        <PerBotModeCard />
        <QueryBoundary
          isLoading={settingsQuery.isLoading}
          isError={settingsQuery.isError}
          error={settingsQuery.error}
          onRetry={() => settingsQuery.refetch()}
        >
          <AiSettingsForm initial={settingsQuery.data ?? defaultSettings} />
        </QueryBoundary>
        <ShopBotSetupForm />
      </div>
    </div>
  );
}
