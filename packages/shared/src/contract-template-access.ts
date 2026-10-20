/** Finite global lookup. This grants neither editor content nor source rendering. */
export interface ContractTemplateReference {
  id: string;
  type: 'STORE_DIRECT' | 'CREDIT_CARD' | 'STORE_WITH_INTEREST' | null;
  isActive: boolean;
}

/** Current-owner editor payload. Arbitrary JSON/HTML is private, not a staff reference. */
export interface ContractTemplateEditor {
  id: string;
  name: string;
  type: string;
  contentHtml: string;
  placeholders: string[];
  blocks: unknown;
  settings: unknown;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
export interface ContractTemplatePage {
  data: Array<ContractTemplateReference | ContractTemplateEditor>;
  total: number;
  page: number;
  limit: number;
}
/** OCR returns an unsaved private draft; saving requires a separate authorized create. */
export interface ContractTemplateDraft {
  contentHtml: string;
  placeholders: string[];
}
