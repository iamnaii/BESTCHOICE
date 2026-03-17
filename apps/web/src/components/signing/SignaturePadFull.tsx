import { useRef, useState, useEffect, useCallback } from 'react';

interface SignaturePadFullProps {
  onSign: (signatureImage: string) => void;
  isPending?: boolean;
  label?: string;
  signerName?: string;
  buttonText?: string;
}

/** Get position relative to canvas, accounting for DPI scaling */
function getCanvasPos(
  e: React.MouseEvent | React.TouchEvent,
  canvas: HTMLCanvasElement,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  if ('touches' in e) {
    return {
      x: (e.touches[0].clientX - rect.left) * scaleX,
      y: (e.touches[0].clientY - rect.top) * scaleY,
    };
  }
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

export default function SignaturePadFull({ onSign, isPending, label, signerName, buttonText }: SignaturePadFullProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  const setupCtx = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#000';
  }, []);

  useEffect(() => { setupCtx(); }, [setupCtx]);

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    setIsDrawing(true);
    setHasDrawn(true);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pos = getCanvasPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pos = getCanvasPos(e, canvas);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  };

  const endDraw = () => setIsDrawing(false);

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const handleSign = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn) return;
    onSign(canvas.toDataURL('image/png'));
  };

  return (
    <div className="flex flex-col items-center w-full max-w-2xl mx-auto">
      {label && (
        <h2 className="text-lg font-semibold text-foreground mb-1">{label}</h2>
      )}
      {signerName && (
        <p className="text-sm text-muted-foreground mb-4">{signerName}</p>
      )}

      <div className="text-xs text-muted-foreground mb-2">กรุณาลงนามในกรอบด้านล่าง</div>

      <canvas
        ref={canvasRef}
        width={800}
        height={320}
        className="w-full border-2 border-dashed border-input rounded-xl cursor-crosshair"
        style={{ height: 'auto', aspectRatio: '5 / 2', touchAction: 'none' }}
        onMouseDown={startDraw}
        onMouseMove={draw}
        onMouseUp={endDraw}
        onMouseLeave={endDraw}
        onTouchStart={startDraw}
        onTouchMove={draw}
        onTouchEnd={endDraw}
      />

      <div className="flex gap-3 mt-4 w-full">
        <button
          onClick={clear}
          className="px-6 py-3.5 text-sm border border-input rounded-xl hover:bg-muted"
        >
          ล้างลายเซ็น
        </button>
        <div className="flex-1" />
        <button
          onClick={handleSign}
          disabled={!hasDrawn || isPending}
          className="px-8 py-3.5 text-sm bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 disabled:opacity-50 font-medium"
        >
          {isPending ? 'กำลังบันทึก...' : buttonText || 'ยืนยันลงนาม'}
        </button>
      </div>
    </div>
  );
}
