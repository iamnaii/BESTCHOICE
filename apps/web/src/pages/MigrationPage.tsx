import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';

interface MigrationStatus {
  customers: number;
  contracts: number;
  payments: number;
  products: number;
  branches: number;
  users: number;
}

interface ImportResult {
  success: number;
  failed: number;
  errors: { row: number; field?: string; message: string }[];
}

type ImportMode = 'customers' | 'contracts' | 'bulk';

export default function MigrationPage() {
  const queryClient = useQueryClient();
  const [importMode, setImportMode] = useState<ImportMode>('customers');
  const [jsonInput, setJsonInput] = useState('');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const { data: status } = useQuery<MigrationStatus>({
    queryKey: ['migration-status'],
    queryFn: async () => (await api.get('/migration/status')).data,
  });

  const importMutation = useMutation({
    mutationFn: async (data: { mode: ImportMode; payload: unknown }) => {
      const endpoint =
        data.mode === 'bulk'
          ? '/migration/import/bulk'
          : `/migration/import/${data.mode}`;
      return (await api.post(endpoint, data.payload)).data;
    },
    onSuccess: (data) => {
      const result = data.customers || data.contracts || data;
      setImportResult(result);
      queryClient.invalidateQueries({ queryKey: ['migration-status'] });
      if (result.failed === 0) {
        toast.success(`นำเข้าสำเร็จ ${result.success} รายการ`);
      } else {
        toast.error(`สำเร็จ ${result.success}, ผิดพลาด ${result.failed} รายการ`);
      }
    },
    onError: () => toast.error('เกิดข้อผิดพลาดในการนำเข้าข้อมูล'),
  });

  const handleImport = () => {
    try {
      const parsed = JSON.parse(jsonInput);
      setImportResult(null);
      importMutation.mutate({ mode: importMode, payload: parsed });
    } catch {
      toast.error('รูปแบบ JSON ไม่ถูกต้อง');
    }
  };

  const loadSampleData = () => {
    if (importMode === 'customers') {
      setJsonInput(
        JSON.stringify(
          [
            {
              name: 'สมชาย ใจดี',
              nationalId: '1234567890121',
              phone: '0812345678',
              addressCurrent: '123 ถ.สุขุมวิท กรุงเทพฯ',
              occupation: 'พนักงานบริษัท',
            },
          ],
          null,
          2,
        ),
      );
    } else if (importMode === 'contracts') {
      setJsonInput(
        JSON.stringify(
          [
            {
              customerNationalId: '1234567890121',
              productName: 'iPhone 15 Pro',
              branchName: 'สาขาหลัก',
              salespersonEmail: 'admin@bestchoice.com',
              planType: 'STORE_DIRECT',
              sellingPrice: 35000,
              downPayment: 5000,
              interestRate: 0.02,
              totalMonths: 10,
              status: 'ACTIVE',
            },
          ],
          null,
          2,
        ),
      );
    } else {
      setJsonInput(
        JSON.stringify(
          {
            customers: [
              {
                name: 'สมชาย ใจดี',
                nationalId: '1234567890121',
                phone: '0812345678',
              },
            ],
            contracts: [],
          },
          null,
          2,
        ),
      );
    }
  };

  return (
    <div>
      <PageHeader title="นำเข้าข้อมูล" subtitle="ย้ายข้อมูลจากระบบเดิม" />

      {/* Status Cards */}
      {status && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          {[
            { label: 'ลูกค้า', count: status.customers },
            { label: 'สัญญา', count: status.contracts },
            { label: 'ชำระ', count: status.payments },
            { label: 'สินค้า', count: status.products },
            { label: 'สาขา', count: status.branches },
            { label: 'ผู้ใช้', count: status.users },
          ].map((item) => (
            <div key={item.label} className="bg-white rounded-lg border p-4 text-center">
              <div className="text-2xl font-bold text-gray-900">{item.count}</div>
              <div className="text-xs text-gray-500">{item.label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Import Form */}
        <div className="bg-white rounded-lg border p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">นำเข้าข้อมูล</h3>

          {/* Mode Selection */}
          <div className="flex gap-2 mb-4">
            {[
              { key: 'customers' as ImportMode, label: 'ลูกค้า' },
              { key: 'contracts' as ImportMode, label: 'สัญญา' },
              { key: 'bulk' as ImportMode, label: 'ทั้งหมด (Bulk)' },
            ].map((mode) => (
              <button
                key={mode.key}
                onClick={() => {
                  setImportMode(mode.key);
                  setJsonInput('');
                  setImportResult(null);
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  importMode === mode.key
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>

          {/* JSON Input */}
          <textarea
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
            rows={16}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            placeholder={`วาง JSON ข้อมูล${importMode === 'customers' ? 'ลูกค้า' : importMode === 'contracts' ? 'สัญญา' : ''} ที่นี่...`}
          />

          <div className="flex gap-2 mt-3">
            <button
              onClick={handleImport}
              disabled={!jsonInput.trim() || importMutation.isPending}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              {importMutation.isPending ? 'กำลังนำเข้า...' : 'นำเข้าข้อมูล'}
            </button>
            <button
              onClick={loadSampleData}
              className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-200"
            >
              ตัวอย่างข้อมูล
            </button>
          </div>
        </div>

        {/* Import Result */}
        <div className="bg-white rounded-lg border p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">ผลลัพธ์การนำเข้า</h3>

          {importResult ? (
            <div>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="bg-green-50 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-green-600">{importResult.success}</div>
                  <div className="text-xs text-green-700">สำเร็จ</div>
                </div>
                <div className="bg-red-50 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-red-600">{importResult.failed}</div>
                  <div className="text-xs text-red-700">ผิดพลาด</div>
                </div>
              </div>

              {importResult.errors.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-red-700 mb-2">
                    รายละเอียดข้อผิดพลาด ({importResult.errors.length} รายการ)
                  </h4>
                  <div className="max-h-64 overflow-y-auto space-y-1">
                    {importResult.errors.map((err, i) => (
                      <div key={i} className="text-xs bg-red-50 rounded p-2">
                        <span className="font-medium">แถว {err.row}</span>
                        {err.field && (
                          <span className="text-gray-500"> [{err.field}]</span>
                        )}
                        : {err.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center text-gray-400 py-16">
              <div className="text-4xl mb-2">&#128230;</div>
              <div className="text-sm">ยังไม่มีผลลัพธ์</div>
              <div className="text-xs mt-1">วาง JSON แล้วกดนำเข้าข้อมูล</div>
            </div>
          )}

          {/* Instructions */}
          <div className="mt-6 border-t pt-4">
            <h4 className="text-xs font-medium text-gray-700 mb-2">คำแนะนำ</h4>
            <ul className="text-xs text-gray-500 space-y-1">
              <li>- ข้อมูลลูกค้าต้องมี: name, nationalId (13 หลัก), phone</li>
              <li>- เลข ปชช. ที่มีอยู่แล้วจะถูกอัปเดต (upsert)</li>
              <li>- ข้อมูลสัญญาต้องมี: customerNationalId, productName, branchName, salespersonEmail</li>
              <li>- ต้องนำเข้าลูกค้าก่อนสัญญา</li>
              <li>- ใช้ Bulk mode เพื่อนำเข้าทั้งลูกค้าและสัญญาพร้อมกัน</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
