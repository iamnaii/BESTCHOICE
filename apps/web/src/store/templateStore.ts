import { create } from 'zustand';
import toast from 'react-hot-toast';
import type { Block, Template, TemplateSettings } from '@/types/template';
import { DEFAULT_SETTINGS } from '@/types/template';
import { AVAILABLE_VARIABLES } from '@/constants/variables';
import { createDefaultContractBlocks } from '@/constants/contractClauses';
import { uid } from '@/utils/uid';

interface HistoryEntry {
  blocks: Block[];
  settings: TemplateSettings;
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

  // Undo/Redo
  history: HistoryEntry[];
  historyIndex: number;

  // Auto-save
  lastSaved: Date | null;
  isDirty: boolean;

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

  // Actions - Save
  saveTemplate: () => void;
  loadFromLocalStorage: () => void;
}

const TEMPLATE_LIST = [
  { id: 'hire-purchase', name: 'สัญญาเช่าซื้อโทรศัพท์มือถือ' },
  { id: 'power-of-attorney', name: 'หนังสือมอบอำนาจ' },
  { id: 'split-payment-diff', name: 'ขอแบ่งชำระ (ผู้ซื้อกับผู้ผ่อนคนละคน)' },
  { id: 'split-payment-same', name: 'ขอแบ่งชำระ (คนเดียวกัน)' },
  { id: 'consent', name: 'หนังสือยินยอม' },
  { id: 'quotation', name: 'ใบเสนอราคา' },
];

function createInitialTemplate(): Template {
  return {
    id: 'hire-purchase',
    name: 'สัญญาเช่าซื้อโทรศัพท์มือถือ',
    settings: { ...DEFAULT_SETTINGS },
    blocks: createDefaultContractBlocks(),
    variables: AVAILABLE_VARIABLES,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const AUTO_SAVE_KEY = 'bcp-template-draft';

export const useTemplateStore = create<TemplateStore>((set, get) => ({
  currentTemplate: createInitialTemplate(),
  templates: TEMPLATE_LIST,
  previewMode: false,
  editingBlock: null,
  showSettings: false,
  showExportModal: false,
  history: [],
  historyIndex: -1,
  lastSaved: null,
  isDirty: false,

  setCurrentTemplate: (id) => {
    const tmpl = TEMPLATE_LIST.find(t => t.id === id);
    if (!tmpl) return;
    set({
      currentTemplate: {
        ...createInitialTemplate(),
        id: tmpl.id,
        name: tmpl.name,
      },
      history: [],
      historyIndex: -1,
    });
  },

  selectTemplate: (name) => {
    const tmpl = TEMPLATE_LIST.find(t => t.name === name);
    if (tmpl) get().setCurrentTemplate(tmpl.id);
  },

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
      // Reorder
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
      const clone = { ...blocks[idx], id: uid() };
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

  undo: () => {
    const { history, historyIndex } = get();
    if (historyIndex < 0) return;
    const entry = history[historyIndex];
    set(state => ({
      currentTemplate: {
        ...state.currentTemplate,
        blocks: entry.blocks,
        settings: entry.settings,
      },
      historyIndex: historyIndex - 1,
    }));
  },

  redo: () => {
    const { history, historyIndex } = get();
    if (historyIndex >= history.length - 2) return;
    const entry = history[historyIndex + 2];
    if (!entry) return;
    set(state => ({
      currentTemplate: {
        ...state.currentTemplate,
        blocks: entry.blocks,
        settings: entry.settings,
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
      const newHistory = state.history.slice(0, state.historyIndex + 1);
      newHistory.push(entry);
      // Keep max 50 entries
      if (newHistory.length > 50) newHistory.shift();
      return { history: newHistory, historyIndex: newHistory.length - 1 };
    });
  },

  saveTemplate: () => {
    const state = get();
    try {
      localStorage.setItem(AUTO_SAVE_KEY, JSON.stringify({
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
      const saved = localStorage.getItem(AUTO_SAVE_KEY);
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
