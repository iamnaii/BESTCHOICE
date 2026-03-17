import { useRef, useState, useCallback, useEffect } from 'react';

interface IdCardCaptureProps {
  onCapture: (imageBase64: string) => void;
  disabled?: boolean;
}

export default function IdCardCapture({ onCapture, disabled }: IdCardCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [mode, setMode] = useState<'idle' | 'camera' | 'preview'>('idle');
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  const startCamera = async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setMode('camera');
    } catch {
      setCameraError('ไม่สามารถเปิดกล้องได้ กรุณาใช้ปุ่มอัปโหลดรูปแทน');
    }
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    setPreviewSrc(dataUrl);
    stopCamera();
    setMode('preview');
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setCameraError('ไฟล์ต้องมีขนาดไม่เกิน 5MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setPreviewSrc(result);
      setMode('preview');
    };
    reader.readAsDataURL(file);
  };

  const confirmCapture = () => {
    if (previewSrc) onCapture(previewSrc);
  };

  const retake = () => {
    setPreviewSrc(null);
    setMode('idle');
  };

  if (mode === 'preview' && previewSrc) {
    return (
      <div className="space-y-4">
        <div className="relative rounded-xl overflow-hidden border-2 border-green-300">
          <img src={previewSrc} alt="บัตรประชาชน" className="w-full" />
        </div>
        <div className="flex gap-3">
          <button
            onClick={retake}
            disabled={disabled}
            className="flex-1 px-4 py-3.5 text-sm border border-input rounded-xl hover:bg-muted"
          >
            ถ่ายใหม่
          </button>
          <button
            onClick={confirmCapture}
            disabled={disabled}
            className="flex-1 px-4 py-3.5 text-sm bg-green-600 text-white rounded-xl hover:bg-green-700 font-medium disabled:opacity-50"
          >
            ยืนยันรูปบัตร
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'camera') {
    return (
      <div className="space-y-4">
        <div className="relative rounded-xl overflow-hidden border-2 border-primary bg-black">
          <video ref={videoRef} autoPlay playsInline muted className="w-full" />
          {/* ID card guide overlay */}
          <div className="absolute inset-4 border-2 border-white/50 rounded-lg pointer-events-none" />
          <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-black/60 text-white text-xs px-3 py-1 rounded-full">
            วางบัตรประชาชนในกรอบ
          </div>
        </div>
        <canvas ref={canvasRef} className="hidden" />
        <div className="flex gap-3">
          <button
            onClick={() => { stopCamera(); setMode('idle'); }}
            className="flex-1 px-4 py-3.5 text-sm border border-input rounded-xl hover:bg-muted"
          >
            ยกเลิก
          </button>
          <button
            onClick={capturePhoto}
            className="flex-1 px-4 py-3.5 text-sm bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 font-medium"
          >
            ถ่ายรูป
          </button>
        </div>
      </div>
    );
  }

  // Idle mode
  return (
    <div className="space-y-3">
      {cameraError && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
          {cameraError}
        </div>
      )}
      <div className="flex gap-3">
        <button
          onClick={startCamera}
          disabled={disabled}
          className="flex-1 px-4 py-4 text-sm border-2 border-dashed border-primary/40 rounded-xl hover:bg-primary/5 flex flex-col items-center gap-2 disabled:opacity-50"
        >
          <span className="text-2xl">📷</span>
          <span className="font-medium">เปิดกล้องถ่ายรูป</span>
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="flex-1 px-4 py-4 text-sm border-2 border-dashed border-input rounded-xl hover:bg-muted flex flex-col items-center gap-2 disabled:opacity-50"
        >
          <span className="text-2xl">📁</span>
          <span className="font-medium">อัปโหลดรูป</span>
        </button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png"
        capture="environment"
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  );
}
