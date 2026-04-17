import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { LayoutGrid, Trash2, Star, Upload, Plus, ImageIcon, Pencil, Copy, Sparkles, Phone } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// ─── Types ──────────────────────────────────────────────────────────────────

interface RichMenu {
  richMenuId: string;
  name: string;
  selected: boolean;
  createdAt?: string;
}

interface RichMenuListResponse {
  richmenus: RichMenu[];
  defaultRichMenuId: string | null;
}

interface MenuButton {
  label: string;
  emoji: string;
  color: string;
  actionType: 'uri' | 'message';
  actionValue: string;
}

type LayoutType = '2x3' | '1x3' | '2x2';

// ─── Constants ───────────────────────────────────────────────────────────────

const COLOR_PRESETS = [
  { name: 'น้ำเงิน', value: '#3b82f6' },
  { name: 'เขียว', value: '#10b981' },
  { name: 'ม่วง', value: '#8b5cf6' },
  { name: 'ส้ม', value: '#f59e0b' },
  { name: 'ชมพู', value: '#ec4899' },
  { name: 'แดง', value: '#ef4444' },
  { name: 'ฟ้า', value: '#06b6d4' },
  { name: 'เทา', value: '#6b7280' },
];

const DEFAULT_BUTTONS: MenuButton[] = [
  { label: 'ดูสินค้า', emoji: '📱', color: '#3b82f6', actionType: 'uri', actionValue: '' },
  { label: 'ผ่อนชำระ', emoji: '💳', color: '#10b981', actionType: 'uri', actionValue: '' },
  { label: 'สัญญา', emoji: '📄', color: '#8b5cf6', actionType: 'uri', actionValue: '' },
  { label: 'ชำระเงิน', emoji: '💰', color: '#f59e0b', actionType: 'uri', actionValue: '' },
  { label: 'โปรโมชัน', emoji: '🎁', color: '#ec4899', actionType: 'message', actionValue: 'โปรโมชัน' },
  { label: 'ติดต่อ', emoji: '📞', color: '#06b6d4', actionType: 'message', actionValue: 'คุยกับพนักงาน' },
];

const LAYOUT_OPTIONS: { value: LayoutType; label: string; cols: number; rows: number }[] = [
  { value: '2x3', label: '2 แถว × 3 ปุ่ม (6 ปุ่ม)', cols: 3, rows: 2 },
  { value: '1x3', label: '1 แถว × 3 ปุ่ม (3 ปุ่ม)', cols: 3, rows: 1 },
  { value: '2x2', label: '2 แถว × 2 ปุ่ม (4 ปุ่ม)', cols: 2, rows: 2 },
];

// ─── Phone Preview ────────────────────────────────────────────────────────────

function PhonePreview({
  buttons,
  selectedButton,
  onSelectButton,
  layout,
  hasCustomImage = false,
}: {
  buttons: MenuButton[];
  selectedButton: number;
  onSelectButton: (i: number) => void;
  layout: LayoutType;
  hasCustomImage?: boolean;
}) {
  const layoutCfg = LAYOUT_OPTIONS.find((l) => l.value === layout) ?? LAYOUT_OPTIONS[0];
  const visibleButtons = buttons.slice(0, layoutCfg.cols * layoutCfg.rows);

  return (
    <div className="flex flex-col items-center">
      {/* Phone frame */}
      <div className="bg-foreground rounded-[2.5rem] p-3 shadow-modal w-[240px]">
        {/* Notch */}
        <div className="flex justify-center mb-1">
          <div className="w-16 h-4 bg-foreground rounded-full" />
        </div>

        {/* Screen */}
        <div className="bg-[#f0f0f0] rounded-[1.5rem] overflow-hidden">
          {/* LINE Chat header */}
          <div className="bg-[#06C755] px-3 py-2 flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-white/30 flex items-center justify-center text-white text-xs font-bold">
              BC
            </div>
            <span className="text-white text-xs font-semibold">BESTCHOICE</span>
          </div>

          {/* Chat area */}
          <div className="bg-[#c8e6c9] px-3 py-2 min-h-[110px] space-y-2">
            <div className="flex justify-end">
              <div className="bg-[#dcf8c6] text-[10px] px-2 py-1 rounded-xl rounded-br-none shadow-sm max-w-[120px]">
                สอบถามสินค้าราคาดี
              </div>
            </div>
            <div className="flex justify-start">
              <div className="bg-white text-[10px] px-2 py-1 rounded-xl rounded-bl-none shadow-sm max-w-[120px]">
                ยินดีให้บริการครับ 😊
              </div>
            </div>
          </div>

          {/* Rich Menu */}
          <div className="border-t border-border">
            <div
              className="grid gap-px bg-border"
              style={{ gridTemplateColumns: `repeat(${layoutCfg.cols}, 1fr)` }}
            >
              {visibleButtons.map((btn, i) => (
                <button
                  key={i}
                  onClick={() => onSelectButton(i)}
                  aria-label={`เลือกช่อง ${i + 1}`}
                  className="relative flex flex-col items-center justify-center py-3 gap-1 transition-all hover:brightness-90 focus:outline-none"
                  style={{ backgroundColor: hasCustomImage ? '#9ca3af' : btn.color }}
                >
                  {i === selectedButton && (
                    <div className="absolute inset-0 border-2 border-primary rounded-sm z-10 pointer-events-none" />
                  )}
                  {hasCustomImage ? (
                    <span className="text-white text-xs font-bold">ช่อง {i + 1}</span>
                  ) : (
                    <>
                      <span className="text-lg leading-snug">{btn.emoji}</span>
                      <span className="text-white text-[9px] font-semibold leading-tight px-1 text-center">
                        {btn.label}
                      </span>
                    </>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Home indicator */}
        <div className="flex justify-center mt-2">
          <div className="w-10 h-1 bg-muted-foreground rounded-full" />
        </div>
      </div>

      <p className="text-xs text-muted-foreground mt-3 text-center">
        กดปุ่มในตัวอย่างเพื่อเลือกแก้ไข
      </p>
    </div>
  );
}

// ─── Button Editor ────────────────────────────────────────────────────────────

function ButtonEditor({
  buttons,
  selectedButton,
  onSelectButton,
  onUpdateButton,
  layout,
  onLayoutChange,
  hasCustomImage = false,
}: {
  buttons: MenuButton[];
  selectedButton: number;
  onSelectButton: (i: number) => void;
  onUpdateButton: (i: number, updates: Partial<MenuButton>) => void;
  layout: LayoutType;
  onLayoutChange: (l: LayoutType) => void;
  hasCustomImage?: boolean;
}) {
  const layoutCfg = LAYOUT_OPTIONS.find((l) => l.value === layout) ?? LAYOUT_OPTIONS[0];
  const visibleCount = layoutCfg.cols * layoutCfg.rows;
  const btn = buttons[selectedButton];

  return (
    <div className="flex flex-col gap-5">
      {/* Layout selector */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">Layout เมนู</label>
        <select
          value={layout}
          onChange={(e) => onLayoutChange(e.target.value as LayoutType)}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {LAYOUT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Button tabs */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">เลือกช่อง</label>
        <div className="flex flex-wrap gap-1.5">
          {buttons.slice(0, visibleCount).map((b, i) => (
            <button
              key={i}
              onClick={() => onSelectButton(i)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                i === selectedButton
                  ? 'border-transparent text-white shadow-sm'
                  : 'border-border bg-background text-muted-foreground hover:border-primary/50'
              }`}
              style={
                i === selectedButton
                  ? { backgroundColor: hasCustomImage ? 'hsl(var(--primary))' : b.color }
                  : {}
              }
            >
              {hasCustomImage ? (
                <span>ช่อง {i + 1}</span>
              ) : (
                <>
                  <span>{b.emoji}</span>
                  <span>{b.label}</span>
                </>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Selected button config */}
      {btn && (
        <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
          <div
            className="flex items-center gap-2 pb-2 border-b border-border"
            style={{ color: hasCustomImage ? 'hsl(var(--foreground))' : btn.color }}
          >
            {hasCustomImage ? (
              <span className="font-semibold text-sm">ช่องที่ {selectedButton + 1}</span>
            ) : (
              <>
                <span className="text-lg">{btn.emoji}</span>
                <span className="font-semibold text-sm">ปุ่มที่ {selectedButton + 1}: {btn.label}</span>
              </>
            )}
          </div>

          {!hasCustomImage && (
            <>
              {/* Emoji */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">ไอคอน (Emoji)</label>
                <Input
                  value={btn.emoji}
                  onChange={(e) => onUpdateButton(selectedButton, { emoji: e.target.value })}
                  className="w-16 text-center text-lg"
                  maxLength={2}
                />
              </div>

              {/* Label */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">ชื่อปุ่ม</label>
                <Input
                  value={btn.label}
                  onChange={(e) => onUpdateButton(selectedButton, { label: e.target.value })}
                  placeholder="เช่น ดูสินค้า"
                  maxLength={12}
                />
                <p className="text-xs text-muted-foreground mt-0.5">{btn.label.length}/12 ตัวอักษร</p>
              </div>

              {/* Color */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">สีพื้นหลัง</label>
                <div className="flex flex-wrap gap-1.5">
                  {COLOR_PRESETS.map((preset) => (
                    <button
                      key={preset.value}
                      onClick={() => onUpdateButton(selectedButton, { color: preset.value })}
                      title={preset.name}
                      aria-label={preset.name}
                      className={`w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 ${
                        btn.color === preset.value ? 'border-foreground scale-110' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: preset.value }}
                    />
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Action type */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Action</label>
            <div className="flex gap-3">
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="radio"
                  name={`action-type-${selectedButton}`}
                  value="uri"
                  checked={btn.actionType === 'uri'}
                  onChange={() => onUpdateButton(selectedButton, { actionType: 'uri' })}
                  className="accent-primary"
                />
                เปิดลิงก์ (URL)
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="radio"
                  name={`action-type-${selectedButton}`}
                  value="message"
                  checked={btn.actionType === 'message'}
                  onChange={() => onUpdateButton(selectedButton, { actionType: 'message' })}
                  className="accent-primary"
                />
                ส่งข้อความ
              </label>
            </div>
          </div>

          {/* Action value */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              {btn.actionType === 'uri' ? 'URL' : 'ข้อความที่จะส่ง'}
            </label>
            <Input
              value={btn.actionValue}
              onChange={(e) => onUpdateButton(selectedButton, { actionValue: e.target.value })}
              placeholder={btn.actionType === 'uri' ? 'https://liff.line.me/...' : 'เช่น โปรโมชัน'}
              type={btn.actionType === 'uri' ? 'url' : 'text'}
              className="font-mono text-sm"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function RichMenuPage() {
  const queryClient = useQueryClient();

  // Channel
  const [channel, setChannel] = useState<'shop' | 'finance'>('shop');

  // Tab
  const [activeTab, setActiveTab] = useState<'create' | 'list'>('create');

  // Editor state
  const [buttons, setButtons] = useState<MenuButton[]>(DEFAULT_BUTTONS);
  const [selectedButton, setSelectedButton] = useState(0);
  const [menuName, setMenuName] = useState('BESTCHOICE Menu');
  const [chatBarText, setChatBarText] = useState('เมนู');
  const [layout, setLayout] = useState<LayoutType>('2x3');
  const [liffUrl, setLiffUrl] = useState('');

  // Custom image upload (create flow)
  const [customImageFile, setCustomImageFile] = useState<File | null>(null);
  const [customImagePreview, setCustomImagePreview] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // List tab state
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [editingMenuId, setEditingMenuId] = useState<string | null>(null);

  useEffect(() => {
    setLiffUrl('');
    setEditingMenuId(null);
    setCustomImageFile(null);
    setCustomImagePreview(null);
  }, [channel]);

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['rich-menu-list', channel],
    queryFn: async () => {
      const res = await api.get(`/line-oa/rich-menu/list?channel=${channel}`);
      return res.data as RichMenuListResponse;
    },
    retry: 1,
  });

  const { data: lineSettings } = useQuery({
    queryKey: ['line-oa-settings'],
    queryFn: async () => {
      const res = await api.get('/line-oa/settings');
      return res.data as { settings: Record<string, string>; isConfigured: boolean };
    },
  });

  const { data: financeIntegration } = useQuery({
    queryKey: ['integration-config', 'line-finance'],
    queryFn: async () => {
      const res = await api.get('/integrations/line-finance/config');
      return res.data as { config: Record<string, string> };
    },
  });

  const { data: aliases } = useQuery({
    queryKey: ['rich-menu-aliases'],
    queryFn: async () => {
      const res = await api.get('/line-oa/rich-menu/aliases');
      return res.data as {
        shopDefault: string | null;
        shopVerified: string | null;
        financeDefault: string | null;
        financeVerified: string | null;
      };
    },
  });

  const shopLiffId = lineSettings?.settings?.liff_id;
  const financeLiffId = financeIntegration?.config?.liffId;
  const activeLiffId = channel === 'shop' ? shopLiffId : financeLiffId;
  const defaultLiffUrl = activeLiffId ? `https://liff.line.me/${activeLiffId}` : '';
  const effectiveLiffUrl = liffUrl || defaultLiffUrl;

  // ── Mutations ─────────────────────────────────────────────────────────────

  function getButtonCount(l: LayoutType): number {
    if (l === '1x3') return 3;
    if (l === '2x2') return 4;
    return 6; // 2x3
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const visibleButtons = buttons.slice(0, getButtonCount(layout)).map((b) => ({
        label: b.label,
        emoji: b.emoji,
        color: b.color,
        actionType: b.actionType,
        actionValue: b.actionValue || effectiveLiffUrl,
      }));

      if (customImageFile) {
        // Use create-with-image endpoint (multipart form)
        const fd = new FormData();
        fd.append('image', customImageFile);
        fd.append(
          'config',
          JSON.stringify({
            name: menuName,
            chatBarText,
            liffUrl: effectiveLiffUrl,
            layout,
            buttons: visibleButtons,
            setAsDefault: true,
            channel,
          }),
        );
        const res = await api.post('/line-oa/rich-menu/create-with-image', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        return res.data as { richMenuId: string };
      }

      // Standard create (JSON)
      const res = await api.post('/line-oa/rich-menu/create-default', {
        liffUrl: effectiveLiffUrl,
        name: menuName,
        chatBarText,
        layout,
        buttons: visibleButtons,
        channel,
      });
      return res.data as { richMenuId: string };
    },
    onSuccess: async (data) => {
      toast.success(editingMenuId ? 'แก้ไข Rich Menu สำเร็จ' : 'สร้าง Rich Menu สำเร็จ');

      if (editingMenuId) {
        const oldMenuId = editingMenuId;
        try {
          if (data?.richMenuId) {
            await api.post(`/line-oa/rich-menu/${data.richMenuId}/set-default?channel=${channel}`);
          }
          await api.delete(`/line-oa/rich-menu/${oldMenuId}?channel=${channel}`);
        } catch (err) {
          console.error('Failed to cleanup old menu', err);
        }
        setEditingMenuId(null);
      }

      queryClient.invalidateQueries({ queryKey: ['rich-menu-list', channel] });
      queryClient.invalidateQueries({ queryKey: ['rich-menu-aliases'] });
      setActiveTab('list');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const setDefaultMutation = useMutation({
    mutationFn: async (menuId: string) => {
      await api.post(`/line-oa/rich-menu/${menuId}/set-default?channel=${channel}`);
    },
    onSuccess: () => {
      toast.success('ตั้งเป็น Default แล้ว');
      queryClient.invalidateQueries({ queryKey: ['rich-menu-list', channel] });
      queryClient.invalidateQueries({ queryKey: ['rich-menu-aliases'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (menuId: string) => {
      await api.delete(`/line-oa/rich-menu/${menuId}?channel=${channel}`);
    },
    onSuccess: () => {
      toast.success('ลบ Rich Menu แล้ว');
      queryClient.invalidateQueries({ queryKey: ['rich-menu-list', channel] });
      queryClient.invalidateQueries({ queryKey: ['rich-menu-aliases'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const uploadImageMutation = useMutation({
    mutationFn: async ({ menuId, file }: { menuId: string; file: File }) => {
      const formData = new FormData();
      formData.append('image', file);
      await api.post(`/line-oa/rich-menu/${menuId}/upload-image?channel=${channel}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: () => {
      toast.success('อัปโหลดรูป Rich Menu สำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['rich-menu-list', channel] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const setAliasMutation = useMutation({
    mutationFn: async ({ menuId, variant }: { menuId: string; variant: 'default' | 'verified' }) => {
      await api.post(`/line-oa/rich-menu/${menuId}/set-alias`, { channel, variant });
    },
    onSuccess: (_, vars) => {
      toast.success(`ตั้งเป็น ${vars.variant === 'default' ? 'Default' : 'Verified'} แล้ว`);
      queryClient.invalidateQueries({ queryKey: ['rich-menu-aliases'] });
      queryClient.invalidateQueries({ queryKey: ['rich-menu-list', channel] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  // Template deployment (FINANCE only for now)
  const { data: callCenterPhoneData, refetch: refetchCallCenterPhone } = useQuery({
    queryKey: ['rich-menu-call-center-phone', channel],
    queryFn: async () => {
      const res = await api.get(`/line-oa/rich-menu/call-center-phone?channel=${channel}`);
      return res.data as { phone: string | null };
    },
    enabled: channel === 'finance',
  });

  const [callCenterPhone, setCallCenterPhone] = useState('');
  useEffect(() => {
    if (callCenterPhoneData?.phone) {
      setCallCenterPhone(callCenterPhoneData.phone);
    }
  }, [callCenterPhoneData]);

  const saveCallCenterPhoneMutation = useMutation({
    mutationFn: async (phone: string) => {
      await api.post('/line-oa/rich-menu/call-center-phone', { channel, phone });
    },
    onSuccess: () => {
      toast.success('บันทึกเบอร์ติดต่อเรียบร้อย');
      refetchCallCenterPhone();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const deployTemplateMutation = useMutation({
    mutationFn: async (templateKey: 'finance-default' | 'finance-verified') => {
      const res = await api.post('/line-oa/rich-menu/deploy-template', { templateKey });
      return res.data as { richMenuId: string };
    },
    onSuccess: () => {
      toast.success('สร้าง + deploy Rich Menu จาก template สำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['rich-menu-list', channel] });
      queryClient.invalidateQueries({ queryKey: ['rich-menu-aliases'] });
      setActiveTab('list');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleEditMenu(menu: RichMenu) {
    setMenuName(menu.name);
    setEditingMenuId(menu.richMenuId);
    setActiveTab('create');
    toast.info('โหลดเมนูแล้ว — แก้ไขแล้วกดบันทึกเพื่อสร้างเมนูใหม่แทน');
  }

  function handleDuplicateMenu(menu: RichMenu) {
    setMenuName(menu.name + ' (copy)');
    setEditingMenuId(null);
    setActiveTab('create');
    toast.info('คัดลอกเมนูแล้ว — แก้ไขแล้วกดสร้างได้เลย');
  }

  function updateButton(index: number, updates: Partial<MenuButton>) {
    setButtons((prev) => prev.map((b, i) => (i === index ? { ...b, ...updates } : b)));
  }

  function handleCustomImageChange(file: File | null) {
    setCustomImageFile(file);
    if (file) {
      const url = URL.createObjectURL(file);
      setCustomImagePreview(url);
    } else {
      setCustomImagePreview(null);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader
        title="Rich Menu"
        subtitle="จัดการเมนูลัด LINE OA ที่ลูกค้าเห็นในหน้าแชท"
        icon={<LayoutGrid size={22} />}
      />

      {/* Channel tabs (SHOP / FINANCE) */}
      <div className="flex gap-1 mb-6 border-b border-border">
        {[
          { key: 'shop', label: '🛍 SHOP' },
          { key: 'finance', label: '💰 FINANCE' },
        ].map((ch) => (
          <button
            key={ch.key}
            onClick={() => setChannel(ch.key as 'shop' | 'finance')}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              channel === ch.key
                ? 'border-[#06C755] text-[#06C755]'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {ch.label}
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border">
        {[
          { key: 'create', label: 'สร้างเมนู' },
          { key: 'list', label: 'รายการเมนู' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as 'create' | 'list')}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab.key
                ? 'border-[#06C755] text-[#06C755]'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── TAB: สร้างเมนู ─────────────────────────────────────────────────── */}
      {activeTab === 'create' && (
        <div className="space-y-6">
          {/* FINANCE-only: Generate from template */}
          {channel === 'finance' && !editingMenuId && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-primary/20 bg-primary/10 flex items-center gap-2">
                <Sparkles size={18} className="text-primary" />
                <div>
                  <h2 className="text-base font-semibold text-foreground">สร้างอัตโนมัติจาก Template</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    ระบบจะ generate รูป + ติดตั้ง alias ให้ครบในคลิกเดียว
                  </p>
                </div>
              </div>
              <div className="p-5 space-y-4">
                {/* Call center phone input */}
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1 flex items-center gap-1.5">
                      <Phone size={14} />
                      เบอร์โทรศูนย์บริการ (Call Center)
                    </label>
                    <Input
                      type="tel"
                      value={callCenterPhone}
                      onChange={(e) => setCallCenterPhone(e.target.value)}
                      placeholder="เช่น 02-xxx-xxxx"
                      className="font-mono"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      ใช้บนปุ่ม "โทรหาเจ้าหน้าที่" ในเมนูหลัง verify
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => saveCallCenterPhoneMutation.mutate(callCenterPhone)}
                    disabled={!callCenterPhone || saveCallCenterPhoneMutation.isPending}
                  >
                    บันทึก
                  </Button>
                </div>

                {/* Template cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-lg border border-border bg-card p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-muted text-muted-foreground border-0">Pre-verify</Badge>
                      <span className="font-semibold text-sm">FINANCE — Default</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      เมนูก่อนลูกค้าผูกเบอร์: ผูกเบอร์ (hero) · วิธีชำระ · วิธีใช้งาน · ติดต่อ · FAQ · เปลี่ยนเบอร์
                    </p>
                    <Button
                      className="w-full bg-gradient-to-r from-[#06C755] to-[#04a844] hover:from-[#04a844] hover:to-[#038537] text-white border-0"
                      onClick={() => deployTemplateMutation.mutate('finance-default')}
                      disabled={deployTemplateMutation.isPending}
                    >
                      <Sparkles size={14} className="mr-1.5" />
                      {deployTemplateMutation.isPending &&
                      deployTemplateMutation.variables === 'finance-default'
                        ? 'กำลัง generate...'
                        : 'Generate + Deploy'}
                    </Button>
                  </div>

                  <div className="rounded-lg border border-border bg-card p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-primary/10 text-primary border-primary/30">Verified</Badge>
                      <span className="font-semibold text-sm">FINANCE — Verified</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      เมนูหลังผูกเบอร์: เช็คยอด (hero) · ตารางงวด · ชำระเงิน · ประวัติ · สัญญา · โทรหาเจ้าหน้าที่
                    </p>
                    <Button
                      className="w-full bg-gradient-to-r from-[#06C755] to-[#04a844] hover:from-[#04a844] hover:to-[#038537] text-white border-0"
                      onClick={() => deployTemplateMutation.mutate('finance-verified')}
                      disabled={deployTemplateMutation.isPending || !callCenterPhoneData?.phone}
                      title={!callCenterPhoneData?.phone ? 'กรุณาบันทึกเบอร์โทรก่อน' : undefined}
                    >
                      <Sparkles size={14} className="mr-1.5" />
                      {deployTemplateMutation.isPending &&
                      deployTemplateMutation.variables === 'finance-verified'
                        ? 'กำลัง generate...'
                        : 'Generate + Deploy'}
                    </Button>
                    {!callCenterPhoneData?.phone && (
                      <p className="text-xs text-destructive">
                        ต้องบันทึกเบอร์โทรก่อนจึงจะ deploy ได้
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {editingMenuId && (
            <div className="bg-warning/10 border border-warning/20 rounded-xl p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Pencil size={16} className="text-warning" />
                <span className="text-sm text-warning">กำลังแก้ไขเมนู — บันทึกจะสร้างเมนูใหม่แทนอันเก่า</span>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setEditingMenuId(null)}>
                ยกเลิก
              </Button>
            </div>
          )}

          {/* Section 1: Preview + Button Editor */}
          <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border bg-muted/30">
              <h2 className="text-base font-semibold text-foreground">ออกแบบปุ่มเมนู</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                กดปุ่มในตัวอย่างเพื่อเลือกแก้ไข
              </p>
            </div>

            <div className="p-5 grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-8">
              {/* Phone Preview */}
              <PhonePreview
                buttons={buttons}
                selectedButton={selectedButton}
                onSelectButton={setSelectedButton}
                layout={layout}
                hasCustomImage={customImageFile !== null}
              />

              {/* Button Editor */}
              <ButtonEditor
                buttons={buttons}
                selectedButton={selectedButton}
                onSelectButton={setSelectedButton}
                onUpdateButton={updateButton}
                layout={layout}
                onLayoutChange={setLayout}
                hasCustomImage={customImageFile !== null}
              />
            </div>
          </div>

          {/* Section 2: Menu Settings */}
          <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border bg-muted/30">
              <h2 className="text-base font-semibold text-foreground">ตั้งค่าเมนู</h2>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">ชื่อเมนู</label>
                <Input
                  value={menuName}
                  onChange={(e) => setMenuName(e.target.value)}
                  placeholder="BESTCHOICE Menu"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  ข้อความแถบเมนู
                  <span className="text-xs text-muted-foreground ml-1">(chatBarText)</span>
                </label>
                <Input
                  value={chatBarText}
                  onChange={(e) => setChatBarText(e.target.value)}
                  placeholder="เมนู"
                  maxLength={14}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-foreground mb-1">LIFF URL</label>
                <Input
                  type="url"
                  value={liffUrl}
                  onChange={(e) => setLiffUrl(e.target.value)}
                  placeholder={defaultLiffUrl || 'https://liff.line.me/xxxxxxx-xxxxxxxx'}
                  className="font-mono"
                />
                {defaultLiffUrl && !liffUrl && (
                  <p className="text-xs text-muted-foreground mt-1">
                    ใช้จากการตั้งค่า: {defaultLiffUrl}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Section 3: Custom Image */}
          <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border bg-muted/30">
              <h2 className="text-base font-semibold text-foreground">รูปภาพเมนู (ไม่บังคับ)</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                อัปโหลดภาพแทนสีพื้นหลังปุ่ม — ขนาด <strong>2500×1686 px</strong> (PNG หรือ JPEG)
              </p>
            </div>
            <div className="p-5">
              {customImagePreview ? (
                <div className="flex items-start gap-4">
                  <img
                    src={customImagePreview}
                    alt="ตัวอย่างรูปเมนู"
                    className="w-48 rounded-lg border border-border object-cover"
                  />
                  <div className="space-y-2">
                    <p className="text-sm text-foreground font-medium">{customImageFile?.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {customImageFile ? (customImageFile.size / 1024 / 1024).toFixed(2) : '0'} MB
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCustomImageChange(null)}
                    >
                      ลบรูป
                    </Button>
                  </div>
                </div>
              ) : (
                <label
                  className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-border rounded-xl p-8 cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files[0];
                    if (file) handleCustomImageChange(file);
                  }}
                >
                  <ImageIcon size={32} className="text-muted-foreground" />
                  <div className="text-center">
                    <p className="text-sm font-medium text-foreground">ลากรูปมาวางหรือคลิกเพื่อเลือก</p>
                    <p className="text-xs text-muted-foreground mt-0.5">PNG, JPEG ขนาดสูงสุด 10 MB</p>
                  </div>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/png,image/jpeg"
                    className="hidden"
                    onChange={(e) => handleCustomImageChange(e.target.files?.[0] ?? null)}
                  />
                </label>
              )}
            </div>
          </div>

          {/* Section 4: Actions */}
          <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border bg-muted/30">
              <h2 className="text-base font-semibold text-foreground">สร้างเมนู</h2>
            </div>
            <div className="p-5 flex flex-col sm:flex-row gap-3">
              <Button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending || !effectiveLiffUrl}
                className="bg-gradient-to-r from-[#06C755] to-[#04a844] hover:from-[#04a844] hover:to-[#038537] text-white border-0 shadow-sm"
              >
                {editingMenuId ? (
                  <Pencil size={16} className="mr-1.5" />
                ) : (
                  <Plus size={16} className="mr-1.5" />
                )}
                {createMutation.isPending
                  ? editingMenuId
                    ? 'กำลังบันทึก...'
                    : 'กำลังสร้าง...'
                  : editingMenuId
                    ? 'บันทึกการแก้ไข'
                    : 'สร้าง Rich Menu'}
              </Button>
              {!effectiveLiffUrl && (
                <p className="text-xs text-destructive self-center">
                  กรุณาระบุ LIFF URL ก่อนสร้าง
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: รายการเมนู ────────────────────────────────────────────────── */}
      {activeTab === 'list' && (
        <QueryBoundary
          isLoading={isLoading}
          isError={isError}
          error={error}
          onRetry={refetch}
          errorTitle="ไม่สามารถโหลดรายการ Rich Menu ได้"
        >
        <div className="space-y-4">
          {isLoading ? (
            <div className="rounded-xl border border-border/50 bg-card shadow-sm p-10 text-center">
              <div className="text-sm text-muted-foreground">กำลังโหลด...</div>
            </div>
          ) : !data?.richmenus?.length ? (
            <div className="rounded-xl border border-border/50 bg-card shadow-sm p-12 text-center">
              <LayoutGrid size={40} className="mx-auto mb-3 text-muted-foreground/40" />
              <p className="text-sm font-medium text-muted-foreground">ยังไม่มี Rich Menu</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                ไปที่แท็บ "สร้างเมนู" เพื่อเริ่มต้น
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => setActiveTab('create')}
              >
                <Plus size={14} className="mr-1.5" />
                สร้างเมนูใหม่
              </Button>
            </div>
          ) : (
            data.richmenus.map((menu) => {
              const channelAliases = aliases
                ? {
                    default: channel === 'shop' ? aliases.shopDefault : aliases.financeDefault,
                    verified: channel === 'shop' ? aliases.shopVerified : aliases.financeVerified,
                  }
                : { default: null, verified: null };
              const isDefault = menu.richMenuId === channelAliases.default;
              const isVerified = menu.richMenuId === channelAliases.verified;
              return (
                <div
                  key={menu.richMenuId}
                  className={`rounded-xl border shadow-sm hover:shadow-md transition-shadow bg-card overflow-hidden ${
                    isDefault || isVerified ? 'border-success/30' : 'border-border/50'
                  }`}
                >
                  <div className={`px-5 py-3 ${isDefault || isVerified ? 'bg-success/10' : 'bg-muted/20'}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {(isDefault || isVerified) && (
                          <Star size={16} className="text-success shrink-0" fill="currentColor" />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{menu.name}</p>
                          <p className="text-xs text-muted-foreground font-mono truncate">
                            {menu.richMenuId}
                          </p>
                        </div>
                        {isDefault && (
                          <Badge className="bg-success/10 text-success hover:bg-success/10 border-success/30 shrink-0">
                            ⭐ Default
                          </Badge>
                        )}
                        {isVerified && (
                          <Badge className="bg-primary/10 text-primary hover:bg-primary/10 border-primary/30 shrink-0">
                            ✓ Verified
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="outline">
                              <Star size={13} className="mr-1" />
                              ตั้งเป็น...
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() =>
                                setAliasMutation.mutate({ menuId: menu.richMenuId, variant: 'default' })
                              }
                            >
                              ⭐ Default (ลูกค้าใหม่)
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                setAliasMutation.mutate({ menuId: menu.richMenuId, variant: 'verified' })
                              }
                            >
                              ✓ Verified (ลูกค้าที่ verify แล้ว)
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleEditMenu(menu)}
                        >
                          <Pencil size={13} className="mr-1" />
                          แก้ไข
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDuplicateMenu(menu)}
                        >
                          <Copy size={13} className="mr-1" />
                          คัดลอก
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive hover:text-destructive hover:border-destructive/50"
                          onClick={() => setDeleteTarget(menu.richMenuId)}
                        >
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Upload image row */}
                  <div className="px-5 py-3 border-t border-border/50 flex items-center gap-3">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
                      <Upload size={13} />
                      อัปโหลดรูปพื้นหลัง
                      <input
                        type="file"
                        accept="image/png,image/jpeg"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            uploadImageMutation.mutate({ menuId: menu.richMenuId, file });
                          }
                        }}
                      />
                    </label>
                    <span className="text-xs text-muted-foreground/60">2500×1686 px</span>
                  </div>
                </div>
              );
            })
          )}

          {/* Add new button */}
          {(data?.richmenus?.length ?? 0) > 0 && (
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setActiveTab('create')}
              >
                <Plus size={14} className="mr-1.5" />
                สร้างเมนูใหม่
              </Button>
            </div>
          )}
        </div>
        </QueryBoundary>
      )}

      {/* Confirm Delete Dialog */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="ลบ Rich Menu"
        description="ยืนยันการลบ Rich Menu นี้? ลูกค้าจะไม่เห็นเมนูนี้อีก"
        confirmLabel="ลบ"
        variant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) {
            deleteMutation.mutate(deleteTarget);
            setDeleteTarget(null);
          }
        }}
      />
    </div>
  );
}
