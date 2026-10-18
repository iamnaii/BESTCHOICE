import { NativeSelect } from '@/components/ui/native-select';
import { useState, useRef } from 'react';
import { ArrowLeft, Settings, Plus, Save, Undo2, Download, Loader2, BookOpen, Columns2, PenLine, Eye, FileUp } from 'lucide-react';
import { useTemplateStore } from '@/store/templateStore';
import api from '@/lib/api';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { BlockType } from '@/types/template';
import type { ViewMode } from '@/pages/ContractTemplatesPage';

interface Props {
  onBack?: () => void;
  onToggleCheatSheet?: () => void;
  showCheatSheet?: boolean;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

const QUICK_ADD_BLOCKS: { type: BlockType; label: string }[] = [
  { type: 'paragraph', label: 'ข้อความ' },
  { type: 'clause', label: 'ข้อสัญญา' },
  { type: 'heading', label: 'หัวเรื่อง' },
  { type: 'subheading', label: 'หัวข้อย่อย' },
  { type: 'party-info', label: 'คู่สัญญา' },
  { type: 'product-info', label: 'ข้อมูลสินค้า' },
  { type: 'payment-table', label: 'ตารางค่างวด' },
  { type: 'signature-block', label: 'ช่องลายเซ็น' },
  { type: 'photo-attachment', label: 'แนบรูปภาพ' },
];

const VIEW_MODES: { mode: ViewMode; icon: typeof Columns2; label: string }[] = [
  { mode: 'editor', icon: PenLine, label: 'แก้ไข' },
  { mode: 'split', icon: Columns2, label: 'แบ่งหน้า' },
  { mode: 'preview', icon: Eye, label: 'Preview' },
];

export default function HeaderBar({ onBack, onToggleCheatSheet, showCheatSheet, viewMode, onViewModeChange }: Props) {
  const {
    currentTemplate, templates, isSaving, isLoading,
    setShowSettings, setShowExportModal,
    addBlock, saveTemplateToApi, undo, isDirty, loadTemplate,
    previewMode, setPreviewMode,
  } = useTemplateStore();

  const [isGenerating, setIsGenerating] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; message: string; action: () => void }>({ open: false, message: '', action: () => {} });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleGenerateFromFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsGenerating(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = (reader.result as string).split(',')[1];
          const { data } = await api.post('/contract-templates/generate-from-file', {
            fileBase64: base64,
            fileName: file.name,
          }, { timeout: 120000 });
          toast.success(`สร้างเทมเพลตจากไฟล์สำเร็จ: ${data.name}`);
          await useTemplateStore.getState().fetchTemplates();
          if (data.id) await useTemplateStore.getState().loadTemplate(data.id);
        } catch {
          toast.error('ไม่สามารถสร้างเทมเพลตจากไฟล์ได้');
        } finally {
          setIsGenerating(false);
        }
      };
      reader.readAsDataURL(file);
    } catch {
      setIsGenerating(false);
      toast.error('เกิดข้อผิดพลาด');
    }
    e.target.value = '';
  };

  const handleTemplateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    if (id && id !== currentTemplate.id) {
      if (isDirty) {
        setConfirmDialog({ open: true, message: 'มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก ต้องการเปลี่ยนเทมเพลตหรือไม่?', action: () => loadTemplate(id) });
        return;
      }
      loadTemplate(id);
    }
  };

  return (
    <div className="min-h-14 min-w-0 shrink-0 bg-card border-b border-border flex flex-wrap items-center p-3 gap-2 [&_button]:min-h-11 [&_button]:min-w-11 [&_svg]:shrink-0">
      {/* === Left: Navigation & Template === */}
      {onBack && (
        <button data-ui-control="button" data-ui-icon="true"
          onClick={onBack}
          aria-label="กลับ"
          className="flex items-center gap-1 p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
      )}

      <NativeSelect wrapperClassName="w-auto min-w-0 flex-1 basis-48 max-w-full lg:max-w-80"
        aria-label="เทมเพลตสัญญา"
        value={currentTemplate.id}
        onChange={handleTemplateChange}
        disabled={isLoading}
        className="min-h-11 px-3 py-2 text-base font-medium border border-input rounded-lg bg-background focus:ring-2 focus:ring-primary focus:border-primary disabled:opacity-50"
      >
        {templates.length === 0 && (
          <option value="">กำลังโหลด...</option>
        )}
        {templates.map(t => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </NativeSelect>

      {isDirty && (
        <span className="text-sm font-medium text-warning-strong bg-warning/10 px-2.5 py-1 rounded-full">
          ยังไม่บันทึก
        </span>
      )}
      {isSaving && (
        <span className="text-sm text-primary flex items-center gap-1">
          <Loader2 size={14} className="animate-spin" />
          <span>กำลังบันทึก...</span>
        </span>
      )}

      <div className="flex-1" />

      {/* === Center: View Controls === */}
      <div className="flex items-center gap-1.5">
        {/* Preview mode toggle */}
        {(viewMode === 'split' || viewMode === 'preview') && (
          <button data-ui-control="button"
            onClick={() => setPreviewMode(!previewMode)}
            className={`flex items-center gap-1.5 px-3 py-2 text-base rounded-lg transition-colors ${
              previewMode
                ? 'bg-info/15 text-info border border-info/30'
                : 'text-muted-foreground border border-input hover:bg-muted'
            }`}
            title="แสดงข้อมูลตัวอย่าง"
          >
            ตัวอย่างข้อมูล
          </button>
        )}

        {/* Cheat sheet toggle */}
        {onToggleCheatSheet && (
          <button data-ui-control="button"
            onClick={onToggleCheatSheet}
            className={`flex items-center gap-1.5 px-3 py-2 text-base rounded-lg transition-colors ${
              showCheatSheet
                ? 'bg-warning/15 text-warning-strong border border-warning/30'
                : 'text-muted-foreground border border-input hover:bg-muted'
            }`}
          >
            <BookOpen size={17} />
            ตัวแปร
          </button>
        )}

        <button data-ui-control="button"
          onClick={() => setShowSettings(true)}
          aria-label="ตั้งค่าเทมเพลต"
          className="flex items-center gap-1.5 px-3 py-2 text-base text-muted-foreground border border-input rounded-lg hover:bg-muted transition-colors"
        >
          <Settings size={17} />
          <span className="hidden lg:inline">ตั้งค่า</span>
        </button>
      </div>

      {/* Divider */}
      <div className="w-px h-7 bg-border mx-1" />

      {/* === Right: Actions === */}
      <div className="flex items-center gap-1.5">
        {/* Add block dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button data-ui-control="button" className="flex items-center gap-1.5 px-3 py-2 text-base text-foreground border border-input rounded-lg hover:bg-muted transition-colors">
              <Plus size={17} />
              เพิ่ม
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" collisionPadding={8} className="w-52 max-w-[calc(100vw-1rem)] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto">
            {QUICK_ADD_BLOCKS.map(b => (
              <DropdownMenuItem key={b.type} onSelect={() => addBlock(b.type)} className="min-h-11 px-3 text-base">
                {b.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.html,.txt" onChange={handleGenerateFromFile} className="hidden" />
        <button data-ui-control="button"
          onClick={() => fileInputRef.current?.click()}
          aria-label="สร้างเทมเพลตจากไฟล์"
          disabled={isGenerating}
          className="flex items-center gap-1.5 px-3 py-2 text-base text-foreground border border-input rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
          title="สร้างเทมเพลตจากไฟล์ (OCR)"
        >
          {isGenerating ? <Loader2 size={17} className="animate-spin" /> : <FileUp size={17} />}
          <span className="hidden lg:inline">จากไฟล์</span>
        </button>

        <button data-ui-control="button"
          onClick={() => saveTemplateToApi()}
          aria-label="บันทึกเทมเพลต"
          disabled={isSaving}
          className="flex items-center gap-1.5 px-3 py-2 text-base text-foreground border border-input rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
        >
          {isSaving ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />}
          <span className="hidden lg:inline">บันทึก</span>
        </button>

        <button data-ui-control="button" data-ui-icon="true"
          onClick={() => undo()}
          className="p-2 text-muted-foreground border border-input rounded-lg hover:bg-muted transition-colors"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 size={17} />
        </button>
      </div>

      {/* Divider */}
      <div className="w-px h-7 bg-border mx-1" />

      {/* === Far Right: View Mode & Export === */}
      <div className="flex items-center gap-1.5">
        {/* View mode selector */}
        <div className="flex items-center border border-input rounded-lg overflow-hidden">
          {VIEW_MODES.map(({ mode, icon: Icon, label }) => (
            <button
              key={mode}
              onClick={() => onViewModeChange(mode)}
              className={`${mode === 'split' ? 'hidden lg:flex' : 'flex'} items-center gap-1.5 px-3 py-2 text-base transition-colors ${
                viewMode === mode
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
              title={label}
            >
              <Icon size={17} />
              <span className="hidden xl:inline">{label}</span>
            </button>
          ))}
        </div>

        <button data-ui-control="button"
          onClick={() => setShowExportModal(true)}
          className="flex items-center gap-1.5 px-4 py-2 text-base font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
        >
          <Download size={17} />
          PDF
        </button>
      </div>
      <ConfirmDialog open={confirmDialog.open} onOpenChange={(open) => setConfirmDialog(prev => ({ ...prev, open }))} description={confirmDialog.message} onConfirm={confirmDialog.action} />
    </div>
  );
}
