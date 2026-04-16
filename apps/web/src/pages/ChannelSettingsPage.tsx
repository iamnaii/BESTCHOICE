import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Save, Eye, EyeOff, CheckCircle, XCircle, Copy, ExternalLink } from 'lucide-react';

interface ChannelConfig {
  label: string;
  isConfigured: boolean;
  settings: Record<string, string>;
}

const CHANNEL_META: Record<string, { color: string; icon: string; fields: { key: string; label: string; secret: boolean; placeholder: string }[] }> = {
  LINE_SHOP: {
    color: 'bg-emerald-500',
    icon: '🟢',
    fields: [
      { key: 'line_channel_access_token', label: 'Channel Access Token', secret: true, placeholder: 'ดึงจาก LINE Developers Console' },
      { key: 'line_channel_secret', label: 'Channel Secret', secret: true, placeholder: 'ดึงจาก LINE Developers Console' },
      { key: 'liff_id', label: 'LIFF ID', secret: false, placeholder: 'เช่น 2009442540-XXXXXXXX' },
    ],
  },
  LINE_FINANCE: {
    color: 'bg-green-600',
    icon: '💚',
    fields: [
      { key: 'line_finance_channel_access_token', label: 'Channel Access Token (Finance)', secret: true, placeholder: 'Token ของ OA "ชำระค่างวด"' },
      { key: 'line_finance_channel_secret', label: 'Channel Secret (Finance)', secret: true, placeholder: 'Secret ของ OA "ชำระค่างวด"' },
      { key: 'line_finance_liff_id', label: 'LIFF ID (Finance)', secret: false, placeholder: 'สำหรับ verify ตัวตน' },
    ],
  },
  FACEBOOK: {
    color: 'bg-blue-600',
    icon: '🔵',
    fields: [
      { key: 'fb_page_access_token', label: 'Page Access Token', secret: true, placeholder: 'ดึงจาก Facebook Developer Console' },
      { key: 'fb_page_id', label: 'Page ID', secret: false, placeholder: 'เช่น 1234567890' },
      { key: 'fb_app_secret', label: 'App Secret', secret: true, placeholder: 'สำหรับ verify webhook signature' },
      { key: 'fb_verify_token', label: 'Verify Token', secret: false, placeholder: 'กำหนดเอง สำหรับ webhook verification' },
    ],
  },
  TIKTOK: {
    color: 'bg-pink-500',
    icon: '🎵',
    fields: [
      { key: 'tiktok_bm_access_token', label: 'Business Messaging Access Token', secret: true, placeholder: 'ดึงจาก TikTok Business API Portal' },
      { key: 'tiktok_bm_business_id', label: 'Business ID', secret: false, placeholder: 'TikTok Business Account ID' },
    ],
  },
};

export default function ChannelSettingsPage() {
  const queryClient = useQueryClient();
  const [forms, setForms] = useState<Record<string, Record<string, string>>>({});
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  const channelsQuery = useQuery({
    queryKey: ['channel-settings'],
    queryFn: () => api.get('/channel-settings').then((r: any) => r.data),
  });

  const webhooksQuery = useQuery({
    queryKey: ['channel-webhooks'],
    queryFn: () => api.get('/channel-settings/webhooks').then((r: any) => r.data),
  });

  useEffect(() => {
    if (channelsQuery.data?.channels) {
      const initial: Record<string, Record<string, string>> = {};
      for (const [channel, cfg] of Object.entries(channelsQuery.data.channels as Record<string, ChannelConfig>)) {
        initial[channel] = { ...cfg.settings };
      }
      setForms(initial);
    }
  }, [channelsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (channel: string) =>
      api.post('/channel-settings', { channel, settings: forms[channel] }),
    onSuccess: (_, channel) => {
      toast.success(`บันทึก ${CHANNEL_META[channel]?.icon} ${(channelsQuery.data?.channels as Record<string, ChannelConfig>)?.[channel]?.label} เรียบร้อย`);
      queryClient.invalidateQueries({ queryKey: ['channel-settings'] });
    },
    onError: () => toast.error('ไม่สามารถบันทึกได้'),
  });

  const channels = channelsQuery.data?.channels as Record<string, ChannelConfig> | undefined;
  const webhooks = webhooksQuery.data?.webhooks as Record<string, { url: string; method: string }> | undefined;

  return (
    <div>
      <PageHeader title="ตั้งค่าช่องทางแชท" subtitle="เชื่อมต่อ LINE, Facebook, TikTok กับระบบ Unified Inbox" />

      <QueryBoundary
        isLoading={channelsQuery.isLoading}
        isError={channelsQuery.isError}
        error={channelsQuery.error}
        onRetry={() => channelsQuery.refetch()}
      >
        <div className="space-y-6">
          {channels && Object.entries(channels).map(([channelKey, channelCfg]) => {
            const meta = CHANNEL_META[channelKey];
            if (!meta) return null;
            const webhook = webhooks?.[channelKey];

            return (
              <div key={channelKey} className="bg-card rounded-xl shadow-sm overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{meta.icon}</span>
                    <div>
                      <h3 className="font-semibold text-foreground">{channelCfg.label}</h3>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {channelCfg.isConfigured ? (
                          <>
                            <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                            <span className="text-xs text-green-600">เชื่อมต่อแล้ว</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">ยังไม่ได้เชื่อมต่อ</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => saveMutation.mutate(channelKey)}
                    disabled={saveMutation.isPending}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
                  >
                    <Save className="w-4 h-4" />
                    บันทึก
                  </button>
                </div>

                {/* Fields */}
                <div className="px-6 py-4 space-y-4">
                  {meta.fields.map((field) => (
                    <div key={field.key}>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {field.label}
                      </label>
                      <div className="relative">
                        <input
                          type={field.secret && !showSecrets[field.key] ? 'password' : 'text'}
                          value={forms[channelKey]?.[field.key] ?? ''}
                          onChange={(e) =>
                            setForms((prev) => ({
                              ...prev,
                              [channelKey]: { ...prev[channelKey], [field.key]: e.target.value },
                            }))
                          }
                          placeholder={field.placeholder}
                          className="w-full px-3 py-2 pr-10 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                        />
                        {field.secret && (
                          <button
                            type="button"
                            onClick={() =>
                              setShowSecrets((prev) => ({ ...prev, [field.key]: !prev[field.key] }))
                            }
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-muted-foreground"
                          >
                            {showSecrets[field.key] ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Webhook URL */}
                  {webhook && (
                    <div className="mt-4 p-3 bg-muted rounded-lg">
                      <label className="block text-xs font-medium text-muted-foreground mb-1">
                        Webhook URL (ตั้งค่าใน Developer Console)
                      </label>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-xs text-muted-foreground bg-card px-2 py-1.5 rounded border border-border truncate">
                          {webhook.url}
                        </code>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(webhook.url);
                            toast.success('คัดลอก Webhook URL แล้ว');
                          }}
                          className="p-1.5 text-muted-foreground hover:text-muted-foreground"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">{webhook.method}</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </QueryBoundary>
    </div>
  );
}
