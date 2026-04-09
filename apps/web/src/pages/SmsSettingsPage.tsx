import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';

export default function SmsSettingsPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>({});
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [testPhone, setTestPhone] = useState('');
  const [testResult, setTestResult] = useState<{ success: boolean; credit?: number; error?: string } | null>(null);
  const [testSendResult, setTestSendResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['sms-settings'],
    queryFn: async () => {
      const res = await api.get('/notifications/sms-settings');
      return res.data as { settings: Record<string, string>; isConfigured: boolean };
    },
  });

  useEffect(() => {
    if (data?.settings) {
      setForm(data.settings);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      return api.post('/notifications/sms-settings', form);
    },
    onSuccess: () => {
      toast.success('บันทึกการตั้งค่าเรียบร้อย');
      queryClient.invalidateQueries({ queryKey: ['sms-settings'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post('/notifications/sms-settings/test-connection');
      return res.data as { success: boolean; credit?: number; error?: string };
    },
    onSuccess: (result) => {
      setTestResult(result);
      if (result.success) {
        toast.success(`เชื่อมต่อสำเร็จ! เครดิตคงเหลือ: ${result.credit}`);
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
      const res = await api.post('/notifications/sms-settings/test-send', { phone: testPhone });
      return res.data as { success: boolean; message?: string; error?: string };
    },
    onSuccess: (result) => {
      setTestSendResult(result);
      if (result.success) {
        toast.success(result.message || 'ส่ง SMS ทดสอบสำเร็จ');
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

  const hasKey = !!form.sms_api_key;
  const hasSecret = !!form.sms_api_secret;

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
        title="ตั้งค่า SMS"
        subtitle="เชื่อมต่อ ThaiBulkSMS เพื่อส่ง OTP และแจ้งเตือนผ่าน SMS"
      />

      {/* Connection Status Card */}
      <div className={`mb-8 p-5 rounded-xl border-2 ${
        data?.isConfigured && testResult?.success
          ? 'bg-success/5 dark:bg-success/10 border-success/30'
          : data?.isConfigured
            ? 'bg-blue-50 border-blue-300'
            : 'bg-warning/5 dark:bg-warning/10 border-warning/30'
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
                ? `เชื่อมต่อแล้ว — เครดิตคงเหลือ: ${testResult.credit}`
                : data?.isConfigured
                  ? 'ตั้งค่าแล้ว — กดทดสอบเพื่อยืนยัน'
                  : 'ยังไม่ได้ตั้งค่า SMS'}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              {data?.isConfigured
                ? 'ระบบพร้อมส่ง OTP และแจ้งเตือนผ่าน SMS อัตโนมัติ'
                : 'ทำตามขั้นตอนด้านล่างเพื่อเชื่อมต่อ ThaiBulkSMS กับระบบ'}
            </p>
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
            <p className="text-sm text-destructive">เชื่อมต่อไม่สำเร็จ: {testResult.error}</p>
            <p className="text-xs text-red-500 mt-1">กรุณาตรวจสอบ API Key และ API Secret ว่าถูกต้อง</p>
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          saveMutation.mutate();
        }}
      >
        {/* Step 1: API Credentials */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
              hasKey && hasSecret ? 'bg-green-500 text-white' : 'bg-muted text-muted-foreground'
            }`}>
              {hasKey && hasSecret ? '✓' : '1'}
            </div>
            <div>
              <h3 className="font-semibold">ขั้นตอนที่ 1: ใส่ API Key</h3>
              <p className="text-xs text-muted-foreground">สำคัญที่สุด — ระบบจะส่ง SMS ผ่าน ThaiBulkSMS API</p>
            </div>
          </div>

          <div className="rounded-xl border border-border/50 bg-card shadow-sm p-5 ml-4 border-l-4 border-l-blue-400">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-5">
              <p className="text-sm text-blue-800 font-medium mb-2">วิธีหา API Key:</p>
              <ol className="text-sm text-blue-700 space-y-1.5 list-decimal list-inside">
                <li>เปิด <a href="https://www.thaibulksms.com" target="_blank" rel="noopener noreferrer" className="underline font-medium">thaibulksms.com</a> แล้วล็อกอิน</li>
                <li>ไปที่เมนู <strong>Setting</strong> &rarr; <strong>API Key</strong></li>
                <li>คัดลอก <strong>API Key</strong> และ <strong>API Secret</strong> มาวางด้านล่าง</li>
              </ol>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  API Key <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showSecrets['key'] ? 'text' : 'password'}
                    value={form.sms_api_key || ''}
                    onChange={(e) => handleChange('sms_api_key', e.target.value)}
                    placeholder="วาง API Key ที่นี่"
                    className="w-full border rounded-lg px-3 py-2.5 text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background pr-16 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecrets((p) => ({ ...p, key: !p.key }))}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-primary hover:text-primary/80 px-2 py-1 bg-blue-50 rounded"
                  >
                    {showSecrets['key'] ? 'ซ่อน' : 'แสดง'}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  API Secret <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showSecrets['secret'] ? 'text' : 'password'}
                    value={form.sms_api_secret || ''}
                    onChange={(e) => handleChange('sms_api_secret', e.target.value)}
                    placeholder="วาง API Secret ที่นี่"
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

        {/* Step 2: Sender & Credit Type */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
              hasKey && hasSecret ? 'bg-blue-500 text-white' : 'bg-muted text-muted-foreground'
            }`}>
              2
            </div>
            <div>
              <h3 className="font-semibold">ขั้นตอนที่ 2: ตั้งค่า Sender <span className="text-xs font-normal text-muted-foreground">(ไม่บังคับ)</span></h3>
              <p className="text-xs text-muted-foreground">ชื่อผู้ส่งที่แสดงบนมือถือลูกค้า</p>
            </div>
          </div>

          <div className="rounded-xl border border-border/50 bg-card shadow-sm p-5 ml-4 border-l-4 border-l-green-400">
            <div className="bg-success/5 dark:bg-success/10 border border-success/20 rounded-lg p-4 mb-4">
              <p className="text-sm text-success font-medium mb-1">Sender ID คืออะไร?</p>
              <p className="text-sm text-success">ชื่อที่แสดงแทนเบอร์โทรผู้ส่ง เช่น &quot;BESTCHOICE&quot; ต้องลงทะเบียนกับ ThaiBulkSMS ก่อนใช้งาน หากยังไม่ลงทะเบียน ให้ปล่อยว่างไว้</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Sender ID</label>
                <input
                  type="text"
                  value={form.sms_sender || ''}
                  onChange={(e) => handleChange('sms_sender', e.target.value)}
                  placeholder="BESTCHOICE (ต้องลงทะเบียนกับ ThaiBulkSMS)"
                  className="w-full border rounded-lg px-3 py-2.5 text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1">ประเภทเครดิต</label>
                <select
                  value={form.sms_force || 'standard'}
                  onChange={(e) => handleChange('sms_force', e.target.value)}
                  className="w-full border rounded-lg px-3 py-2.5 text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background bg-background"
                >
                  <option value="standard">Standard (ราคาปกติ)</option>
                  <option value="corporate">Corporate (ราคาองค์กร)</option>
                </select>
                <p className="text-xs text-muted-foreground mt-1">เลือกให้ตรงกับประเภทเครดิตที่ซื้อจาก ThaiBulkSMS</p>
              </div>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="ml-4 flex gap-3 pt-2">
          <button
            type="submit"
            disabled={saveMutation.isPending || (!hasKey && !hasSecret)}
            className="px-8 py-3 bg-primary text-primary-foreground rounded-xl font-semibold hover:bg-primary/90 disabled:bg-muted disabled:cursor-not-allowed text-base shadow-card"
          >
            {saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า'}
          </button>
          {data?.isConfigured && (
            <button
              type="button"
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending}
              className="px-6 py-3 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-700 disabled:bg-muted text-base shadow-card"
            >
              {testMutation.isPending ? 'กำลังทดสอบ...' : 'ทดสอบการเชื่อมต่อ'}
            </button>
          )}
        </div>
      </form>

      {/* Test Send SMS */}
      {data?.isConfigured && (
        <div className="mt-10 mb-6">
          <h3 className="font-semibold text-foreground mb-4 ml-4">ทดสอบส่ง SMS</h3>
          <div className="rounded-xl border border-border/50 bg-card shadow-sm p-5 ml-4 border-l-4 border-l-yellow-400">
            <p className="text-sm text-muted-foreground mb-4">
              ส่ง SMS ทดสอบเพื่อยืนยันว่าระบบทำงานถูกต้อง
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  เบอร์โทรศัพท์
                </label>
                <input
                  type="tel"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="เช่น 0812345678"
                  className="w-full border rounded-lg px-3 py-2.5 text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background font-mono"
                />
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => testSendMutation.mutate()}
                  disabled={testSendMutation.isPending || !testPhone}
                  className="px-6 py-2.5 bg-yellow-500 text-white rounded-xl font-semibold hover:bg-yellow-600 disabled:bg-muted disabled:cursor-not-allowed text-sm shadow-card"
                >
                  {testSendMutation.isPending ? 'กำลังส่ง...' : 'ส่ง SMS ทดสอบ'}
                </button>
                {testSendResult && (
                  <span className={`text-sm ${testSendResult.success ? 'text-success' : 'text-destructive'}`}>
                    {testSendResult.success ? testSendResult.message : testSendResult.error}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Features Info */}
      <div className="mt-10 rounded-xl border border-border/50 bg-card shadow-sm p-6">
        <h3 className="font-semibold text-foreground mb-4">เมื่อตั้งค่าแล้ว ระบบจะทำสิ่งนี้ได้</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[
            { icon: '🔐', title: 'ส่ง OTP', desc: 'ยืนยันตัวตนลูกค้าผ่านรหัส OTP ทาง SMS' },
            { icon: '📢', title: 'แจ้งเตือนค่างวด', desc: 'ส่ง SMS เตือนก่อนถึงกำหนดชำระ' },
            { icon: '⚠️', title: 'แจ้งเตือนค้างชำระ', desc: 'ส่ง SMS เตือนเมื่อเลยกำหนดชำระ' },
            { icon: '📱', title: 'สำรอง LINE', desc: 'ใช้ SMS เป็นช่องทางสำรองเมื่อ LINE ส่งไม่ได้' },
          ].map((f) => (
            <div key={f.title} className="flex items-start gap-3 bg-muted rounded-lg p-3">
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
