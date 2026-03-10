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

/** Build contentHtml from blocks for backward compatibility */
function blocksToHtml(blocks: Block[]): string {
  const isHtml = (s: string) => /<\/?(?:p|div|span|br|h[1-6]|ul|ol|li|strong|em|u|s|mark|blockquote|a|table|tr|td|th|thead|tbody|img)\b[^>]*\/?>/i.test(s);
  return blocks.map(b => {
    // If content is already rich HTML (from Tiptap), pass through directly
    if (isHtml(b.content)) {
      if (b.type === 'clause') {
        let html = `<p><strong>ข้อ ${b.clauseNumber ?? ''} ${b.clauseTitle ?? ''}</strong></p>${b.content}`;
        if (b.subItems?.length) {
          html += b.subItems.map((s, i) => isHtml(s) ? s : `<p>${b.clauseNumber}.${i + 1} ${s}</p>`).join('');
        }
        return html;
      }
      return b.content;
    }
    // Plain text fallback
    if (b.type === 'heading' || b.type === 'contract-header') {
      return `<h2>${b.content}</h2>`;
    }
    if (b.type === 'clause') {
      let html = `<p><strong>ข้อ ${b.clauseNumber ?? ''} ${b.clauseTitle ?? ''}</strong></p><p>${b.content}</p>`;
      if (b.subItems?.length) {
        html += b.subItems.map((s, i) => `<p>${b.clauseNumber}.${i + 1} ${s}</p>`).join('');
      }
      return html;
    }
    return `<p>${b.content}</p>`;
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
    set({ isLoading: true });
    try {
      const { data } = await api.get<ApiTemplate>(`/contract-templates/${id}`);
      const template = apiToTemplate(data);
      set({
        currentTemplate: template,
        history: [],
        historyIndex: -1,
        isDirty: false,
      });
    } catch {
      toast.error('โหลดเทมเพลตไม่สำเร็จ');
    } finally {
      set({ isLoading: false });
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
        blocks.splice(idx + 1, 0, newBlock);
      } else {
        blocks.push(newBlock);
      }
      blocks.forEach((b, i) => b.order = i);
      return {
        currentTemplate: { ...state.currentTemplate, blocks, updatedAt: new Date().toISOString() },
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
      const blocks = state.currentTemplate.blocks.filter(b => b.id !== id);
      blocks.forEach((b, i) => b.order = i);
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
      const clone = { ...blocks[idx], id: uid(), subItems: blocks[idx].subItems ? [...blocks[idx].subItems] : undefined };
      blocks.splice(idx + 1, 0, clone);
      blocks.forEach((b, i) => b.order = i);
      return {
        currentTemplate: { ...state.currentTemplate, blocks, updatedAt: new Date().toISOString() },
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
      blocks.forEach((b, i) => b.order = i);
      return {
        currentTemplate: { ...state.currentTemplate, blocks, updatedAt: new Date().toISOString() },
        isDirty: true,
      };
    });
  },

  reorderBlocks: (ids) => {
    get().pushHistory();
    set(state => {
      const blockMap = new Map(state.currentTemplate.blocks.map(b => [b.id, b]));
      const blocks = ids.map((id, i) => {
        const block = blockMap.get(id)!;
        return { ...block, order: i };
      });
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
    // historyIndex points to the current state snapshot; we go back one
    if (historyIndex <= 0) return;
    const entry = history[historyIndex - 1];
    set(state => ({
      currentTemplate: {
        ...state.currentTemplate,
        blocks: JSON.parse(JSON.stringify(entry.blocks)),
        settings: { ...entry.settings },
      },
      historyIndex: historyIndex - 1,
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
        settings: { ...entry.settings },
      },
      historyIndex: historyIndex + 1,
    }));
  },

  pushHistory: () => {
    set(state => {
      const entry: HistoryEntry = {
        blocks: JSON.parse(JSON.stringify(state.currentTemplate.blocks)),
        settings: { ...state.currentTemplate.settings },
      };
      // Truncate any redo entries beyond current position
      const newHistory = state.history.slice(0, state.historyIndex + 1);
      newHistory.push(entry);
      if (newHistory.length > 50) newHistory.shift();
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
