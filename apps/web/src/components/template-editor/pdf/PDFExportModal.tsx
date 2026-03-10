import { useState, useCallback } from 'react';
import { X, Download, Eye, Loader2 } from 'lucide-react';
import { useTemplateStore } from '@/store/templateStore';
import { generatePDF } from './pdfGenerator';
import toast from 'react-hot-toast';

export default function PDFExportModal() {
  const { showExportModal, setShowExportModal, currentTemplate } = useTemplateStore();
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const handleGenerate = useCallback(async (action: 'preview' | 'download') => {
    setIsGenerating(true);
    try {
      const blob = await generatePDF(currentTemplate);
      const url = URL.createObjectURL(blob);

      if (action === 'preview') {
        setPreviewUrl(url);
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = `${currentTemplate.name || 'document'}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success('ดาวน์โหลด PDF สำเร็จ');
      }
    } catch (err) {
      console.error('PDF generation error:', err);
      toast.error('ไม่สามารถสร้าง PDF ได้');
    } finally {
      setIsGenerating(false);
    }
  }, [currentTemplate]);

  const handleClose = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    setShowExportModal(false);
  };

  if (!showExportModal) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-800">Export PDF</h2>
          <button onClick={handleClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {previewUrl ? (
            <iframe
              src={previewUrl}
              className="w-full border border-gray-200 rounded-lg"
              style={{ height: '65vh' }}
              title="PDF Preview"
            />
          ) : (
            <div className="text-center py-16">
              <div className="text-6xl mb-4">📄</div>
              <h3 className="text-lg font-medium text-gray-700 mb-2">{currentTemplate.name}</h3>
              <p className="text-base text-gray-500 mb-6">
                {currentTemplate.blocks.length} blocks | A4 | TH Sarabun PSK
              </p>

              <div className="flex items-center justify-center gap-4">
                <button
                  onClick={() => handleGenerate('preview')}
                  disabled={isGenerating}
                  className="flex items-center gap-2 px-6 py-3 text-base border border-primary-300 text-primary-700 rounded-lg hover:bg-primary-50 disabled:opacity-50 transition-colors"
                >
                  {isGenerating ? <Loader2 size={18} className="animate-spin" /> : <Eye size={18} />}
                  Preview
                </button>
                <button
                  onClick={() => handleGenerate('download')}
                  disabled={isGenerating}
                  className="flex items-center gap-2 px-6 py-3 text-base bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
                >
                  {isGenerating ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                  ดาวน์โหลด PDF
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {previewUrl && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200">
            <button
              onClick={() => { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }}
              className="px-5 py-2.5 text-base text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              กลับ
            </button>
            <button
              onClick={() => handleGenerate('download')}
              disabled={isGenerating}
              className="flex items-center gap-2 px-5 py-2.5 text-base bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              <Download size={16} />
              ดาวน์โหลด PDF
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
