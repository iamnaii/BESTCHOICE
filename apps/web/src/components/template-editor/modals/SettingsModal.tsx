import { X } from 'lucide-react';
import { useTemplateStore } from '@/store/templateStore';

export default function SettingsModal() {
  const { showSettings, setShowSettings, currentTemplate, updateSettings } = useTemplateStore();
  const settings = currentTemplate.settings;

  if (!showSettings) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-bold text-foreground">ตั้งค่าเทมเพลต</h2>
          <button onClick={() => setShowSettings(false)} className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Letterhead */}
          <div>
            <label className="block text-base font-medium text-foreground mb-2">แบบพิมพ์</label>
            <div className="flex gap-4">
              {[
                { value: 'none', label: 'ไม่มีหัวกระดาษ' },
                { value: 'bestchoice', label: 'BESTCHOICEPHONE' },
                { value: 'logo', label: 'โลโก้' },
              ].map(opt => (
                <label key={opt.value} className="flex items-center gap-2 text-base cursor-pointer">
                  <input
                    type="radio"
                    name="letterhead"
                    checked={settings.letterhead === opt.value}
                    onChange={() => updateSettings({ letterhead: opt.value as typeof settings.letterhead })}
                    className="text-primary-600 focus:ring-primary-500"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          {/* Page number */}
          <label className="flex items-center gap-2 text-base cursor-pointer">
            <input
              type="checkbox"
              checked={settings.showPageNumber}
              onChange={e => updateSettings({ showPageNumber: e.target.checked })}
              className="rounded text-primary-600 focus:ring-primary-500"
            />
            เพิ่มเลขหน้า (หน้า X/Y)
          </label>

          {/* Signature except last page */}
          <label className="flex items-center gap-2 text-base cursor-pointer">
            <input
              type="checkbox"
              checked={settings.showSignatureExceptLastPage}
              onChange={e => updateSettings({ showSignatureExceptLastPage: e.target.checked })}
              className="rounded text-primary-600 focus:ring-primary-500"
            />
            เพิ่มลายเซ็น ยกเว้นหน้าสุดท้าย
          </label>

          {/* Footer text */}
          <div>
            <label className="block text-base font-medium text-foreground mb-1.5">Footer</label>
            <input
              type="text"
              value={settings.footerText}
              onChange={e => updateSettings({ footerText: e.target.value })}
              className="w-full px-3 py-2.5 border border-input rounded-lg text-base focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {/* Footer content */}
          <div>
            <label className="block text-base font-medium text-foreground mb-1.5">เนื้อหาท้ายเอกสาร</label>
            <textarea
              value={settings.footerContent}
              onChange={e => updateSettings({ footerContent: e.target.value })}
              className="w-full px-3 py-2.5 border border-input rounded-lg text-base resize-y"
              rows={3}
              placeholder="ข้อความท้ายเอกสาร (รองรับ template variables)"
            />
          </div>

          {/* Margins */}
          <div>
            <label className="block text-base font-medium text-foreground mb-2">ระยะขอบ (mm)</label>
            <div className="grid grid-cols-4 gap-3">
              {(['top', 'bottom', 'left', 'right'] as const).map(side => (
                <div key={side}>
                  <label className="block text-sm text-muted-foreground mb-1 capitalize">{side === 'top' ? 'บน' : side === 'bottom' ? 'ล่าง' : side === 'left' ? 'ซ้าย' : 'ขวา'}</label>
                  <input
                    type="number"
                    value={settings.margins[side]}
                    onChange={e => updateSettings({ margins: { ...settings.margins, [side]: parseInt(e.target.value) || 0 } })}
                    className="w-full px-2 py-2 border border-input rounded text-base"
                    min={0}
                    max={50}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Font sizes */}
          <div>
            <label className="block text-base font-medium text-foreground mb-2">ขนาดตัวอักษร (px)</label>
            <div className="grid grid-cols-3 gap-3">
              {[
                { key: 'body' as const, label: 'เนื้อหา' },
                { key: 'heading' as const, label: 'หัวข้อ' },
                { key: 'footer' as const, label: 'Footer' },
              ].map(item => (
                <div key={item.key}>
                  <label className="block text-sm text-muted-foreground mb-1">{item.label}</label>
                  <input
                    type="number"
                    value={settings.fontSize[item.key]}
                    onChange={e => updateSettings({ fontSize: { ...settings.fontSize, [item.key]: parseInt(e.target.value) || 12 } })}
                    className="w-full px-2 py-2 border border-input rounded text-base"
                    min={8}
                    max={36}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end px-6 py-4 border-t border-border">
          <button
            onClick={() => setShowSettings(false)}
            className="px-5 py-2.5 text-base bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            ปิด
          </button>
        </div>
      </div>
    </div>
  );
}
