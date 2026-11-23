import {
  createElement,
  forwardRef,
  type SVGProps,
  type RefAttributes,
  type ForwardRefExoticComponent,
} from 'react';
import type { Icon } from '@phosphor-icons/react';

export type AppIconProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
  alt?: string;
  title?: string;
  absoluteStrokeWidth?: boolean;
};
export type AppIcon = ForwardRefExoticComponent<
  Omit<AppIconProps, 'ref'> & RefAttributes<SVGSVGElement>
>;

/** Shared Phosphor treatment for pages, controls, status indicators and navigation. */
export function createAppIcon(Glyph: Icon, name: string): AppIcon {
  const AppGlyph = forwardRef<SVGSVGElement, AppIconProps>((props, ref) => {
    const svgProps = { ...props };
    // Phosphor draws filled paths; legacy outline sizing must not add a second stroke.
    delete svgProps.strokeWidth;
    delete svgProps.absoluteStrokeWidth;
    delete svgProps.stroke;
    if (svgProps.fill === 'none') delete svgProps.fill;
    // Preserve SVG content, accessibility attributes and interaction supplied by the caller.
    const hasSemantics =
      svgProps.children != null ||
      svgProps.alt != null ||
      svgProps.title != null ||
      svgProps.role != null ||
      svgProps.tabIndex != null ||
      svgProps.focusable === true ||
      svgProps.focusable === 'true' ||
      Object.entries(svgProps).some(([key, value]) =>
        value != null && (key.startsWith('aria-') || /^on[A-Z]/.test(key)),
      );
    if (!hasSemantics) svgProps['aria-hidden'] = true;
    return createElement(Glyph, {
      ...svgProps,
      ref,
      size: props.size ?? 24,
      weight: 'duotone',
      className: ['app-icon', 'app-icon-' + name, props.className].filter(Boolean).join(' '),
      ...{ 'data-icon-style': 'duotone' },
    });
  });
  AppGlyph.displayName = 'AppIcon(' + name + ')';
  return AppGlyph;
}
