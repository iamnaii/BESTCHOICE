import { useTemplateStore } from '@/store/templateStore';
import BlockRenderer from './BlockRenderer';

export default function DocumentPreview() {
  const { currentTemplate, previewMode } = useTemplateStore();
  const { blocks, settings } = currentTemplate;

  return (
    <div className="flex-1 bg-slate-100 overflow-y-auto p-8">
      {/* A4 Paper simulation */}
      <div
        className="mx-auto bg-white rounded-sm"
        style={{
          width: '210mm',
          minHeight: '297mm',
          padding: `${settings.margins.top}mm ${settings.margins.right}mm ${settings.margins.bottom}mm ${settings.margins.left}mm`,
          fontFamily: "'TH Sarabun PSK', 'Noto Sans Thai', sans-serif",
          fontSize: `${settings.fontSize.body}px`,
          lineHeight: 1.7,
          boxShadow: '0 4px 24px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.08)',
          color: '#1a1a1a',
        }}
      >
        {/* Letterhead */}
        {settings.letterhead === 'bestchoice' && (
          <div className="text-center mb-5 pb-3" style={{ borderBottom: '2px solid #059669' }}>
            <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#059669', letterSpacing: '1px', marginBottom: '4px' }}>
              BESTCHOICEPHONE Co., Ltd.
            </h1>
            <p style={{ fontSize: '14px', color: '#4a4a4a', marginBottom: '2px' }}>
              บริษัท เบสท์ช้อยส์โฟน จำกัด | เลขประจำตัวผู้เสียภาษี 0165568000050
            </p>
            <p style={{ fontSize: '12px', color: '#888' }}>
              456/21 ชั้น 2 ถนนนารายณ์มหาราช ตำบลทะเลชุบศร อำเภอเมือง จังหวัดลพบุรี 15000
            </p>
          </div>
        )}

        {/* Blocks */}
        {(() => {
          let clauseCounter = 0;
          return blocks.map(block => {
            const clauseIndex = block.type === 'clause' ? ++clauseCounter : undefined;
            return <BlockRenderer key={block.id} block={block} previewMode={previewMode} clauseIndex={clauseIndex} />;
          });
        })()}

        {/* Footer */}
        <div
          className="mt-10 pt-3 flex justify-between items-end"
          style={{
            fontSize: `${settings.fontSize.footer}px`,
            borderTop: '1px solid #d1d5db',
          }}
        >
          <span style={{ color: '#9ca3af' }}>{settings.footerText}</span>
          {settings.showPageNumber && (
            <span style={{ color: '#9ca3af' }}>
              {settings.pageNumberFormat.replace('{page}', '1').replace('{total}', '6')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
