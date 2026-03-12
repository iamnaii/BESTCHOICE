import { create } from 'zustand';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import type { Block, Template, TemplateSettings } from '@/types/template';
import { DEFAULT_SETTINGS } from '@/types/template';
import { AVAILABLE_VARIABLES } from '@/constants/variables';
import { createDefaultContractBlocks } from '@/constants/contractClauses';
import { uid } from '@/utils/uid';

interface HistoryEntry {
  blocks: Block[];
  settings: TemplateSettings;
}

// Shape returned by the API
interface ApiTemplate {
  id: string;
  name: string;
  type: string;
  contentHtml: string;
  blocks: Block[] | null;
  settings: TemplateSettings | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface TemplateStore {
  // Current template
  currentTemplate: Template;
  templates: { id: string; name: string }[];

  // Editor state
  previewMode: boolean;
  editingBlock: Block | null;
  showSettings: boolean;
  showExportModal: boolean;

  // Loading
  isLoading: boolean;
  isSaving: boolean;

  // Undo/Redo
  history: HistoryEntry[];
  historyIndex: number;

  // Auto-save
  lastSaved: Date | null;
  isDirty: boolean;

  // Actions - API
  fetchTemplates: () => Promise<void>;
  loadTemplate: (id: string) => Promise<void>;
  saveTemplateToApi: () => Promise<void>;

  // Actions - Template
  setCurrentTemplate: (id: string) => void;
  selectTemplate: (name: string) => void;

  // Actions - Blocks
  addBlock: (type: Block['type'], afterId?: string) => void;
  updateBlock: (id: string, updates: Partial<Block>) => void;
  deleteBlock: (id: string) => void;
  duplicateBlock: (id: string) => void;
  moveBlock: (fromIndex: number, toIndex: number) => void;
  reorderBlocks: (ids: string[]) => void;
  toggleCollapse: (id: string) => void;

  // Actions - Settings
  updateSettings: (updates: Partial<TemplateSettings>) => void;
  setShowSettings: (show: boolean) => void;

  // Actions - Editor
  setPreviewMode: (mode: boolean) => void;
  setEditingBlock: (block: Block | null) => void;
  setShowExportModal: (show: boolean) => void;

  // Actions - History
  undo: () => void;
  redo: () => void;
  pushHistory: () => void;

  // Actions - Save (localStorage draft)
  saveTemplate: () => void;
  loadFromLocalStorage: () => void;
}

const DRAFT_KEY = 'bcp-template-draft';
let _loadRequestId = 0; // Track latest loadTemplate request to prevent race conditions

function createInitialTemplate(): Template {
  return {
    id: '',
    name: 'สัญญาเช่าซื้อโทรศัพท์มือถือ',
    settings: { ...DEFAULT_SETTINGS },
    blocks: createDefaultContractBlocks(),
    variables: AVAILABLE_VARIABLES,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** Convert API response to frontend Template */
function apiToTemplate(t: ApiTemplate): Template {
  return {
    id: t.id,
    name: t.name,
    settings: (t.settings as TemplateSettings) || { ...DEFAULT_SETTINGS },
    blocks: Array.isArray(t.blocks) && t.blocks.length > 0 ? t.blocks : createDefaultContractBlocks(),
    variables: AVAILABLE_VARIABLES,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

/** Detect if content contains HTML tags (from rich text editor) */
function isHtml(s: string) {
  return /<\/?(?:p|div|span|br|h[1-6]|ul|ol|li|strong|em|u|s|mark|blockquote|a|table|tr|td|th|thead|tbody|img)\b[^>]*\/?>/i.test(s);
}

/** Strip HTML tags to plain text, preserving paragraph breaks */
function stripHtmlToText(html: string): string {
  return html
    .replace(/<\/(?:p|div|li)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .trim();
}

/** Build contentHtml from blocks — matches the template editor preview layout */
function blocksToHtml(blocks: Block[]): string {
  let clauseCounter = 0;
  return blocks.map(b => {
    const content = b.content || '';
    const rich = isHtml(content);

    switch (b.type) {
      case 'contract-header': {
        // Preserve rich HTML (bold, etc.) — only strip block tags to keep inline
        const inline = rich ? content.replace(/<\/?(?:p|div)[^>]*>/gi, '').trim() : content;
        if (inline.includes('||')) {
          const [left, right] = inline.split('||').map(s => s.trim());
          return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:15px;color:#4a4a4a"><div>${left}</div><div>${right || ''}</div></div>`;
        }
        return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:15px;color:#4a4a4a"><div>${inline}</div></div>`;
      }

      case 'heading':
        return `<h2 style="text-align:center;font-weight:700;font-size:20px;margin:16px 0 12px;letter-spacing:0.5px;color:#111">${rich ? content : content}</h2>`;

      case 'subheading':
        return `<h3 style="font-weight:700;font-size:17px;margin-top:14px;margin-bottom:6px;color:#222">${rich ? content : content}</h3>`;

      case 'paragraph':
      case 'party-info':
      case 'product-info':
      case 'agreement':
        if (rich) {
          return `<div style="font-size:16px;line-height:1.8;margin:4px 0;color:#1a1a1a">${content}</div>`;
        }
        return `<p style="font-size:16px;line-height:1.8;margin:4px 0;text-indent:2em;color:#1a1a1a">${content}</p>`;

      case 'emergency-contacts':
        // The backend replaces {{= EMERGENCY_CONTACTS }} with a rendered table
        if (rich) {
          return `<div style="margin:8px 0;font-size:16px">${content}</div>`;
        }
        return `<div style="margin:8px 0;font-size:16px"><p style="margin-bottom:4px">${content.split('\n')[0] || ''}</p>{{= EMERGENCY_CONTACTS }}</div>`;

      case 'clause': {
        clauseCounter++;
        const lines = rich ? stripHtmlToText(content).split('\n').filter((l: string) => l.trim()) : content.split('\n').filter((l: string) => l.trim());
        let html = `<div style="margin:10px 0"><p style="font-size:16px;font-weight:700;color:#111">ข้อ ${clauseCounter} ${b.clauseTitle || ''}</p><div style="font-size:16px;line-height:1.8;margin-top:4px;color:#1a1a1a">`;
        if (lines[0]) {
          html += `<p style="text-indent:2em;margin-bottom:2px">${lines[0]}</p>`;
        }
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          const displayLine = /^\d+[).]\s/.test(line) ? line : `${i}) ${line}`;
          html += `<p style="margin-left:3em;margin-bottom:2px">${displayLine}</p>`;
        }
        if (b.subItems?.length) {
          b.subItems.forEach((s, i) => {
            html += `<p style="margin-left:3em;margin-bottom:2px">${clauseCounter}.${i + 1} ${isHtml(s) ? stripHtmlToText(s) : s}</p>`;
          });
        }
        html += '</div></div>';
        return html;
      }

      case 'payment-table':
        return `<div style="margin:12px 0">{{= INSTALLMENTS }}</div>`;

      case 'signature-block':
        // Must match SignatureBlock.tsx exactly: 2 rows, dot-line style, 16px font, line-height 2
        return `<div style="margin:32px 0;font-size:16px;line-height:2">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 32px;margin-bottom:32px">
            <div style="text-align:center"><div>ลงชื่อ..................................................ผู้ให้เช่าซื้อ</div><div>( {{= COMPANY.DIRECTOR }} )</div><div style="font-size:14px;color:#666">ผู้จัดการ {{= COMPANY.NAME_TH }}</div></div>
            <div style="text-align:center"><div>ลงชื่อ..................................................ผู้เช่าซื้อ</div><div>( {{= CUSTOMER.NAME }} )</div></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 32px">
            <div style="text-align:center"><div>ลงชื่อ..................................................พยาน</div><div>(${' '.repeat(30)})</div></div>
            <div style="text-align:center"><div>ลงชื่อ..................................................พยาน</div><div>(${' '.repeat(30)})</div></div>
          </div>
        </div>`;

      case 'photo-attachment':
        return `<div style="margin:20px 0;page-break-before:always">
          <p style="font-size:16px;font-weight:700;margin-bottom:12px;text-align:center">รูปถ่ายโทรศัพท์แนบท้ายสัญญา</p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            ${[1,2,3,4,5,6].map(n => `<div style="border:2px dashed #d1d5db;border-radius:8px;height:120px;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:15px">รูปภาพ ${n}</div>`).join('')}
          </div>
          <div style="margin-top:16px;text-align:center;font-size:16px">
            <p>ชื่อ .............................. ผู้เช่าซื้อ</p>
            <p>วันที่ .......... เดือน .................. พ.ศ ............</p>
          </div>
        </div>`;

      case 'attachment-list': {
        if (rich) {
          return `<div style="margin:12px 0;font-size:16px">${content}</div>`;
        }
        const lines2 = content.split('\n');
        return `<div style="margin:12px 0;font-size:16px">${lines2.map((line: string, i: number) =>
          `<p style="font-weight:${i === 0 ? 700 : 400};margin-left:${i === 0 ? 0 : '2em'};margin-bottom:2px">${line}</p>`
        ).join('')}</div>`;
      }

      case 'column':
      case 'column-vertical': {
        if (rich) {
          return `<div style="margin:8px 0;font-size:16px">${content}</div>`;
        }
        const cols = content.split('||').map((s: string) => s.trim());
        const align = b.type === 'column-vertical' ? 'start' : 'center';
        return `<div style="margin:8px 0;display:grid;grid-template-columns:1fr 1fr;gap:16px;font-size:16px;align-items:${align}">${cols.map((col: string) => `<div>${col}</div>`).join('')}</div>`;
      }

      case 'numbered':
        if (rich) {
          return `<div style="margin:4px 0;margin-left:2em;font-size:16px">${content}</div>`;
        }
        return `<div style="margin:4px 0;margin-left:2em;font-size:16px">${content}</div>`;

      default:
        if (rich) {
          return `<div style="font-size:16px;margin:4px 0">${content}</div>`;
        }
        return `<p style="font-size:16px;margin:4px 0">${content}</p>`;
    }
  }).join('\n');
}

export const useTemplateStore = create<TemplateStore>((set, get) => ({
  currentTemplate: createInitialTemplate(),
  templates: [],
  previewMode: false,
  editingBlock: null,
  showSettings: false,
  showExportModal: false,
  isLoading: false,
  isSaving: false,
  history: [],
  historyIndex: -1,
  lastSaved: null,
  isDirty: false,

  // ─── API Actions ─────────────────────────────────────

  fetchTemplates: async () => {
    set({ isLoading: true });
    try {
      const { data } = await api.get<ApiTemplate[]>('/contract-templates');
      const list = data.map(t => ({ id: t.id, name: t.name }));
      set({ templates: list });

      // If we don't have a current template loaded from API, load the first one
      const { currentTemplate } = get();
      if (!currentTemplate.id && list.length > 0) {
        await get().loadTemplate(list[0].id);
      }
    } catch {
      // API not available — fall back to local defaults
      set({
        templates: [{ id: '', name: 'สัญญาเช่าซื้อโทรศัพท์มือถือ (ร่าง)' }],
      });
    } finally {
      set({ isLoading: false });
    }
  },

  loadTemplate: async (id: string) => {
    const requestId = ++_loadRequestId;
    set({ isLoading: true });
    try {
      const { data } = await api.get<ApiTemplate>(`/contract-templates/${id}`);
      // Ignore stale response if a newer loadTemplate was called
      if (requestId !== _loadRequestId) return;
      const template = apiToTemplate(data);
      set({
        currentTemplate: template,
        history: [],
        historyIndex: -1,
        isDirty: false,
      });
    } catch {
      if (requestId !== _loadRequestId) return;
      toast.error('โหลดเทมเพลตไม่สำเร็จ');
    } finally {
      if (requestId === _loadRequestId) {
        set({ isLoading: false });
      }
    }
  },

  saveTemplateToApi: async () => {
    const { currentTemplate, isSaving } = get();
    if (isSaving) return;
    set({ isSaving: true });

    const contentHtml = blocksToHtml(currentTemplate.blocks);

    try {
      if (currentTemplate.id) {
        // Update existing — do NOT send `type` (not in UpdateTemplateDto)
        const { data } = await api.patch<ApiTemplate>(`/contract-templates/${currentTemplate.id}`, {
          name: currentTemplate.name,
          contentHtml,
          blocks: currentTemplate.blocks,
          settings: currentTemplate.settings,
        });
        set(state => ({
          currentTemplate: { ...state.currentTemplate, updatedAt: data.updatedAt },
          isDirty: false,
          lastSaved: new Date(),
        }));
      } else {
        // Create new — include `type` for CreateTemplateDto
        const { data } = await api.post<ApiTemplate>('/contract-templates', {
          name: currentTemplate.name,
          type: 'STORE_DIRECT',
          contentHtml,
          blocks: currentTemplate.blocks,
          settings: currentTemplate.settings,
        });
        const template = apiToTemplate(data);
        set(state => ({
          currentTemplate: template,
          templates: [...state.templates, { id: data.id, name: data.name }],
          isDirty: false,
          lastSaved: new Date(),
        }));
      }
      toast.success('บันทึกเทมเพลตสำเร็จ');
      // Also save to localStorage as backup
      get().saveTemplate();
    } catch {
      toast.error('บันทึกไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      set({ isSaving: false });
    }
  },

  // ─── Template Selection ──────────────────────────────

  setCurrentTemplate: (id) => {
    get().loadTemplate(id);
  },

  selectTemplate: (name) => {
    const tmpl = get().templates.find(t => t.name === name);
    if (tmpl?.id) get().loadTemplate(tmpl.id);
  },

  // ─── Block Actions ───────────────────────────────────

  addBlock: (type, afterId) => {
    get().pushHistory();
    set(state => {
      const blocks = [...state.currentTemplate.blocks];
      const newBlock: Block = {
        id: uid(),
        type,
        content: '',
        order: blocks.length,
        ...(type === 'clause' ? { clauseNumber: 0, clauseTitle: '', subItems: [] } : {}),
      };
      if (afterId) {
        const idx = blocks.findIndex(b => b.id === afterId);
        if (idx !== -1) {
          blocks.splice(idx + 1, 0, newBlock);
        } else {
          blocks.push(newBlock);
        }
      } else {
        blocks.push(newBlock);
      }
      const ordered = blocks.map((b, i) => ({ ...b, order: i }));
      return {
        currentTemplate: { ...state.currentTemplate, blocks: ordered, updatedAt: new Date().toISOString() },
        isDirty: true,
      };
    });
    toast.success('เพิ่ม block แล้ว', { duration: 1500 });
  },

  updateBlock: (id, updates) => {
    get().pushHistory();
    set(state => ({
      currentTemplate: {
        ...state.currentTemplate,
        blocks: state.currentTemplate.blocks.map(b => b.id === id ? { ...b, ...updates } : b),
        updatedAt: new Date().toISOString(),
      },
      isDirty: true,
    }));
  },

  deleteBlock: (id) => {
    get().pushHistory();
    set(state => {
      const blocks = state.currentTemplate.blocks
        .filter(b => b.id !== id)
        .map((b, i) => ({ ...b, order: i }));
      return {
        currentTemplate: { ...state.currentTemplate, blocks, updatedAt: new Date().toISOString() },
        isDirty: true,
      };
    });
    toast.success('ลบ block แล้ว', { duration: 1500 });
  },

  duplicateBlock: (id) => {
    get().pushHistory();
    set(state => {
      const blocks = [...state.currentTemplate.blocks];
      const idx = blocks.findIndex(b => b.id === id);
      if (idx === -1) return state;
      const clone: Block = JSON.parse(JSON.stringify(blocks[idx]));
      clone.id = uid();
      blocks.splice(idx + 1, 0, clone);
      const ordered = blocks.map((b, i) => ({ ...b, order: i }));
      return {
        currentTemplate: { ...state.currentTemplate, blocks: ordered, updatedAt: new Date().toISOString() },
        isDirty: true,
      };
    });
    toast.success('สำเนา block แล้ว', { duration: 1500 });
  },

  moveBlock: (fromIndex, toIndex) => {
    get().pushHistory();
    set(state => {
      const blocks = [...state.currentTemplate.blocks];
      const [moved] = blocks.splice(fromIndex, 1);
      blocks.splice(toIndex, 0, moved);
      const ordered = blocks.map((b, i) => ({ ...b, order: i }));
      return {
        currentTemplate: { ...state.currentTemplate, blocks: ordered, updatedAt: new Date().toISOString() },
        isDirty: true,
      };
    });
  },

  reorderBlocks: (ids) => {
    get().pushHistory();
    set(state => {
      const blockMap = new Map(state.currentTemplate.blocks.map(b => [b.id, b]));
      const blocks = ids
        .map((id, i) => {
          const block = blockMap.get(id);
          if (!block) return null;
          return { ...block, order: i };
        })
        .filter((b): b is NonNullable<typeof b> => b !== null);
      return {
        currentTemplate: { ...state.currentTemplate, blocks, updatedAt: new Date().toISOString() },
        isDirty: true,
      };
    });
  },

  toggleCollapse: (id) => {
    set(state => ({
      currentTemplate: {
        ...state.currentTemplate,
        blocks: state.currentTemplate.blocks.map(b =>
          b.id === id ? { ...b, collapsed: !b.collapsed } : b
        ),
      },
    }));
  },

  // ─── Settings ────────────────────────────────────────

  updateSettings: (updates) => {
    get().pushHistory();
    set(state => ({
      currentTemplate: {
        ...state.currentTemplate,
        settings: { ...state.currentTemplate.settings, ...updates },
        updatedAt: new Date().toISOString(),
      },
      isDirty: true,
    }));
  },

  setShowSettings: (show) => set({ showSettings: show }),
  setPreviewMode: (mode) => set({ previewMode: mode }),
  setEditingBlock: (block) => set({ editingBlock: block }),
  setShowExportModal: (show) => set({ showExportModal: show }),

  // ─── Undo / Redo ────────────────────────────────────

  undo: () => {
    const { history, historyIndex } = get();
    if (historyIndex < 0 || history.length === 0) return;
    const entry = history[historyIndex];
    set(state => ({
      currentTemplate: {
        ...state.currentTemplate,
        blocks: JSON.parse(JSON.stringify(entry.blocks)),
        settings: JSON.parse(JSON.stringify(entry.settings)),
      },
      historyIndex: historyIndex - 1,
      isDirty: true,
    }));
  },

  redo: () => {
    const { history, historyIndex } = get();
    if (historyIndex >= history.length - 1) return;
    const entry = history[historyIndex + 1];
    set(state => ({
      currentTemplate: {
        ...state.currentTemplate,
        blocks: JSON.parse(JSON.stringify(entry.blocks)),
        settings: JSON.parse(JSON.stringify(entry.settings)),
      },
      historyIndex: historyIndex + 1,
    }));
  },

  pushHistory: () => {
    set(state => {
      const entry: HistoryEntry = {
        blocks: JSON.parse(JSON.stringify(state.currentTemplate.blocks)),
        settings: JSON.parse(JSON.stringify(state.currentTemplate.settings)),
      };
      // Truncate any redo entries beyond current position
      const newHistory = state.history.slice(0, state.historyIndex + 1);
      newHistory.push(entry);
      if (newHistory.length > 50) {
        newHistory.shift();
        return { history: newHistory, historyIndex: newHistory.length - 1 };
      }
      return { history: newHistory, historyIndex: newHistory.length - 1 };
    });
  },

  // ─── localStorage Draft ──────────────────────────────

  saveTemplate: () => {
    const state = get();
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        template: state.currentTemplate,
        savedAt: new Date().toISOString(),
      }));
      set({ lastSaved: new Date(), isDirty: false });
    } catch {
      // localStorage full
    }
  },

  loadFromLocalStorage: () => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const { template } = JSON.parse(saved);
        if (template?.blocks?.length) {
          set({ currentTemplate: template, isDirty: false });
        }
      }
    } catch {
      // ignore
    }
  },
}));
