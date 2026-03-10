import DOMPurify from 'dompurify';
import type { Block } from '@/types/template';
import { renderVariables, buildSampleContext } from '@/utils/templateRenderer';
import { AVAILABLE_VARIABLES } from '@/constants/variables';
import VariableHighlighter from './VariableHighlighter';
import PaymentTable from './PaymentTable';
import SignatureBlock from './SignatureBlock';

interface Props {
  block: Block;
  previewMode: boolean;
  clauseIndex?: number;
}

// Memoize sample context at module level — AVAILABLE_VARIABLES is static
let _cachedCtx: Record<string, any> | null = null;
function getSampleContext() {
  if (!_cachedCtx) _cachedCtx = buildSampleContext(AVAILABLE_VARIABLES);
  return _cachedCtx;
}

/** Detect if content contains HTML tags (from rich text editor) */
function isHtmlContent(content: string): boolean {
  // Match actual HTML tags like <p>, <div>, <span>, <h1>, <br/>, <strong>, etc.
  // Avoids false positives on plain text with comparison operators like "x < y"
  return /<\/?(?:p|div|span|br|h[1-6]|ul|ol|li|strong|em|u|s|mark|blockquote|a|table|tr|td|th|thead|tbody|img)\b[^>]*\/?>/i.test(content);
}

/** Render HTML content with variable substitution and sanitization */
function RichHtmlContent({ html, previewMode, ctx }: { html: string; previewMode: boolean; ctx: Record<string, any> }) {
  const resolved = previewMode ? renderVariables(html, ctx) : html;
  // In edit mode, highlight variable tags via CSS
  const withHighlights = previewMode
    ? resolved
    : resolved.replace(
        /\{\{=\s*([^}]*)\}\}/g,
        '<span style="background:#d1fae5;color:#047857;padding:1px 4px;border-radius:3px;font-family:monospace;font-size:0.85em">{{= $1}}</span>'
      );
  const clean = DOMPurify.sanitize(withHighlights, {
    ADD_TAGS: ['span'],
    ADD_ATTR: ['style', 'data-variable', 'class'],
  });
  return <div dangerouslySetInnerHTML={{ __html: clean }} />;
}

/** Render inline HTML — strips block tags (p/div) to keep content inline for flex layouts */
function InlineHtmlContent({ html, previewMode, ctx }: { html: string; previewMode: boolean; ctx: Record<string, any> }) {
  const resolved = previewMode ? renderVariables(html, ctx) : html;
  const withHighlights = previewMode
    ? resolved
    : resolved.replace(
        /\{\{=\s*([^}]*)\}\}/g,
        '<span style="background:#d1fae5;color:#047857;padding:1px 4px;border-radius:3px;font-family:monospace;font-size:0.85em">{{= $1}}</span>'
      );
  // Strip block-level wrappers so content stays inline
  const stripped = withHighlights
    .replace(/<\/?(?:p|div)[^>]*>/gi, '')
    .trim();
  const clean = DOMPurify.sanitize(stripped, {
    ADD_TAGS: ['span'],
    ADD_ATTR: ['style', 'data-variable', 'class'],
  });
  return <span dangerouslySetInnerHTML={{ __html: clean }} />;
}

/** Strip HTML tags to get plain text */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

/** Convert HTML content to an array of text lines (splitting on block-level tags) */
function htmlToLines(html: string): string[] {
  // Replace closing block tags with newline markers, then strip all tags
  const withBreaks = html
    .replace(/<\/(?:p|div|li|br\s*\/?)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .trim();
  return withBreaks.split('\n').filter(line => line.trim() !== '');
}

export default function BlockRenderer({ block, previewMode, clauseIndex }: Props) {
  const ctx = getSampleContext();
  const resolved = previewMode ? renderVariables(block.content, ctx) : '';
  const isRich = isHtmlContent(block.content);

  switch (block.type) {
    case 'contract-header': {
      if (isRich) {
        // Rich text — preserve bold formatting, split on ||, render inline for flex layout
        const parts = block.content.split('||');
        return (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', fontSize: '15px', color: '#4a4a4a' }}>
            <div>
              <InlineHtmlContent html={parts[0]?.trim() || ''} previewMode={previewMode} ctx={ctx} />
            </div>
            {parts[1] && (
              <div style={{ flexShrink: 0, textAlign: 'right' }}>
                <InlineHtmlContent html={parts[1]?.trim() || ''} previewMode={previewMode} ctx={ctx} />
              </div>
            )}
          </div>
        );
      }
      // Plain text fallback
      const plainContent = block.content;
      let leftPart: string;
      let rightPart: string;
      if (plainContent.includes('||')) {
        const parts = plainContent.split('||');
        leftPart = parts[0]?.trim() || '';
        rightPart = parts[1]?.trim() || '';
      } else {
        const splitIdx = plainContent.indexOf('วันที่ทำสัญญา');
        if (splitIdx > 0) {
          leftPart = plainContent.substring(0, splitIdx).trim();
          rightPart = plainContent.substring(splitIdx).trim();
        } else {
          leftPart = plainContent;
          rightPart = '';
        }
      }
      const resolvedLeft = previewMode ? renderVariables(leftPart, ctx) : leftPart;
      const resolvedRight = previewMode ? renderVariables(rightPart, ctx) : rightPart;
      return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', fontSize: '15px', color: '#4a4a4a' }}>
          <div>
            <VariableHighlighter text={leftPart} previewMode={previewMode} resolvedText={resolvedLeft} />
          </div>
          {rightPart && (
            <div>
              <VariableHighlighter text={rightPart} previewMode={previewMode} resolvedText={resolvedRight} />
            </div>
          )}
        </div>
      );
    }

    case 'heading':
      return (
        <h2 style={{ textAlign: 'center', fontWeight: 700, fontSize: '20px', margin: '16px 0 12px', letterSpacing: '0.5px', color: '#111' }}>
          {isRich
            ? <RichHtmlContent html={block.content} previewMode={previewMode} ctx={ctx} />
            : <VariableHighlighter text={block.content} previewMode={previewMode} resolvedText={resolved} />
          }
        </h2>
      );

    case 'subheading':
      return (
        <h3 style={{ fontWeight: 700, fontSize: '17px', marginTop: '14px', marginBottom: '6px', color: '#222' }}>
          {isRich
            ? <RichHtmlContent html={block.content} previewMode={previewMode} ctx={ctx} />
            : <VariableHighlighter text={block.content} previewMode={previewMode} resolvedText={resolved} />
          }
        </h3>
      );

    case 'paragraph':
    case 'party-info':
    case 'product-info':
    case 'agreement':
      if (isRich) {
        return (
          <div style={{ fontSize: '16px', lineHeight: 1.8, margin: '4px 0', color: '#1a1a1a' }}>
            <RichHtmlContent html={block.content} previewMode={previewMode} ctx={ctx} />
          </div>
        );
      }
      return (
        <p style={{ fontSize: '16px', lineHeight: 1.8, margin: '4px 0', textIndent: '2em', color: '#1a1a1a' }}>
          <VariableHighlighter text={block.content} previewMode={previewMode} resolvedText={resolved} />
        </p>
      );

    case 'emergency-contacts':
      if (previewMode) {
        const contacts = (ctx['EMERGENCY_CONTACTS'] || []) as { NAME: string; TEL: string; RELATION: string }[];
        return (
          <div style={{ margin: '8px 0', fontSize: '16px' }}>
            <p style={{ marginBottom: '4px' }}>(กรณีที่ผู้ให้เช่าซื้อติดต่อผู้เช่าซื้อไม่ได้ ขอให้ติดต่อบุคคลดังต่อไปนี้)</p>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginLeft: '2em' }}>
              <tbody>
                {contacts.map((c, i) => (
                  <tr key={i}>
                    <td style={{ padding: '2px 8px 2px 0', width: '24px' }}>{i + 1}.</td>
                    <td style={{ padding: '2px 8px' }}>ชื่อ-นามสกุล {c.NAME}</td>
                    <td style={{ padding: '2px 8px' }}>เบอร์โทร {c.TEL}</td>
                    <td style={{ padding: '2px 8px' }}>ความสัมพันธ์ {c.RELATION}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      return (
        <div style={{ margin: '8px 0', fontSize: '16px' }}>
          {isRich
            ? <RichHtmlContent html={block.content} previewMode={false} ctx={ctx} />
            : <VariableHighlighter text={block.content} previewMode={false} />
          }
        </div>
      );

    case 'clause': {
      const displayNumber = clauseIndex ?? block.clauseNumber;
      // Always work with plain text lines for consistent rendering
      // Convert HTML <p> tags to newlines so sub-item numbering is preserved
      const plainContent = isRich ? htmlToLines(block.content) : block.content.split('\n');
      const resolvedContent = previewMode
        ? (isRich ? htmlToLines(renderVariables(block.content, ctx)) : renderVariables(block.content, ctx).split('\n'))
        : [];
      return (
        <div style={{ margin: '10px 0' }}>
          <p style={{ fontSize: '16px', fontWeight: 700, color: '#111' }}>
            ข้อ {displayNumber} {block.clauseTitle}
          </p>
          <div style={{ fontSize: '16px', lineHeight: 1.8, marginTop: '4px', color: '#1a1a1a' }}>
            {plainContent.map((line, i) => {
              const isSubItem = i > 0;
              const resolvedLine = resolvedContent[i] || '';
              // Auto-number sub-items if they don't already have a number prefix
              const displayLine = isSubItem && line.trim() && !/^\d+[).]\s/.test(line.trim())
                ? `${i}) ${line.trim()}`
                : line;
              const displayResolved = isSubItem && resolvedLine.trim() && !/^\d+[).]\s/.test(resolvedLine.trim())
                ? `${i}) ${resolvedLine.trim()}`
                : resolvedLine;
              return (
                <p key={i} style={{ textIndent: isSubItem ? '0' : '2em', marginLeft: isSubItem ? '3em' : '0', marginBottom: '2px' }}>
                  <VariableHighlighter text={displayLine} previewMode={previewMode} resolvedText={displayResolved} />
                </p>
              );
            })}
          </div>
        </div>
      );
    }

    case 'payment-table':
      return <PaymentTable previewMode={previewMode} />;

    case 'signature-block':
      return <SignatureBlock previewMode={previewMode} />;

    case 'photo-attachment':
      return (
        <div style={{ margin: '20px 0', pageBreakBefore: 'always' }}>
          <p style={{ fontSize: '16px', fontWeight: 700, marginBottom: '12px', textAlign: 'center' }}>รูปถ่ายโทรศัพท์แนบท้ายสัญญา</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            {[1, 2, 3, 4, 5, 6].map(n => (
              <div key={n} style={{ border: '2px dashed #d1d5db', borderRadius: '8px', height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: '15px' }}>
                รูปภาพ {n}
              </div>
            ))}
          </div>
          <div style={{ marginTop: '16px', textAlign: 'center', fontSize: '16px' }}>
            <p>ชื่อ .............................. ผู้เช่าซื้อ</p>
            <p>วันที่ .......... เดือน .................. พ.ศ ............</p>
          </div>
        </div>
      );

    case 'attachment-list':
      if (isRich) {
        return (
          <div style={{ margin: '12px 0', fontSize: '16px' }}>
            <RichHtmlContent html={block.content} previewMode={previewMode} ctx={ctx} />
          </div>
        );
      }
      return (
        <div style={{ margin: '12px 0', fontSize: '16px' }}>
          {block.content.split('\n').map((line, i) => (
            <p key={i} style={{ fontWeight: i === 0 ? 700 : 400, marginLeft: i === 0 ? 0 : '2em', marginBottom: '2px' }}>
              <VariableHighlighter text={line} previewMode={previewMode} resolvedText={previewMode ? renderVariables(line, ctx) : ''} />
            </p>
          ))}
        </div>
      );

    case 'column':
    case 'column-vertical':
      if (isRich) {
        return (
          <div style={{ margin: '8px 0', fontSize: '16px' }}>
            <RichHtmlContent html={block.content} previewMode={previewMode} ctx={ctx} />
          </div>
        );
      }
      return (
        <div style={{ margin: '8px 0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', fontSize: '16px', alignItems: block.type === 'column-vertical' ? 'start' : 'center' }}>
          {block.content.split('||').map((col, i) => (
            <div key={i}>
              <VariableHighlighter text={col.trim()} previewMode={previewMode} resolvedText={previewMode ? renderVariables(col.trim(), ctx) : ''} />
            </div>
          ))}
        </div>
      );

    case 'numbered':
      if (isRich) {
        return (
          <div style={{ margin: '4px 0', marginLeft: '2em', fontSize: '16px' }}>
            <RichHtmlContent html={block.content} previewMode={previewMode} ctx={ctx} />
          </div>
        );
      }
      return (
        <div style={{ margin: '4px 0', marginLeft: '2em', fontSize: '16px' }}>
          <VariableHighlighter text={block.content} previewMode={previewMode} resolvedText={resolved} />
        </div>
      );

    default:
      if (isRich) {
        return (
          <div style={{ fontSize: '16px', margin: '4px 0' }}>
            <RichHtmlContent html={block.content} previewMode={previewMode} ctx={ctx} />
          </div>
        );
      }
      return (
        <p style={{ fontSize: '16px', margin: '4px 0' }}>
          <VariableHighlighter text={block.content} previewMode={previewMode} resolvedText={resolved} />
        </p>
      );
  }
}
