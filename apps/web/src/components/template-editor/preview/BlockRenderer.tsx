import type { Block } from '@/types/template';
import { renderVariables, buildSampleContext } from '@/utils/templateRenderer';
import { AVAILABLE_VARIABLES } from '@/constants/variables';
import VariableHighlighter from './VariableHighlighter';
import PaymentTable from './PaymentTable';
import SignatureBlock from './SignatureBlock';

interface Props {
  block: Block;
  previewMode: boolean;
}

export default function BlockRenderer({ block, previewMode }: Props) {
  const ctx = buildSampleContext(AVAILABLE_VARIABLES);
  const resolved = previewMode ? renderVariables(block.content, ctx) : '';

  switch (block.type) {
    case 'contract-header':
      return (
        <div className="flex justify-between items-center mb-2 text-[13px]">
          <VariableHighlighter text={block.content} previewMode={previewMode} resolvedText={resolved} />
        </div>
      );

    case 'heading':
      return (
        <h2 className="text-center font-bold text-[18px] my-3">
          <VariableHighlighter text={block.content} previewMode={previewMode} resolvedText={resolved} />
        </h2>
      );

    case 'subheading':
      return (
        <h3 className="font-bold text-[15px] mt-3 mb-1">
          <VariableHighlighter text={block.content} previewMode={previewMode} resolvedText={resolved} />
        </h3>
      );

    case 'paragraph':
    case 'party-info':
    case 'product-info':
    case 'agreement':
      return (
        <p className="text-[14px] leading-relaxed my-1 indent-8">
          <VariableHighlighter text={block.content} previewMode={previewMode} resolvedText={resolved} />
        </p>
      );

    case 'emergency-contacts':
      if (previewMode) {
        const contacts = ctx['EMERGENCY_CONTACTS'] as { NAME: string; TEL: string; RELATION: string }[];
        return (
          <div className="my-2 text-[14px]">
            <p className="mb-1">(กรณีที่ผู้ให้เช่าซื้อติดต่อผู้เช่าซื้อไม่ได้ ขอให้ติดต่อบุคคลดังต่อไปนี้)</p>
            {contacts.map((c, i) => (
              <p key={i} className="ml-8">
                {i + 1}. ชื่อ-นามสกุล {c.NAME}{'       '}เบอร์โทรศัพท์ {c.TEL}{'       '}ความสัมพันธ์ {c.RELATION}
              </p>
            ))}
          </div>
        );
      }
      return (
        <div className="my-2 text-[14px]">
          <VariableHighlighter text={block.content} previewMode={false} />
        </div>
      );

    case 'clause': {
      const resolvedClause = previewMode ? renderVariables(block.content, ctx) : '';
      return (
        <div className="my-2">
          <p className="text-[14px] font-bold">
            ข้อ {block.clauseNumber} {block.clauseTitle}
          </p>
          <p className="text-[14px] leading-relaxed indent-8 mt-1">
            <VariableHighlighter text={block.content} previewMode={previewMode} resolvedText={resolvedClause} />
          </p>
          {block.subItems && block.subItems.length > 0 && (
            <div className="ml-12 mt-1 space-y-0.5">
              {block.subItems.map((item, i) => {
                const resolvedItem = previewMode ? renderVariables(item, ctx) : '';
                return (
                  <p key={i} className="text-[13px] leading-relaxed">
                    <VariableHighlighter text={item} previewMode={previewMode} resolvedText={resolvedItem} />
                  </p>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    case 'payment-table':
      return <PaymentTable previewMode={previewMode} />;

    case 'signature-block':
      return <SignatureBlock />;

    case 'photo-attachment':
      return (
        <div className="my-4">
          <p className="text-[14px] font-bold mb-3 text-center">รูปถ่ายโทรศัพท์แนบท้ายสัญญา</p>
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4, 5, 6].map(n => (
              <div key={n} className="border-2 border-dashed border-gray-300 rounded-lg h-32 flex items-center justify-center text-gray-400 text-sm">
                รูปภาพ {n}
              </div>
            ))}
          </div>
          <div className="mt-4 text-center text-[14px]">
            <p>ชื่อ .............................. ผู้เช่าซื้อ</p>
            <p>วันที่ .......... เดือน .................. พ.ศ ............</p>
          </div>
        </div>
      );

    case 'attachment-list':
      return (
        <div className="my-3 text-[14px]">
          {block.content.split('\n').map((line, i) => (
            <p key={i} className={i === 0 ? 'font-bold mb-1' : 'ml-4'}>
              <VariableHighlighter text={line} previewMode={previewMode} resolvedText={previewMode ? renderVariables(line, ctx) : ''} />
            </p>
          ))}
        </div>
      );

    case 'column':
    case 'column-vertical':
      return (
        <div className={`my-2 grid grid-cols-2 gap-4 text-[14px] ${block.type === 'column-vertical' ? 'items-start' : 'items-center'}`}>
          {block.content.split('||').map((col, i) => (
            <div key={i}>
              <VariableHighlighter text={col.trim()} previewMode={previewMode} resolvedText={previewMode ? renderVariables(col.trim(), ctx) : ''} />
            </div>
          ))}
        </div>
      );

    case 'numbered':
      return (
        <div className="my-1 ml-8 text-[14px]">
          <VariableHighlighter text={block.content} previewMode={previewMode} resolvedText={resolved} />
        </div>
      );

    default:
      return (
        <p className="text-[14px] my-1">
          <VariableHighlighter text={block.content} previewMode={previewMode} resolvedText={resolved} />
        </p>
      );
  }
}
