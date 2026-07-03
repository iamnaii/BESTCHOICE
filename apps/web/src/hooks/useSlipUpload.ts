import { useMutation } from '@tanstack/react-query';
import api from '@/lib/api';

export const MAX_SLIP_BYTES = 10 * 1024 * 1024; // 10 MB
export const SLIP_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

/**
 * Bank-slip upload via presigned S3 URL (kind BANK_SLIP) — resolves to the
 * public URL to send as `slipUrl` on payment endpoints.
 */
export function useSlipUpload() {
  return useMutation({
    mutationFn: async (file: File) => {
      if (file.size > MAX_SLIP_BYTES) throw new Error('ไฟล์ใหญ่เกิน 10MB');
      if (!SLIP_MIME_TYPES.includes(file.type)) {
        throw new Error('รองรับ JPG, PNG, WebP, PDF เท่านั้น');
      }
      const { data: presign } = await api.post<{
        uploadUrl: string;
        method: string;
        key: string;
        publicUrl: string;
      }>('/shop/upload/signed-url', {
        kind: 'BANK_SLIP',
        contentType: file.type,
      });

      const putRes = await fetch(presign.uploadUrl, {
        method: presign.method,
        body: file,
        headers: { 'Content-Type': file.type },
      });
      if (!putRes.ok) throw new Error('อัปโหลดสลิปไม่สำเร็จ');

      return presign.publicUrl;
    },
  });
}
