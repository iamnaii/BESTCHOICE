import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api, { getErrorMessage } from '@/lib/api';

interface PhotoData {
  productId: string;
  photos: {
    front: string | null;
    back: string | null;
    left: string | null;
    right: string | null;
    top: string | null;
    bottom: string | null;
  };
  isCompleted: boolean;
  completedCount: number;
  totalCount: number;
}

const ANGLE_LABELS: Record<string, string> = {
  front: 'ด้านหน้า',
  back: 'ด้านหลัง',
  left: 'ข้างซ้าย',
  right: 'ข้างขวา',
  top: 'ด้านบน',
  bottom: 'ด้านล่าง',
};

const ANGLES = ['front', 'back', 'left', 'right', 'top', 'bottom'] as const;

function compressImage(file: File, maxWidth = 1200, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas not supported')); return; }
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      URL.revokeObjectURL(img.src);
      resolve(dataUrl);
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error('ไม่สามารถอ่านไฟล์รูปภาพได้'));
    };
    img.src = URL.createObjectURL(file);
  });
}

export default function ProductPhotosPanel({
  productId,
  canEdit = false,
}: {
  productId: string;
  canEdit?: boolean;
}) {
  const queryClient = useQueryClient();
  const [uploadingAngle, setUploadingAngle] = useState<string | null>(null);
  const [previewPhoto, setPreviewPhoto] = useState<{ angle: string; src: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingAngleRef = useRef<string | null>(null);

  const { data, isLoading } = useQuery<PhotoData>({
    queryKey: ['product-photos', productId],
    queryFn: async () => {
      const { data } = await api.get(`/products/${productId}/photos`);
      return data;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ angle, photo }: { angle: string; photo: string }) => {
      return api.post(`/products/${productId}/photos/upload`, { angle, photo });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-photos', productId] });
      queryClient.invalidateQueries({ queryKey: ['product', productId] });
      toast.success('อัปโหลดรูปสำเร็จ');
      setUploadingAngle(null);
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err));
      setUploadingAngle(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (angle: string) => {
      return api.delete(`/products/${productId}/photos/${angle}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-photos', productId] });
      queryClient.invalidateQueries({ queryKey: ['product', productId] });
      toast.success('ลบรูปสำเร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      return api.post(`/products/${productId}/photos/complete`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-photos', productId] });
      queryClient.invalidateQueries({ queryKey: ['product', productId] });
      toast.success('ยืนยันรูปถ่ายครบแล้ว สินค้าเข้าคลังเรียบร้อย');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const angle = pendingAngleRef.current;
    if (!file || !angle) return;

    if (file.size > 10 * 1024 * 1024) {
      toast.error('ไฟล์รูปภาพต้องไม่เกิน 10MB');
      return;
    }

    setUploadingAngle(angle);
    try {
      const compressed = await compressImage(file);
      uploadMutation.mutate({ angle, photo: compressed });
    } catch {
      toast.error('ไม่สามารถประมวลผลรูปภาพได้');
      setUploadingAngle(null);
    }

    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const triggerUpload = (angle: string) => {
    pendingAngleRef.current = angle;
    fileInputRef.current?.click();
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg border p-6 mb-6">
        <div className="animate-pulse space-y-3">
          <div className="h-5 w-40 bg-gray-200 rounded" />
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-32 bg-gray-100 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const photos = data?.photos || { front: null, back: null, left: null, right: null, top: null, bottom: null };
  const isCompleted = data?.isCompleted || false;
  const completedCount = data?.completedCount || 0;

  return (
    <div className="bg-white rounded-lg border p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            รูปถ่ายสินค้า 6 มุม
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {isCompleted ? (
              <span className="text-green-600 font-medium">ถ่ายรูปครบแล้ว</span>
            ) : (
              <span>{completedCount}/6 มุม</span>
            )}
          </p>
        </div>
        {canEdit && completedCount === 6 && !isCompleted && (
          <button
            onClick={() => completeMutation.mutate()}
            disabled={completeMutation.isPending}
            className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
          >
            {completeMutation.isPending ? 'กำลังยืนยัน...' : 'ยืนยันรูปครบ'}
          </button>
        )}
      </div>

      {/* Progress bar */}
      <div className="w-full bg-gray-200 rounded-full h-2 mb-4">
        <div
          className={`h-2 rounded-full transition-all ${isCompleted ? 'bg-green-500' : 'bg-primary-500'}`}
          style={{ width: `${(completedCount / 6) * 100}%` }}
        />
      </div>

      {/* Photo grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {ANGLES.map((angle) => {
          const photo = photos[angle];
          const isUploading = uploadingAngle === angle;

          return (
            <div key={angle} className="relative">
              <div className="text-xs font-medium text-gray-600 mb-1 text-center">
                {ANGLE_LABELS[angle]}
              </div>
              {photo ? (
                <div className="relative group">
                  <div
                    className="w-full aspect-square rounded-lg overflow-hidden border-2 border-green-300 cursor-pointer"
                    onClick={() => setPreviewPhoto({ angle, src: photo })}
                  >
                    <img
                      src={photo}
                      alt={ANGLE_LABELS[angle]}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  {canEdit && !isCompleted && (
                    <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => triggerUpload(angle)}
                        className="p-1 bg-white/90 rounded text-xs text-blue-600 hover:bg-white shadow-sm"
                        title="เปลี่ยนรูป"
                      >
                        เปลี่ยน
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`ลบรูป${ANGLE_LABELS[angle]}?`)) deleteMutation.mutate(angle);
                        }}
                        className="p-1 bg-white/90 rounded text-xs text-red-600 hover:bg-white shadow-sm"
                        title="ลบรูป"
                      >
                        ลบ
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => canEdit && triggerUpload(angle)}
                  disabled={!canEdit || isUploading}
                  className={`w-full aspect-square rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 transition-colors ${
                    canEdit
                      ? 'border-gray-300 hover:border-primary-400 hover:bg-primary-50 cursor-pointer'
                      : 'border-gray-200 bg-gray-50 cursor-default'
                  }`}
                >
                  {isUploading ? (
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
                  ) : (
                    <>
                      <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <span className="text-xs text-gray-400">
                        {canEdit ? 'อัปโหลด' : 'ยังไม่มี'}
                      </span>
                    </>
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Full-screen preview modal */}
      {previewPhoto && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setPreviewPhoto(null)}
        >
          <div className="relative max-w-3xl w-full">
            <div className="text-white text-center mb-2 text-sm font-medium">
              {ANGLE_LABELS[previewPhoto.angle]}
            </div>
            <img
              src={previewPhoto.src}
              alt={ANGLE_LABELS[previewPhoto.angle]}
              className="w-full rounded-lg"
            />
            <button
              onClick={() => setPreviewPhoto(null)}
              className="absolute -top-8 right-0 text-white/70 hover:text-white text-sm"
            >
              ปิด
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
