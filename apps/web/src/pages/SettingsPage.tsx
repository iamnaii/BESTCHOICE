import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';

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

export default function SettingsPage() {
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
        {configGroups.map((group) => (
          <div key={group.title} className="bg-white rounded-lg border p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">{group.title}</h3>
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
