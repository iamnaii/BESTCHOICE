import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';

interface BotInfo {
  displayName: string;
  userId: string;
  pictureUrl?: string;
}

interface LineStats {
  linkedCustomers: number;
  pendingSlips: number;
  todayNotifications: number;
}

const TEST_MESSAGE_TYPES = [
  { value: 'payment_reminder', label: 'แจ้งเตือนค่างวด (ก่อนครบกำหนด)' },
  { value: 'overdue_notice', label: 'แจ้งเตือนค้างชำระ' },
  { value: 'payment_success', label: 'แจ้งชำระเงินสำเร็จ' },
  { value: 'balance_summary', label: 'สรุปยอดคงเหลือ' },
];

export default function LineOaSettingsPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>({});
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [testResult, setTestResult] = useState<{ success: boolean; botInfo?: BotInfo; error?: string } | null>(null);
  const [testMsgType, setTestMsgType] = useState('payment_reminder');
  const [testSendResult, setTestSendResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['line-oa-settings'],
    queryFn: async () => {
      const res = await api.get('/line-oa/settings');
      return res.data as { settings: Record<string, string>; raw: Record<string, string>; isConfigured: boolean };
    },
  });

  const { data: webhookData } = useQuery({
    queryKey: ['line-oa-webhook-url'],
    queryFn: async () => {
      const res = await api.get('/line-oa/settings/webhook-url');
      return res.data as { webhookUrl: string };
    },
  });

  const { data: stats } = useQuery({
    queryKey: ['line-oa-stats'],
    queryFn: async () => {
      const res = await api.get('/line-oa/stats');
      return res.data as LineStats;
    },
    enabled: !!data?.isConfigured,
  });

  useEffect(() => {
    if (data?.raw) {
      setForm(data.raw);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      return api.post('/line-oa/settings', form);
    },
    onSuccess: () => {
      toast.success('บันทึกการตั้งค่าเรียบร้อย');
      queryClient.invalidateQueries({ queryKey: ['line-oa-settings'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post('/line-oa/settings/test-connection');
      return res.data as { success: boolean; botInfo?: BotInfo; error?: string };
    },
    onSuccess: (result) => {
      setTestResult(result);
      if (result.success && result.botInfo) {
        toast.success(`เชื่อมต่อสำเร็จ!`);
      } else {
        toast.error(result.error || 'ไม่สามารถเชื่อมต่อได้');
      }
    },
    onError: (err) => {
      setTestResult({ success: false, error: getErrorMessage(err) });
      toast.error(getErrorMessage(err));
    },
  });

  const testSendMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post('/line-oa/test-send', {
        lineUserId: form.owner_line_id || undefined,
        messageType: testMsgType,
      });
      return res.data as { success: boolean; message?: string; error?: string };
    },
    onSuccess: (result) => {
      setTestSendResult(result);
      if (result.success) {
        toast.success(result.message || 'ส่งสำเร็จ');
      } else {
        toast.error(result.error || 'ส่งไม่สำเร็จ');
      }
    },
    onError: (err) => {
      setTestSendResult({ success: false, error: getErrorMessage(err) });
      toast.error(getErrorMessage(err));
    },
  });

  const handleChange = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('คัดลอกแล้ว');
  };

  // Check which steps are done
  const hasToken = !!(form.line_channel_access_token);
  const hasSecret = !!(form.line_channel_secret);
  const hasPromptPay = !!(form.promptpay_id);
  const hasLiff = !!(form.liff_id);

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="text-center py-12 text-muted-foreground">กำลังโหลด...</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <PageHeader
        title="เชื่อมต่อ LINE OA"
        subtitle="ตั้งค่าเชื่อมต่อ LINE Official Account เพื่อส่งแจ้งเตือนและรับชำระเงินผ่านไลน์"
      />

      {/* Connection Status Card */}
      <div className={`mb-8 p-5 rounded-2xl border-2 ${
        data?.isConfigured && testResult?.success
          ? 'bg-green-50 border-green-300'
          : data?.isConfigured
            ? 'bg-blue-50 border-blue-300'
            : 'bg-orange-50 border-orange-300'
      }`}>
        <div className="flex items-start gap-4">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0 ${
            data?.isConfigured && testResult?.success
              ? 'bg-green-200'
              : data?.isConfigured
                ? 'bg-blue-200'
                : 'bg-orange-200'
          }`}>
            {data?.isConfigured && testResult?.success ? '✅' : data?.isConfigured ? '🔗' : '⚠️'}
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-lg">
              {data?.isConfigured && testResult?.success
                ? `เชื่อมต่อแล้ว: ${testResult.botInfo?.displayName}`
                : data?.isConfigured
                  ? 'ตั้งค่าแล้ว — กดทดสอบเพื่อยืนยัน'
                  : 'ยังไม่ได้เชื่อมต่อ LINE OA'}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              {data?.isConfigured
                ? 'ระบบพร้อมส่งแจ้งเตือนค่างวด, รับสลิป, และแจ้งเตือนค้างชำระอัตโนมัติ'
                : 'ทำตาม 3 ขั้นตอนด้านล่างเพื่อเชื่อมต่อ LINE OA กับระบบ'}
            </p>
            {testResult?.success && testResult.botInfo?.pictureUrl && (
              <img src={testResult.botInfo.pictureUrl} alt="Bot" className="w-10 h-10 rounded-full mt-2" />
            )}
          </div>
          {data?.isConfigured && (
            <button
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending}
              className="px-5 py-2.5 bg-green-600 text-white rounded-xl font-medium hover:bg-green-700 disabled:bg-muted shrink-0"
            >
              {testMutation.isPending ? 'กำลังทดสอบ...' : 'ทดสอบการเชื่อมต่อ'}
            </button>
          )}
        </div>
        {testResult && !testResult.success && (
          <div className="mt-3 p-3 bg-red-100 border border-red-200 rounded-lg">
            <p className="text-sm text-red-700">เชื่อมต่อไม่สำเร็จ: {testResult.error}</p>
            <p className="text-xs text-red-500 mt-1">กรุณาตรวจสอบ Channel Access Token ว่าถูกต้อง</p>
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          saveMutation.mutate();
        }}
      >
        {/* Step 1: LINE Channel */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
              hasToken && hasSecret ? 'bg-green-500 text-white' : 'bg-muted text-muted-foreground'
            }`}>
              {hasToken && hasSecret ? '✓' : '1'}
            </div>
            <div>
              <h3 className="font-semibold">ขั้นตอนที่ 1: เชื่อมต่อ LINE Channel</h3>
              <p className="text-xs text-muted-foreground">สำคัญที่สุด — ระบบจะส่งข้อความผ่าน Channel นี้</p>
            </div>
          </div>

          <div className="bg-card rounded-xl shadow-xs shadow-black/5 border p-5 ml-4 border-l-4 border-l-blue-400">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-5">
              <p className="text-sm text-blue-800 font-medium mb-2">วิธีหา Token:</p>
              <ol className="text-sm text-blue-700 space-y-1.5 list-decimal list-inside">
                <li>เปิด <a href="https://developers.line.biz/" target="_blank" rel="noopener noreferrer" className="underline font-medium">developers.line.biz</a> แล้วล็อกอิน</li>
                <li>กดสร้าง <strong>Provider</strong> ใหม่ (ตั้งชื่อบริษัท)</li>
                <li>กด <strong>Create a Messaging API channel</strong></li>
                <li>ไปที่ tab <strong>"Basic settings"</strong> &rarr; คัดลอก <strong>Channel secret</strong></li>
                <li>ไปที่ tab <strong>"Messaging API"</strong> &rarr; กด <strong>Issue</strong> ที่ Channel access token</li>
              </ol>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Channel Access Token <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showSecrets['token'] ? 'text' : 'password'}
                    value={form.line_channel_access_token || ''}
                    onChange={(e) => handleChange('line_channel_access_token', e.target.value)}
                    placeholder="วาง Channel Access Token ที่นี่"
                    className="w-full border rounded-lg px-3 py-2.5 text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background pr-16 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecrets((p) => ({ ...p, token: !p.token }))}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-primary hover:text-primary/80 px-2 py-1 bg-blue-50 rounded"
                  >
                    {showSecrets['token'] ? 'ซ่อน' : 'แสดง'}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Channel Secret <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showSecrets['secret'] ? 'text' : 'password'}
                    value={form.line_channel_secret || ''}
                    onChange={(e) => handleChange('line_channel_secret', e.target.value)}
                    placeholder="วาง Channel Secret ที่นี่"
                    className="w-full border rounded-lg px-3 py-2.5 text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background pr-16 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecrets((p) => ({ ...p, secret: !p.secret }))}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-primary hover:text-primary/80 px-2 py-1 bg-blue-50 rounded"
                  >
                    {showSecrets['secret'] ? 'ซ่อน' : 'แสดง'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Step 2: Webhook URL */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
              hasToken && hasSecret ? 'bg-blue-500 text-white' : 'bg-muted text-muted-foreground'
            }`}>
              2
            </div>
            <div>
              <h3 className="font-semibold">ขั้นตอนที่ 2: ตั้งค่า Webhook</h3>
              <p className="text-xs text-muted-foreground">เพื่อให้ระบบรับข้อความจากลูกค้า</p>
            </div>
          </div>

          <div className="bg-card rounded-xl shadow-xs shadow-black/5 border p-5 ml-4 border-l-4 border-l-green-400">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
              <p className="text-sm text-green-800 font-medium mb-2">คัดลอก URL ด้านล่าง แล้วไปวางใน LINE Developers Console:</p>
              <ol className="text-sm text-green-700 space-y-1 list-decimal list-inside">
                <li>เปิด LINE Developers Console &rarr; เลือก Channel ของคุณ</li>
                <li>ไปที่ tab <strong>"Messaging API"</strong></li>
                <li>หา <strong>"Webhook URL"</strong> &rarr; กด Edit &rarr; วาง URL ด้านล่าง</li>
                <li>เปิด <strong>"Use webhook"</strong> ให้เป็นสีเขียว</li>
                <li>ปิด <strong>"Auto-reply messages"</strong> (เพราะระบบตอบอัตโนมัติเอง)</li>
              </ol>
            </div>

            {webhookData?.webhookUrl && (
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm bg-muted px-4 py-3 rounded-lg border text-foreground font-mono break-all">
                  {webhookData.webhookUrl}
                </code>
                <button
                  type="button"
                  onClick={() => copyToClipboard(webhookData.webhookUrl)}
                  className="px-4 py-3 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 shrink-0 font-medium"
                >
                  คัดลอก
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Step 3: PromptPay (Optional) */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
              hasPromptPay ? 'bg-green-500 text-white' : 'bg-muted text-muted-foreground'
            }`}>
              {hasPromptPay ? '✓' : '3'}
            </div>
            <div>
              <h3 className="font-semibold">ขั้นตอนที่ 3: ตั้งค่า PromptPay <span className="text-xs font-normal text-muted-foreground">(ไม่บังคับ)</span></h3>
              <p className="text-xs text-muted-foreground">สร้าง QR พร้อมเพย์ให้ลูกค้าสแกนจ่ายผ่านไลน์</p>
            </div>
          </div>

          <div className="bg-card rounded-xl shadow-xs shadow-black/5 border p-5 ml-4 border-l-4 border-l-purple-400">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  เลข PromptPay
                </label>
                <input
                  type="text"
                  value={form.promptpay_id || ''}
                  onChange={(e) => handleChange('promptpay_id', e.target.value)}
                  placeholder="เช่น 0812345678 หรือ เลขบัตรประชาชน 13 หลัก"
                  className="w-full border rounded-lg px-3 py-2.5 text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background"
                />
                <p className="text-xs text-muted-foreground mt-1">ใส่เบอร์โทรหรือเลขบัตรประชาชนที่ผูกกับ PromptPay</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  ชื่อบัญชี (แสดงบน QR)
                </label>
                <input
                  type="text"
                  value={form.promptpay_account_name || ''}
                  onChange={(e) => handleChange('promptpay_account_name', e.target.value)}
                  placeholder="เช่น BESTCHOICE Co.,Ltd."
                  className="w-full border rounded-lg px-3 py-2.5 text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Step 4: LIFF (Optional) */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
              hasLiff ? 'bg-green-500 text-white' : 'bg-muted text-muted-foreground'
            }`}>
              {hasLiff ? '✓' : '4'}
            </div>
            <div>
              <h3 className="font-semibold">ขั้นตอนที่ 4: ตั้งค่า LIFF <span className="text-xs font-normal text-muted-foreground">(ไม่บังคับ)</span></h3>
              <p className="text-xs text-muted-foreground">หน้าชำระเงินแบบ Mini App ภายในไลน์</p>
            </div>
          </div>

          <div className="bg-card rounded-xl shadow-xs shadow-black/5 border p-5 ml-4 border-l-4 border-l-orange-400">
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-4">
              <p className="text-sm text-orange-800 font-medium mb-2">วิธีสร้าง LIFF App:</p>
              <ol className="text-sm text-orange-700 space-y-1 list-decimal list-inside">
                <li>เปิด LINE Developers Console &rarr; เลือก Channel</li>
                <li>ไปที่ tab <strong>"LIFF"</strong> &rarr; กด <strong>"Add"</strong></li>
                <li>ตั้ง Size: <strong>Full</strong>, Scope: เลือก <strong>profile</strong></li>
                <li>ใส่ Endpoint URL: <strong>{`${window.location.origin}/pay`}</strong></li>
                <li>คัดลอก <strong>LIFF ID</strong> มาวางด้านล่าง</li>
              </ol>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  LIFF ID
                </label>
                <input
                  type="text"
                  value={form.liff_id || ''}
                  onChange={(e) => handleChange('liff_id', e.target.value)}
                  placeholder="เช่น 1234567890-xxxxxxxx"
                  className="w-full border rounded-lg px-3 py-2.5 text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background font-mono"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Payment Link URL
                </label>
                <input
                  type="text"
                  value={form.payment_link_base_url || ''}
                  onChange={(e) => handleChange('payment_link_base_url', e.target.value)}
                  placeholder={form.liff_id ? `https://liff.line.me/${form.liff_id}` : 'ใส่ LIFF ID ก่อน จะสร้าง URL ให้อัตโนมัติ'}
                  className="w-full border rounded-lg px-3 py-2.5 text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background font-mono"
                />
                {form.liff_id && !form.payment_link_base_url && (
                  <button
                    type="button"
                    onClick={() => handleChange('payment_link_base_url', `https://liff.line.me/${form.liff_id}`)}
                    className="mt-2 text-xs text-primary hover:text-primary/80 underline"
                  >
                    ใช้ URL อัตโนมัติ: https://liff.line.me/{form.liff_id}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="ml-4 flex gap-3 pt-2">
          <button
            type="submit"
            disabled={saveMutation.isPending || (!hasToken && !hasSecret)}
            className="px-8 py-3 bg-primary text-primary-foreground rounded-xl font-semibold hover:bg-primary/90 disabled:bg-muted disabled:cursor-not-allowed text-base shadow-xs shadow-black/5"
          >
            {saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า'}
          </button>
          {data?.isConfigured && (
            <button
              type="button"
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending}
              className="px-6 py-3 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-700 disabled:bg-muted text-base shadow-xs shadow-black/5"
            >
              {testMutation.isPending ? 'กำลังทดสอบ...' : 'ทดสอบการเชื่อมต่อ'}
            </button>
          )}
        </div>
      </form>

      {/* LINE OA Statistics */}
      {data?.isConfigured && stats && (
        <div className="mt-10 mb-6">
          <h3 className="font-semibold text-foreground mb-4 ml-4">สถิติ LINE OA</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 ml-4">
            <div className="bg-card rounded-xl shadow-xs shadow-black/5 border p-5 text-center">
              <div className="text-3xl font-bold text-primary">{stats.linkedCustomers}</div>
              <div className="text-sm text-muted-foreground mt-1">ลูกค้าเชื่อมต่อ LINE</div>
            </div>
            <div className="bg-card rounded-xl shadow-xs shadow-black/5 border p-5 text-center">
              <div className={`text-3xl font-bold ${stats.pendingSlips > 0 ? 'text-orange-500' : 'text-green-500'}`}>
                {stats.pendingSlips}
              </div>
              <div className="text-sm text-muted-foreground mt-1">สลิปรอตรวจสอบ</div>
            </div>
            <div className="bg-card rounded-xl shadow-xs shadow-black/5 border p-5 text-center">
              <div className="text-3xl font-bold text-blue-500">{stats.todayNotifications}</div>
              <div className="text-sm text-muted-foreground mt-1">ข้อความวันนี้</div>
            </div>
          </div>
        </div>
      )}

      {/* Test Send Messages */}
      {data?.isConfigured && (
        <div className="mt-10 mb-6">
          <h3 className="font-semibold text-foreground mb-4 ml-4">ทดสอบส่งข้อความ</h3>
          <div className="bg-card rounded-xl shadow-xs shadow-black/5 border p-5 ml-4 border-l-4 border-l-yellow-400">
            <p className="text-sm text-muted-foreground mb-4">
              ส่งตัวอย่าง Flex Message ให้ตัวเองดูก่อน เพื่อตรวจสอบว่าข้อความแสดงผลถูกต้อง
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  LINE User ID ของเจ้าของ
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={form.owner_line_id || ''}
                    onChange={(e) => handleChange('owner_line_id', e.target.value)}
                    placeholder="พิมพ์ #owner ในแชท Bot หรือวาง User ID ที่นี่"
                    className="flex-1 border rounded-lg px-3 py-2.5 text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      queryClient.invalidateQueries({ queryKey: ['line-oa-settings'] });
                      toast.success('โหลดข้อมูลใหม่แล้ว');
                    }}
                    className="px-4 py-2.5 bg-blue-100 text-blue-700 text-sm rounded-lg hover:bg-blue-200 shrink-0 font-medium"
                  >
                    ดึง User ID
                  </button>
                </div>
                <div className="mt-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-sm text-yellow-800 font-medium mb-1">วิธีง่ายที่สุด:</p>
                  <ol className="text-xs text-yellow-700 space-y-1 list-decimal list-inside">
                    <li>เพิ่ม Bot เป็นเพื่อนในไลน์</li>
                    <li>พิมพ์ <strong>#owner</strong> ส่งไปในแชท Bot</li>
                    <li>กลับมากดปุ่ม <strong>"ดึง User ID"</strong> ด้านบน</li>
                  </ol>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  ประเภทข้อความ
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {TEST_MESSAGE_TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setTestMsgType(t.value)}
                      className={`px-3 py-2 text-sm rounded-lg border text-left transition-colors ${
                        testMsgType === t.value
                          ? 'border-primary bg-primary/10 text-primary font-medium'
                          : 'border-border hover:border-primary/50 text-foreground'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => testSendMutation.mutate()}
                  disabled={testSendMutation.isPending || !form.owner_line_id}
                  className="px-6 py-2.5 bg-yellow-500 text-white rounded-xl font-semibold hover:bg-yellow-600 disabled:bg-muted disabled:cursor-not-allowed text-sm shadow-xs shadow-black/5"
                >
                  {testSendMutation.isPending ? 'กำลังส่ง...' : 'ส่งทดสอบ'}
                </button>
                {testSendResult && (
                  <span className={`text-sm ${testSendResult.success ? 'text-green-600' : 'text-red-600'}`}>
                    {testSendResult.success ? testSendResult.message : testSendResult.error}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Features Info */}
      <div className="mt-10 bg-gradient-to-br from-green-50 to-blue-50 rounded-2xl border border-green-200 p-6">
        <h3 className="font-semibold text-foreground mb-4">เมื่อเชื่อมต่อแล้ว ระบบจะทำสิ่งนี้ได้อัตโนมัติ</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[
            { icon: '📢', title: 'แจ้งเตือนค่างวด', desc: 'ส่ง Flex Message สวยๆ ก่อนถึงกำหนด 1 และ 3 วัน' },
            { icon: '⚠️', title: 'แจ้งเตือนค้างชำระ', desc: 'ส่งเตือนอัตโนมัติเมื่อเลยกำหนดชำระ' },
            { icon: '📱', title: 'QR พร้อมเพย์', desc: 'ลูกค้าพิมพ์ "ชำระ" แล้วได้ QR สแกนจ่ายทันที' },
            { icon: '🧾', title: 'รับสลิปผ่านไลน์', desc: 'ลูกค้าส่งรูปสลิป เข้าระบบตรวจสอบทันที' },
            { icon: '✅', title: 'แจ้งผลการชำระ', desc: 'อนุมัติสลิปแล้ว ส่ง Flex แจ้งลูกค้าอัตโนมัติ' },
            { icon: '💬', title: 'ตอบอัตโนมัติ', desc: 'พิมพ์ "เช็คยอด" "งวด" "ช่วยเหลือ" ตอบทันที' },
          ].map((f) => (
            <div key={f.title} className="flex items-start gap-3 bg-white/70 rounded-lg p-3">
              <span className="text-xl">{f.icon}</span>
              <div>
                <p className="text-sm font-medium text-foreground">{f.title}</p>
                <p className="text-xs text-muted-foreground">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
