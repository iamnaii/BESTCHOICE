// Document Template Editor types

export type BlockType =
  | 'paragraph'
  | 'heading'
  | 'contract-header'
  | 'party-info'
  | 'emergency-contacts'
  | 'product-info'
  | 'clause'
  | 'payment-table'
  | 'column'
  | 'column-vertical'
  | 'agreement'
  | 'subheading'
  | 'numbered'
  | 'signature-block'
  | 'photo-attachment'
  | 'attachment-list';

export interface Block {
  id: string;
  type: BlockType;
  content: string;
  collapsed?: boolean;
  order: number;
  clauseNumber?: number;
  clauseTitle?: string;
  subItems?: string[];
}

export interface TemplateSettings {
  letterhead: 'none' | 'bestchoice' | 'logo';
  showPageNumber: boolean;
  pageNumberFormat: string;
  showSignatureExceptLastPage: boolean;
  footerText: string;
  footerContent: string;
  margins: { top: number; bottom: number; left: number; right: number };
  fontSize: { body: number; heading: number; footer: number };
}

export interface Template {
  id: string;
  name: string;
  settings: TemplateSettings;
  blocks: Block[];
  variables: VariableDefinition[];
  createdAt: string;
  updatedAt: string;
}

export interface VariableDefinition {
  key: string;
  label: string;
  type: 'text' | 'date' | 'number' | 'array';
  sampleValue: any;
}

export interface BlockTypeInfo {
  value: BlockType;
  label: string;
  description: string;
}

// Thai legal contract standard: TH Sarabun PSK 16pt body, A4 with binding margin
export const DEFAULT_SETTINGS: TemplateSettings = {
  letterhead: 'bestchoice',
  showPageNumber: true,
  pageNumberFormat: 'หน้า {page}/{total}',
  showSignatureExceptLastPage: false,
  footerText: 'BESTCHOICEPHONE Co., Ltd.',
  footerContent: '',
  margins: { top: 25, bottom: 20, left: 30, right: 25 },
  fontSize: { body: 16, heading: 20, footer: 12 },
};
