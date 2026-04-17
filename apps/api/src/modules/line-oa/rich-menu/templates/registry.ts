import { buildFinanceDefaultTemplate } from './finance-default.template';
import { buildFinanceVerifiedTemplate } from './finance-verified.template';
import { RichMenuTemplate, TemplateContext } from './types';

export type TemplateKey =
  | 'finance-default'
  | 'finance-verified';

export interface TemplateEntry {
  key: TemplateKey;
  channel: 'shop' | 'finance';
  variant: 'default' | 'verified';
  build: (ctx: TemplateContext) => RichMenuTemplate;
  /** Which TemplateContext fields this template needs */
  requires: Array<keyof TemplateContext>;
}

export const TEMPLATE_REGISTRY: TemplateEntry[] = [
  {
    key: 'finance-default',
    channel: 'finance',
    variant: 'default',
    build: buildFinanceDefaultTemplate,
    requires: ['liffId'],
  },
  {
    key: 'finance-verified',
    channel: 'finance',
    variant: 'verified',
    build: buildFinanceVerifiedTemplate,
    requires: ['liffId', 'callCenterPhone'],
  },
];

export function getTemplateEntry(key: string): TemplateEntry | undefined {
  return TEMPLATE_REGISTRY.find((e) => e.key === key);
}
