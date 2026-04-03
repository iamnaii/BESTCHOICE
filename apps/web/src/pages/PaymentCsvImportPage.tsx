import { useState, useRef, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import DataTable from '@/components/ui/DataTable';
import { toast } from 'sonner';

interface ImportError {
  id: string;
  row: number;
  message: string;
}

interface ImportResult {
  total: number;
  success: number;
  errors: ImportError[];
}

const SAMPLE_CSV = `contractNumber,installmentNo,amount,paymentMethod,transactionRef,notes
BC-2568-0001,1,3500,BANK_TRANSFER,REF001,ชำระงวดที่ 1
BC-2568-0001,2,3500,CASH,,ชำระงวดที่ 2
BC-2568-0002,1,4200,BANK_TRANSFER,REF002,`;

export default function PaymentCsvImportPage() {
  const [csvText, setCsvText] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const importMutation = useMutation({
    mutationFn: async (csv: string) => {
      const { data } = await api.post<ImportResult>('/payments/import-csv', { csv });
      return data;
    },
    onSuccess: (data) => {
      setResult(data);
      if (data.errors.length === 0) {
        toast.success(`นำเข้าสำเร็จทั้งหมด ${data.success} รายการ`);
      } else {
        toast.warning(`นำเข้าสำเร็จ ${data.success}/${data.total} รายการ (${data.errors.length} errors)`);
      }
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const handleFileRead = useCallback((file: File) => {
    if (!file.name.endsWith('.csv') && !file.name.endsWith('.txt')) {
      toast.error('รองรับเฉพาะไฟล์ .csv หรือ .txt');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('ไฟล์ใหญ่เกิน 5MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result;
      if (typeof text === 'string') {
        setCsvText(text);
        setResult(null);
        toast.success(`โหลดไฟล์ ${file.name} แล้ว`);
      }
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileRead(file);
  }, [handleFileRead]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileRead(file);
  }, [handleFileRead]);

  const handleImport = () => {
    if (!csvText.trim()) {
      toast.error('กรุณาวาง CSV หรืออัพโหลดไฟล์ก่อน');
      return;
    }
    setResult(null);
    importMutation.mutate(csvText);
  };

  const downloadSample = () => {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'payment_import_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const previewLines = csvText.trim().split('\n').slice(0, 6);
  const rowCount = csvText.trim() ? csvText.trim().split('\n').length - 1 : 0;

  const errorColumns = [
    {
      key: 'row',
      label: 'แถว',
      render: (e: { row: number }) => <span className="font-mono text-sm">{e.row}</span>,
    },
    {
      key: 'message',
      label: 'ข้อผิดพลาด',
      render: (e: { message: string }) => <span className="text-sm text-destructive">{e.message}</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="นำเข้าชำระเงิน (CSV)"
        subtitle="นำเข้าข้อมูลการชำระเงินจากไฟล์ CSV"
        action={
          <button onClick={downloadSample} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">
            ดาวน์โหลดเทมเพลต CSV
          </button>
        }
      />

      {/* Format info */}
      <Card className="shadow-xs shadow-black/5 mb-6">
        <CardContent className="p-4">
          <div className="text-xs font-medium text-muted-foreground mb-2">รูปแบบ CSV ที่รองรับ</div>
          <code className="block text-xs bg-muted p-3 rounded-lg overflow-x-auto whitespace-pre">
            contractNumber,installmentNo,amount,paymentMethod,transactionRef,notes
          </code>
          <div className="mt-2 text-xs text-muted-foreground">
            <strong>paymentMethod:</strong> CASH, BANK_TRANSFER, PROMPTPAY, CREDIT_CARD (ถ้าไม่ระบุจะใช้ BANK_TRANSFER)
          </div>
        </CardContent>
      </Card>

      {/* Upload area */}
      <Card className="shadow-xs shadow-black/5 mb-6">
        <CardContent className="p-4">
          <div
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
              isDragOver ? 'border-primary bg-primary/5' : 'border-gray-300 hover:border-gray-400'
            }`}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input ref={fileInputRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFileChange} />
            <div className="text-sm text-muted-foreground">
              {isDragOver ? 'ปล่อยไฟล์ที่นี่...' : 'ลากไฟล์มาวางที่นี่ หรือคลิกเพื่อเลือกไฟล์ (.csv, .txt)'}
            </div>
          </div>

          <div className="my-3 text-center text-xs text-muted-foreground">หรือวางข้อมูล CSV ด้านล่าง</div>

          <textarea
            value={csvText}
            onChange={(e) => { setCsvText(e.target.value); setResult(null); }}
            placeholder="วางข้อมูล CSV ที่นี่..."
            rows={8}
            className="w-full px-3.5 py-2.5 border border-input rounded-lg text-sm font-mono outline-none bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30 resize-y"
          />

          {csvText && (
            <div className="mt-2 text-xs text-muted-foreground">
              {rowCount} แถวข้อมูล (ไม่รวม header)
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preview */}
      {csvText && previewLines.length > 0 && (
        <Card className="shadow-xs shadow-black/5 mb-6">
          <CardContent className="p-4">
            <div className="text-xs font-medium text-muted-foreground mb-2">ตัวอย่างข้อมูล (5 แถวแรก)</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    {previewLines[0]?.split(',').map((h, i) => (
                      <th key={i} className="text-left p-1.5 font-medium text-muted-foreground">{h.trim()}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewLines.slice(1, 6).map((line, i) => (
                    <tr key={i} className="border-b last:border-0">
                      {line.split(',').map((cell, j) => (
                        <td key={j} className="p-1.5">{cell.trim() || '-'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Import button */}
      <div className="flex gap-3 mb-6">
        <button
          onClick={handleImport}
          disabled={!csvText.trim() || importMutation.isPending}
          className="px-6 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50"
        >
          {importMutation.isPending ? 'กำลังนำเข้า...' : 'นำเข้าข้อมูล'}
        </button>
        {csvText && (
          <button
            onClick={() => { setCsvText(''); setResult(null); }}
            className="px-4 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200"
          >
            ล้างข้อมูล
          </button>
        )}
      </div>

      {/* Results */}
      {result && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
            <Card className="shadow-xs shadow-black/5">
              <CardContent className="p-4">
                <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ทั้งหมด</div>
                <div className="text-2xl font-bold">{result.total}</div>
              </CardContent>
            </Card>
            <Card className="shadow-xs shadow-black/5">
              <CardContent className="p-4">
                <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">สำเร็จ</div>
                <div className="text-2xl font-bold text-success">{result.success}</div>
              </CardContent>
            </Card>
            <Card className="shadow-xs shadow-black/5">
              <CardContent className="p-4">
                <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ผิดพลาด</div>
                <div className="text-2xl font-bold text-destructive">{result.errors.length}</div>
              </CardContent>
            </Card>
          </div>

          {result.errors.length > 0 && (
            <DataTable columns={errorColumns} data={result.errors.map((e, i) => ({ ...e, id: `err-${i}` }))} emptyMessage="ไม่มีข้อผิดพลาด" />
          )}
        </>
      )}
    </div>
  );
}
