import { useRef, useEffect, useState, useCallback } from 'react';
import { useTemplateStore } from '@/store/templateStore';
import { renderVariables, buildSampleContext } from '@/utils/templateRenderer';
import { AVAILABLE_VARIABLES } from '@/constants/variables';
import BlockRenderer from './BlockRenderer';

interface Props {
  compact?: boolean;
}

export default function DocumentPreview({ compact }: Props) {
  const { currentTemplate, previewMode } = useTemplateStore();
  const { blocks, settings } = currentTemplate;
  const ctx = previewMode ? buildSampleContext(AVAILABLE_VARIABLES) : {};
  const resolvedFooter = previewMode ? renderVariables(settings.footerText, ctx) : settings.footerText;

  const containerRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [wrapperHeight, setWrapperHeight] = useState<number | undefined>(undefined);

  const updateScale = useCallback(() => {
    if (!compact || !containerRef.current) {
      setScale(1);
      setWrapperHeight(undefined);
      return;
    }
    // A4 width = 210mm ≈ 793.7px at 96dpi
    const containerWidth = containerRef.current.clientWidth;
    const padding = 32; // 16px padding each side
    const availableWidth = containerWidth - padding;
    const a4WidthPx = 793.7;
    const newScale = Math.min(1, availableWidth / a4WidthPx);
    setScale(newScale);
  }, [compact]);

  // Update wrapper height when paper content changes
  // We use marginBottom compensation instead of overflow:hidden to avoid clipping
  useEffect(() => {
    if (scale >= 1 || !paperRef.current) {
      setWrapperHeight(undefined);
      return;
    }
    const updateHeight = () => {
      if (paperRef.current) {
        // The negative margin collapses the empty space left by CSS scale
        const emptySpace = paperRef.current.offsetHeight * (1 - scale);
        setWrapperHeight(-emptySpace);
      }
    };
    const observer = new ResizeObserver(updateHeight);
    observer.observe(paperRef.current);
    updateHeight();
    return () => observer.disconnect();
  }, [scale]);

  useEffect(() => {
    updateScale();
    const observer = new ResizeObserver(updateScale);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [updateScale]);

  return (
    <div ref={containerRef} className="flex-1 bg-slate-100 overflow-y-auto overflow-x-hidden p-4" style={{ height: '100%' }}>
      {/* Wrapper — negative marginBottom collapses extra space from CSS scale without clipping */}
      <div style={{ marginBottom: wrapperHeight }}>
        {/* A4 Paper simulation */}
        <div
          ref={paperRef}
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
            transform: scale < 1 ? `scale(${scale})` : undefined,
            transformOrigin: 'top center',
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
            <span style={{ color: '#9ca3af' }}>{resolvedFooter}</span>
            {settings.showPageNumber && (
              <span style={{ color: '#9ca3af' }}>
                {settings.pageNumberFormat.replace('{page}', '1').replace('{total}', '6')}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
