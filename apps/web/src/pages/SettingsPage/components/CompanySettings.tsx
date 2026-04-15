import { useState, useCallback, useEffect, useRef } from 'react';
import { configGroups, SettingsCard, StatCard, EditField, type ConfigGroup } from './shared';

// ── SignatureEditor: canvas drawing for company card edit mode ──

function SignatureEditor({
  savedImage,
  savedName,
  signerName,
  onSignerNameChange,
  onSignatureDraw,
  onRemove,
}: {
  savedImage: string;
  savedName: string;
  signerName: string;
  onSignerNameChange: (name: string) => void;
  onSignatureDraw: (dataUrl: string) => void;
  onRemove: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [showCanvas, setShowCanvas] = useState(false);

  const setupCtx = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1a1a1a';
  }, []);

  useEffect(() => {
    if (showCanvas) setTimeout(setupCtx, 50);
  }, [showCanvas, setupCtx]);

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ('touches' in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return { x: e.nativeEvent.offsetX * scaleX, y: e.nativeEvent.offsetY * scaleY };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    setIsDrawing(true);
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    setHasDrawn(true);
  };

  const endDraw = () => setIsDrawing(false);

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const handleConfirmDraw = () => {
    if (!hasDrawn) return;
    const dataUrl = canvasRef.current!.toDataURL('image/png');
    onSignatureDraw(dataUrl);
    setShowCanvas(false);
    setHasDrawn(false);
  };

  return (
    <div className="border-t border-border/60 pt-4 mt-2">
      <div className="text-sm font-medium text-foreground mb-1">ลายเซ็นผู้ให้เช่าซื้อ</div>
      <div className="text-xs text-muted-foreground/70 mb-3">
        ลายเซ็นนี้จะถูกใช้อัตโนมัติในทุกสัญญา ไม่ต้องเซ็นใหม่ทุกครั้ง
      </div>

      <div className="flex items-center gap-4 mb-3">
        <label className="flex-1 text-sm text-foreground">ชื่อผู้ให้เช่าซื้อ</label>
        <div className="w-48">
          <input
            type="text"
            value={signerName}
            onChange={(e) => onSignerNameChange(e.target.value)}
            placeholder="เช่น เอกนรินทร์ คงเดช"
            className="w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
          />
        </div>
      </div>

      {savedImage && !showCanvas ? (
        <div className="space-y-2">
          <div className="inline-flex items-center gap-3 border border-border rounded-lg p-3 bg-muted">
            <img src={savedImage} alt="ลายเซ็น" style={{ maxHeight: '60px' }} />
            <span className="text-xs text-muted-foreground">({savedName})</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowCanvas(true)}
              type="button"
              className="text-xs text-primary hover:underline"
            >
              เปลี่ยนลายเซ็น
            </button>
            <button
              onClick={onRemove}
              type="button"
              className="text-xs text-red-600 hover:underline"
            >
              ลบลายเซ็น
            </button>
          </div>
        </div>
      ) : !showCanvas ? (
        <button
          onClick={() => setShowCanvas(true)}
          type="button"
          className="text-xs text-primary hover:underline"
        >
          วาดลายเซ็น
        </button>
      ) : (
        <div className="space-y-2">
          <div
            className="border-2 border-dashed border-input rounded-lg bg-card inline-block"
            style={{ touchAction: 'none' }}
          >
            <canvas
              ref={canvasRef}
              width={500}
              height={200}
              style={{
                width: '100%',
                maxWidth: '500px',
                height: 'auto',
                aspectRatio: '5/2',
                cursor: 'crosshair',
              }}
              onMouseDown={startDraw}
              onMouseMove={draw}
              onMouseUp={endDraw}
              onMouseLeave={endDraw}
              onTouchStart={startDraw}
              onTouchMove={draw}
              onTouchEnd={endDraw}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleConfirmDraw}
              disabled={!hasDrawn}
              type="button"
              className="text-xs text-primary hover:underline disabled:opacity-50"
            >
              ยืนยันลายเซ็น
            </button>
            <button
              onClick={clearCanvas}
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              ล้าง
            </button>
            <button
              onClick={() => {
                setShowCanvas(false);
                setHasDrawn(false);
              }}
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              ยกเลิก
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── CompanySettings: company/business info + signature ──

interface CompanySettingsProps {
  values: Record<string, string>;
  editingSection: string | null;
  onEdit: (sectionKey: string) => void;
  onSave: (items: { key: string; value: string }[]) => void;
  onCancel: () => void;
  isSaving: boolean;
  draftSignatureImage: string;
  draftSignerName: string;
  setDraftSignatureImage: (val: string) => void;
  setDraftSignerName: (val: string) => void;
}

export default function CompanySettings({
  values,
  editingSection,
  onEdit,
  onSave,
  onCancel,
  isSaving,
  draftSignatureImage,
  draftSignerName,
  setDraftSignatureImage,
  setDraftSignerName,
}: CompanySettingsProps) {
  const companyGroup = configGroups.find((g) => g.key === 'company') as ConfigGroup;
  const companyTextItems = companyGroup.items.filter((i) => i.type === 'text');
  const companyNumberItems = companyGroup.items.filter((i) => i.type === 'number');

  const renderView = (vals: Record<string, string>) => (
    <>
      {/* Company info as key-value list */}
      <div className="space-y-2 mb-4">
        {companyTextItems.map((item) => (
          <div key={item.key} className="flex items-baseline gap-2">
            <span className="text-xs text-muted-foreground w-36 shrink-0">{item.shortLabel}</span>
            <span className="text-sm text-foreground">
              {vals[item.key] || <span className="text-muted-foreground">-</span>}
            </span>
          </div>
        ))}
      </div>

      {/* Contract number values as stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {companyNumberItems.map((item) => (
          <StatCard
            key={item.key}
            label={item.shortLabel}
            value={vals[item.key] || ''}
            suffix={item.suffix}
            desc={item.desc}
          />
        ))}
      </div>

      {/* Signature preview */}
      <div className="border-t border-border/60 pt-3">
        <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          ลายเซ็นผู้ให้เช่าซื้อ
        </div>
        {vals['lessor_signature_image'] ? (
          <div className="inline-flex items-center gap-3">
            <img src={vals['lessor_signature_image']} alt="ลายเซ็น" style={{ maxHeight: '50px' }} />
            <span className="text-sm text-foreground">({vals['lessor_signer_name']})</span>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">ยังไม่ได้ตั้งค่า — กดแก้ไขเพื่อวาดลายเซ็น</span>
        )}
      </div>
    </>
  );

  const renderEdit = (
    draft: Record<string, string>,
    setDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>,
  ) => (
    <>
      {/* Company text fields */}
      <div className="text-sm font-medium text-foreground mb-2">ข้อมูลบริษัท</div>
      {companyTextItems.map((item) => (
        <EditField
          key={item.key}
          item={item}
          value={draft[item.key] ?? ''}
          onChange={(val) => setDraft((prev) => ({ ...prev, [item.key]: val }))}
        />
      ))}

      {/* Contract number fields */}
      <div className="text-sm font-medium text-foreground mt-4 mb-2">ค่าคงที่สัญญา</div>
      {companyNumberItems.map((item) => (
        <EditField
          key={item.key}
          item={item}
          value={draft[item.key] ?? ''}
          onChange={(val) => setDraft((prev) => ({ ...prev, [item.key]: val }))}
        />
      ))}

      {/* Signature editor */}
      <SignatureEditor
        savedImage={draftSignatureImage}
        savedName={draftSignerName}
        signerName={draftSignerName}
        onSignerNameChange={setDraftSignerName}
        onSignatureDraw={setDraftSignatureImage}
        onRemove={() => {
          setDraftSignatureImage('');
          setDraftSignerName('');
        }}
      />
    </>
  );

  return (
    <SettingsCard
      group={companyGroup}
      values={values}
      isEditing={editingSection === 'company'}
      onEdit={() => onEdit('company')}
      onSave={onSave}
      onCancel={onCancel}
      isSaving={isSaving}
      renderView={(vals) => renderView(vals)}
      renderEdit={(draft, setDraft) => renderEdit(draft, setDraft)}
    />
  );
}
