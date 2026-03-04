import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { checkCardReaderStatus, type CardReaderStatus } from '@/lib/cardReader';

interface ConfigItem {
  id: string;
  key: string;
  value: string;
  label: string | null;
}

const configGroups = [
  {
    title: 'อัตราดอกเบี้ยและเงินดาวน์',
    items: [
      { key: 'interest_rate', label: 'อัตราดอกเบี้ยต่อเดือน (Flat rate)', suffix: '', type: 'number', step: '0.01' },
      { key: 'min_down_payment_pct', label: 'เงินดาวน์ขั้นต่ำ (%)', suffix: '', type: 'number', step: '0.01' },
    ],
  },
  {
    title: 'ค่าปรับและจำนวนงวด',
    items: [
      { key: 'late_fee_per_day', label: 'ค่าปรับจ่ายช้าต่อวัน (บาท)', suffix: ' บาท', type: 'number', step: '1' },
      { key: 'late_fee_cap', label: 'ค่าปรับสูงสุดต่องวด (บาท)', suffix: ' บาท', type: 'number', step: '1' },
      { key: 'early_payoff_discount', label: 'ส่วนลดปิดบัญชีก่อนกำหนด (%)', suffix: '', type: 'number', step: '0.1' },
      { key: 'min_installment_months', label: 'จำนวนงวดขั้นต่ำ (เดือน)', suffix: ' เดือน', type: 'number', step: '1' },
      { key: 'max_installment_months', label: 'จำนวนงวดสูงสุด (เดือน)', suffix: ' เดือน', type: 'number', step: '1' },
    ],
  },
  {
    title: 'เกณฑ์การติดตามหนี้',
    items: [
      { key: 'overdue_days_threshold', label: 'จำนวนวันก่อนเปลี่ยนสถานะ OVERDUE', suffix: ' วัน', type: 'number', step: '1' },
      { key: 'default_consecutive_months', label: 'จำนวนงวดค้างติดต่อกันก่อน DEFAULT', suffix: ' งวด', type: 'number', step: '1' },
    ],
  },
  {
    title: 'เกณฑ์เกรดลูกค้า',
    items: [
      { key: 'grade_a_threshold', label: 'เกณฑ์ Grade A (%)', suffix: '%', type: 'number', step: '1' },
      { key: 'grade_b_threshold', label: 'เกณฑ์ Grade B (%)', suffix: '%', type: 'number', step: '1' },
      { key: 'grade_c_threshold', label: 'เกณฑ์ Grade C (%)', suffix: '%', type: 'number', step: '1' },
    ],
  },
];

const CARD_READER_DOWNLOAD_URL = 'https://github.com/iamnaii/BESTCHOICE/releases/latest/download/BestchoiceCardReader.zip';

function CardReaderSetup() {
  const [status, setStatus] = useState<CardReaderStatus | null | 'checking'>('checking');

  const checkStatus = useCallback(async () => {
    setStatus('checking');
    const result = await checkCardReaderStatus();
    setStatus(result);
  }, []);

  useEffect(() => { checkStatus(); }, [checkStatus]);

  const isConnected = status !== null && status !== 'checking';
  const statusInfo = (() => {
    if (status === 'checking') return { color: 'gray', icon: '⏳', text: 'กำลังตรวจสอบ...' };
    if (status === null) return { color: 'red', icon: '❌', text: 'ยังไม่ได้ติดตั้ง หรือโปรแกรมไม่ได้เปิดอยู่' };
    switch (status.status) {
      case 'waiting': return { color: 'green', icon: '✅', text: `เชื่อมต่อแล้ว — ${status.readerName || 'รอเสียบบัตร'}` };
      case 'card_inserted': return { color: 'green', icon: '✅', text: 'พร้อมอ่านบัตร' };
      case 'reading': return { color: 'blue', icon: '📖', text: 'กำลังอ่านบัตร...' };
      case 'no_reader': return { color: 'yellow', icon: '⚠️', text: 'โปรแกรมทำงานอยู่ แต่ไม่พบเครื่องอ่านบัตร USB' };
      case 'no_pcsc': return { color: 'red', icon: '❌', text: 'ไม่พบ Smart Card Service บนเครื่อง' };
      case 'error': return { color: 'red', icon: '❌', text: status.error || 'เกิดข้อผิดพลาด' };
      default: return { color: 'gray', icon: '❓', text: 'ไม่ทราบสถานะ' };
    }
  })();

  const bgColor = { green: 'bg-green-50 border-green-200', yellow: 'bg-yellow-50 border-yellow-200', red: 'bg-red-50 border-red-200', blue: 'bg-blue-50 border-blue-200', gray: 'bg-gray-50 border-gray-200' }[statusInfo.color] || 'bg-gray-50 border-gray-200';
  const textColor = { green: 'text-green-700', yellow: 'text-yellow-700', red: 'text-red-700', blue: 'text-blue-700', gray: 'text-gray-500' }[statusInfo.color] || 'text-gray-500';

  return (
    <div className="bg-white rounded-lg border p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <svg className="w-5 h-5 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" /></svg>
            เครื่องอ่านบัตรประชาชน
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            โปรแกรมสำหรับอ่านบัตรประชาชนผ่านเครื่องอ่านบัตร USB — ติดตั้งบนเครื่องคอมที่ร้าน
          </p>

          {/* Status */}
          <div className={`mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm ${bgColor} ${textColor}`}>
            <span>{statusInfo.icon}</span>
            <span>{statusInfo.text}</span>
            <button onClick={checkStatus} className="ml-1 text-gray-400 hover:text-gray-600" title="ตรวจสอบใหม่">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            </button>
          </div>

          {/* Install steps */}
          {!isConnected && (
            <div className="mt-4 text-sm text-gray-600 space-y-1">
              <p className="font-medium text-gray-700">วิธีติดตั้ง:</p>
              <ol className="list-decimal list-inside space-y-0.5 ml-1">
                <li>กดปุ่ม <strong>"ดาวน์โหลด"</strong> ด้านขวา</li>
                <li>โหลดไฟล์ <code className="bg-gray-100 px-1 rounded text-xs">.zip</code> → คลิกขวา → <strong>Extract All</strong></li>
                <li>เปิดโฟลเดอร์ → ดับเบิลคลิก <strong>setup.bat</strong></li>
                <li>เสร็จ! ดับเบิลคลิก <strong>"BESTCHOICE Card Reader"</strong> บน Desktop</li>
              </ol>
            </div>
          )}
        </div>

        {/* Download button */}
        <div className="flex flex-col items-center gap-2 shrink-0">
          <a
            href={CARD_READER_DOWNLOAD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="px-5 py-2.5 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors flex items-center gap-2 shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            ดาวน์โหลด
          </a>
          <span className="text-xs text-gray-400">Windows 10+</span>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [hasChanges, setHasChanges] = useState(false);

  const { data: configs = [], isLoading } = useQuery<ConfigItem[]>({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });

  useEffect(() => {
    if (configs.length > 0) {
      const map: Record<string, string> = {};
      configs.forEach((c) => { map[c.key] = c.value; });
      setValues(map);
      setHasChanges(false);
    }
  }, [configs]);

  const saveMutation = useMutation({
    mutationFn: async (items: { key: string; value: string }[]) =>
      api.patch('/settings', { items }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('บันทึกการตั้งค่าสำเร็จ');
      setHasChanges(false);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const handleChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleSave = () => {
    const items = Object.entries(values).map(([key, value]) => ({ key, value }));
    saveMutation.mutate(items);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="ตั้งค่าระบบ"
        subtitle="กำหนดพารามิเตอร์การทำงานของระบบ"
        action={
          <button
            onClick={handleSave}
            disabled={!hasChanges || saveMutation.isPending}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors"
          >
            {saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า'}
          </button>
        }
      />

      <div className="space-y-6">
        {/* Card Reader download + status */}
        <CardReaderSetup />

        {/* Link to InterestConfig */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-blue-800">ตั้งค่าอัตราดอกเบี้ยตามประเภทสินค้า</div>
            <div className="text-xs text-blue-600 mt-0.5">ตั้งค่าดอกเบี้ย เงินดาวน์ขั้นต่ำ จำนวนงวด แยกตามประเภทสินค้า (มือ1, มือ2, แท็บเล็ต ฯลฯ) ซึ่งจะใช้แทนค่า default ด้านล่าง</div>
          </div>
          <button onClick={() => navigate('/settings/interest-config')} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 whitespace-nowrap">
            ตั้งค่าดอกเบี้ย
          </button>
        </div>

        {configGroups.map((group) => (
          <div key={group.title} className="bg-white rounded-lg border p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">{group.title}</h3>
            {group.title === 'อัตราดอกเบี้ยและเงินดาวน์' && (
              <div className="text-xs text-gray-500 mb-3 bg-gray-50 p-2 rounded">ค่าด้านล่างเป็นค่า default ใช้เมื่อไม่มีการตั้งค่าดอกเบี้ยตามประเภทสินค้า</div>
            )}
            <div className="space-y-4">
              {group.items.map((item) => (
                <div key={item.key} className="flex items-center gap-4">
                  <label className="flex-1 text-sm text-gray-700">{item.label}</label>
                  <div className="w-48">
                    <input
                      type={item.type}
                      step={item.step}
                      value={values[item.key] || ''}
                      onChange={(e) => handleChange(item.key, e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-right focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {hasChanges && (
        <div className="fixed bottom-6 right-6 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 shadow-lg flex items-center gap-3">
          <span className="text-sm text-yellow-700">มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก</span>
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
          >
            บันทึก
          </button>
        </div>
      )}
    </div>
  );
}
