import { useTemplateStore } from '@/store/templateStore';
import BlockRenderer from './BlockRenderer';

export default function DocumentPreview() {
  const { currentTemplate, previewMode } = useTemplateStore();
  const { blocks, settings } = currentTemplate;

  return (
    <div className="flex-1 bg-[#F1F0F5] overflow-y-auto p-6">
      {/* A4 Paper simulation */}
      <div
        className="mx-auto bg-white shadow-lg"
        style={{
          width: '210mm',
          minHeight: '297mm',
          padding: `${settings.margins.top}mm ${settings.margins.right}mm ${settings.margins.bottom}mm ${settings.margins.left}mm`,
          fontFamily: "'Sarabun', sans-serif",
          fontSize: `${settings.fontSize.body}px`,
          lineHeight: 1.6,
        }}
      >
        {/* Letterhead */}
        {settings.letterhead === 'bestchoice' && (
          <div className="text-center mb-4 pb-2 border-b border-gray-300">
            <h1 className="text-[16px] font-bold text-violet-800">BESTCHOICEPHONE Co., Ltd.</h1>
            <p className="text-[11px] text-gray-500">บริษัท เบสท์ช้อยส์โฟน จำกัด | เลขประจำตัวผู้เสียภาษี 0165568000050</p>
            <p className="text-[10px] text-gray-400">456/21 ชั้น 2 ถนนนารายณ์มหาราช ตำบลทะเลชุบศร อำเภอเมือง จังหวัดลพบุรี 15000</p>
          </div>
        )}

        {/* Blocks */}
        {blocks.map(block => (
          <BlockRenderer key={block.id} block={block} previewMode={previewMode} />
        ))}

        {/* Footer */}
        <div className="mt-8 pt-2 border-t border-gray-200 flex justify-between items-end"
          style={{ fontSize: `${settings.fontSize.footer}px` }}
        >
          <span className="text-gray-400">{settings.footerText}</span>
          {settings.showPageNumber && (
            <span className="text-gray-400">{settings.pageNumberFormat.replace('{page}', '1').replace('{total}', '6')}</span>
          )}
        </div>
      </div>
    </div>
  );
}
