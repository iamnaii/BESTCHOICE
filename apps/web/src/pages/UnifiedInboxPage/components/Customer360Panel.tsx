import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { User, FileText, CreditCard, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';

interface Customer360PanelProps {
  customerId: string | null;
}

export default function Customer360Panel({ customerId }: Customer360PanelProps) {
  const { data: customer, isLoading } = useQuery({
    queryKey: ['customer-360', customerId],
    queryFn: () => api.get(`/customers/${customerId}`).then((r: any) => r.data),
    enabled: !!customerId,
  });

  const { data: contracts } = useQuery({
    queryKey: ['customer-contracts-360', customerId],
    queryFn: () =>
      api
        .get(`/contracts`, { params: { customerId, limit: 5 } })
        .then((r: any) => r.data),
    enabled: !!customerId,
  });

  if (!customerId) {
    return (
      <div className="w-80 border-l border-gray-200 hidden xl:flex items-center justify-center text-gray-400 text-sm p-4">
        เลือกการสนทนาเพื่อดูข้อมูลลูกค้า
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="w-80 border-l border-gray-200 hidden xl:flex items-center justify-center text-gray-400 text-sm">
        กำลังโหลดข้อมูล...
      </div>
    );
  }

  return (
    <div className="w-80 border-l border-gray-200 hidden xl:block overflow-y-auto">
      {/* Customer profile */}
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
            <User className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h3 className="font-semibold text-sm text-gray-900">{customer?.name}</h3>
            <p className="text-xs text-gray-500">{customer?.phone}</p>
          </div>
        </div>

        {customer?.email && (
          <p className="text-xs text-gray-400">{customer.email}</p>
        )}
      </div>

      {/* Contracts */}
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-center gap-2 mb-3">
          <FileText className="w-4 h-4 text-gray-400" />
          <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">สัญญา</h4>
        </div>

        {contracts?.data?.length > 0 ? (
          <div className="space-y-2">
            {contracts.data.map((c: any) => (
              <div
                key={c.id}
                className="p-2.5 bg-gray-50 rounded-lg text-xs"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-gray-800">
                    {c.contractNumber ?? c.id.slice(0, 8)}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                      c.status === 'ACTIVE'
                        ? 'bg-green-100 text-green-700'
                        : c.status === 'COMPLETED'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {c.status}
                  </span>
                </div>
                <p className="text-gray-500">
                  {c.product?.name ?? 'สินค้า'}
                </p>
                {c.monthlyPayment && (
                  <p className="text-gray-400 mt-0.5">
                    งวดละ {Number(c.monthlyPayment).toLocaleString()} บาท
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400">ไม่มีสัญญา</p>
        )}
      </div>

      {/* Quick info */}
      <div className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <CreditCard className="w-4 h-4 text-gray-400" />
          <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">สรุป</h4>
        </div>

        <div className="space-y-1.5 text-xs text-gray-500">
          <div className="flex justify-between">
            <span>สัญญาทั้งหมด</span>
            <span className="font-medium text-gray-700">{contracts?.total ?? 0}</span>
          </div>
          {customer?.createdAt && (
            <div className="flex justify-between">
              <span>ลูกค้าตั้งแต่</span>
              <span className="font-medium text-gray-700">
                {format(new Date(customer.createdAt), 'dd/MM/yyyy')}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
