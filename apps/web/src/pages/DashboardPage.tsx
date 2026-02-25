import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/ui/PageHeader';

export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <div>
      <PageHeader title="หน้าหลัก" subtitle={`ยินดีต้อนรับ ${user?.name}`} />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'สัญญาทั้งหมด', value: '-', color: 'blue' },
          { label: 'ค้างชำระ', value: '-', color: 'red' },
          { label: 'ชำระแล้ววันนี้', value: '-', color: 'green' },
          { label: 'สินค้าในสต็อก', value: '-', color: 'purple' },
        ].map((card) => (
          <div key={card.label} className="bg-white rounded-lg border p-5">
            <p className="text-sm text-gray-500">{card.label}</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg border p-6 text-center text-gray-400">
        <p>Dashboard จะถูกเพิ่มใน Step 20</p>
      </div>
    </div>
  );
}
