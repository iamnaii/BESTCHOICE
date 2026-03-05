import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';

interface StickerTemplate {
  id: string;
  name: string;
  sizeWidthMm: number;
  sizeHeightMm: number;
  placeholders: string[];
  isActive: boolean;
  layoutConfig: Record<string, unknown>;
}

interface StickerData {
  product_code: string;
  brand: string;
  model: string;
  imei: string;
  grade: string;
  selling_price: number;
  cost_price: number;
  branch: string;
  date_received: string;
  qr_url: string;
}

export default function StickerPrintPage() {
  const [productId, setProductId] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [previewData, setPreviewData] = useState<StickerData | null>(null);

  const { data: templates = [] } = useQuery<StickerTemplate[]>({
    queryKey: ['sticker-templates'],
    queryFn: async () => {
      const { data } = await api.get('/sticker-templates');
      return data;
    },
  });

  const loadPreview = async () => {
    if (!productId) return;
    try {
      const { data } = await api.get(`/sticker-templates/product/${productId}/data`);
      setPreviewData(data);
    } catch {
      setPreviewData(null);
    }
  };

  const template = templates.find((t) => t.id === selectedTemplate);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div>
      <div className="print:hidden">
        <PageHeader title="พิมพ์สติกเกอร์" subtitle="สร้างสติกเกอร์ QR code สำหรับสินค้า" />

        <div className="bg-white rounded-lg border p-6 mb-6">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Product ID</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                  placeholder="ระบุ ID สินค้า"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none"
                />
                <button onClick={loadPreview} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm">
                  โหลด
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Template</label>
              <select
                value={selectedTemplate}
                onChange={(e) => setSelectedTemplate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none"
              >
                <option value="">เลือก Template</option>
                {templates.filter((t) => t.isActive).map((t) => (
                  <option key={t.id} value={t.id}>{t.name} ({t.sizeWidthMm}x{t.sizeHeightMm}mm)</option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <button
                onClick={handlePrint}
                disabled={!previewData}
                className="px-6 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
              >
                พิมพ์สติกเกอร์
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Preview / Print Area */}
      {previewData && (
        <div className="flex justify-center">
          <div
            className="bg-white border-2 border-dashed border-gray-300 print:border-solid print:border-black"
            style={{
              width: template ? `${template.sizeWidthMm}mm` : '60mm',
              minHeight: template ? `${template.sizeHeightMm}mm` : '40mm',
              padding: '2mm',
              fontFamily: 'monospace',
              fontSize: '8pt',
            }}
          >
            <div style={{ fontWeight: 'bold', fontSize: '10pt', marginBottom: '1mm' }}>
              {previewData.brand} {previewData.model}
            </div>
            {previewData.grade && (
              <div style={{ marginBottom: '1mm' }}>Grade: {previewData.grade}</div>
            )}
            {previewData.imei && (
              <div style={{ fontSize: '7pt', marginBottom: '1mm' }}>IMEI: {previewData.imei}</div>
            )}
            <div style={{ fontWeight: 'bold', fontSize: '11pt', marginBottom: '1mm' }}>
              {(Number(previewData.selling_price) || 0).toLocaleString()} ฿
            </div>
            <div style={{ fontSize: '7pt', color: '#666' }}>
              {previewData.branch} | {previewData.date_received}
            </div>
            <div style={{ marginTop: '2mm', textAlign: 'center', fontSize: '7pt', color: '#999' }}>
              [{previewData.product_code}]
            </div>
          </div>
        </div>
      )}

      {/* Print CSS */}
      <style>{`
        @media print {
          .print\\:hidden { display: none !important; }
          body { margin: 0; padding: 0; }
          .print\\:border-solid { border-style: solid; }
          .print\\:border-black { border-color: black; }
        }
      `}</style>
    </div>
  );
}
