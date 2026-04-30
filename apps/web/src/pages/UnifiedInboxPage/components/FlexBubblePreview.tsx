import React from 'react';

/**
 * Simplified renderer for LINE Flex Message JSON. Mirrors the bubble customer
 * sees in LINE so staff have visual confirmation in the inbox without parsing
 * raw JSON or Flex DSL strings.
 *
 * Supports: bubble + carousel; box / text / button / spacer / separator nodes.
 * Full LINE fidelity (gradients, exact size scaling) is out of scope for v1 —
 * goal is "same shape and colours" not pixel-perfect.
 */

interface FlexBubblePreviewProps {
  flex: unknown;
}

interface FlexNode {
  type?: string;
  layout?: string;
  contents?: FlexNode[];
  backgroundColor?: string;
  paddingAll?: string;
  paddingTop?: string;
  paddingBottom?: string;
  paddingStart?: string;
  paddingEnd?: string;
  cornerRadius?: string | number;
  borderColor?: string;
  borderWidth?: string;
  spacing?: string;
  justifyContent?: string;
  alignItems?: string;
  flex?: number;
  margin?: string;
  // text node
  text?: string;
  size?: string;
  weight?: string;
  color?: string;
  align?: string;
  wrap?: boolean;
  // button node
  style?: string;
  height?: string;
  action?: { label?: string; uri?: string; type?: string };
  // separator
}

interface FlexBubble {
  type?: 'bubble' | 'carousel';
  size?: string;
  header?: FlexNode;
  hero?: FlexNode;
  body?: FlexNode;
  footer?: FlexNode;
  contents?: FlexBubble[]; // carousel
  styles?: Record<string, { backgroundColor?: string }>;
}

const SIZE_MAP: Record<string, string> = {
  xxs: '11px',
  xs: '12px',
  sm: '13px',
  md: '14px',
  lg: '16px',
  xl: '18px',
  xxl: '22px',
  '3xl': '26px',
  '4xl': '30px',
  '5xl': '36px',
};

const SPACING_MAP: Record<string, string> = {
  none: '0',
  xs: '2px',
  sm: '4px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  xxl: '20px',
};

const PADDING_MAP: Record<string, string> = {
  none: '0',
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '20px',
  xxl: '24px',
};

function resolvePadding(value?: string): string | undefined {
  if (!value) return undefined;
  return PADDING_MAP[value] ?? value;
}

function resolveSpacing(value?: string): string {
  if (!value) return '4px';
  return SPACING_MAP[value] ?? value;
}

function renderNode(node: FlexNode | undefined, key?: number): React.ReactNode {
  if (!node) return null;
  const k = key ?? 0;

  if (node.type === 'box') {
    const isHorizontal = node.layout === 'horizontal' || node.layout === 'baseline';
    const padding = resolvePadding(node.paddingAll);
    const paddingTop = resolvePadding(node.paddingTop);
    const paddingBottom = resolvePadding(node.paddingBottom);
    const paddingStart = resolvePadding(node.paddingStart);
    const paddingEnd = resolvePadding(node.paddingEnd);
    const radius =
      typeof node.cornerRadius === 'number'
        ? `${node.cornerRadius}px`
        : resolvePadding(node.cornerRadius);
    return (
      <div
        key={k}
        style={{
          background: node.backgroundColor,
          padding,
          paddingTop,
          paddingBottom,
          paddingLeft: paddingStart,
          paddingRight: paddingEnd,
          display: 'flex',
          flexDirection: isHorizontal ? 'row' : 'column',
          gap: resolveSpacing(node.spacing),
          justifyContent: node.justifyContent,
          alignItems: node.alignItems,
          borderRadius: radius,
          border: node.borderColor ? `${node.borderWidth || '1px'} solid ${node.borderColor}` : undefined,
          flex: node.flex,
        }}
      >
        {(node.contents || []).map((child, idx) => renderNode(child, idx))}
      </div>
    );
  }

  if (node.type === 'text') {
    return (
      <span
        key={k}
        style={{
          fontSize: SIZE_MAP[node.size || 'md'] || '14px',
          fontWeight: node.weight === 'bold' ? 700 : 400,
          color: node.color,
          textAlign: (node.align as React.CSSProperties['textAlign']) || 'left',
          flex: node.flex,
          whiteSpace: node.wrap ? 'pre-wrap' : 'nowrap',
          overflow: node.wrap ? undefined : 'hidden',
          textOverflow: node.wrap ? undefined : 'ellipsis',
          lineHeight: 1.4,
        }}
      >
        {node.text}
      </span>
    );
  }

  if (node.type === 'button') {
    const isPrimary = node.style === 'primary' || !node.style;
    const isLink = node.style === 'link';
    const bg = node.color || (isPrimary ? 'hsl(var(--primary))' : 'transparent');
    const fg = isLink ? 'hsl(var(--foreground))' : '#ffffff';
    return (
      <button
        key={k}
        type="button"
        style={{
          background: bg,
          color: fg,
          border: 'none',
          padding: '10px 12px',
          borderRadius: 8,
          fontWeight: 700,
          fontSize: 13,
          width: '100%',
          cursor: 'default',
        }}
        disabled
      >
        {node.action?.label}
      </button>
    );
  }

  if (node.type === 'spacer') {
    return <div key={k} style={{ height: SPACING_MAP[node.size || 'md'] || '8px' }} />;
  }

  if (node.type === 'separator') {
    return (
      <div
        key={k}
        style={{
          height: 1,
          background: node.color || 'hsl(var(--border))',
          width: '100%',
          margin: node.margin ? resolvePadding(node.margin) : undefined,
        }}
      />
    );
  }

  return null;
}

function renderBubble(bubble: FlexBubble, key?: number): React.ReactNode {
  const headerBg = bubble.styles?.header?.backgroundColor;
  const bodyBg = bubble.styles?.body?.backgroundColor;
  const footerBg = bubble.styles?.footer?.backgroundColor;

  return (
    <div
      key={key ?? 0}
      className="rounded-2xl overflow-hidden border border-border shadow-sm"
      style={{ background: 'hsl(var(--card))', width: 260, flexShrink: 0 }}
    >
      {bubble.header && (
        <div style={{ background: headerBg }}>{renderNode(bubble.header)}</div>
      )}
      {bubble.body && (
        <div style={{ background: bodyBg }}>{renderNode(bubble.body)}</div>
      )}
      {bubble.footer && (
        <div style={{ background: footerBg, borderTop: '1px solid hsl(var(--border))' }}>
          {renderNode(bubble.footer)}
        </div>
      )}
    </div>
  );
}

export default function FlexBubblePreview({ flex }: FlexBubblePreviewProps) {
  if (!flex || typeof flex !== 'object') {
    return <div className="text-xs text-muted-foreground italic">Flex Message (ไม่สามารถแสดงได้)</div>;
  }

  const root = flex as FlexBubble;

  if (root.type === 'carousel' && Array.isArray(root.contents)) {
    return (
      <div className="flex gap-2 overflow-x-auto max-w-[280px] pb-1">
        {root.contents.map((b, idx) => renderBubble(b, idx))}
      </div>
    );
  }

  // Single bubble (default)
  return renderBubble(root);
}
