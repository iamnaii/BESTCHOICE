import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';

export type UploadKind = 'TRADE_IN_PHOTO' | 'BUYBACK_PHOTO' | 'BANK_SLIP' | 'REVIEW_PHOTO';

interface PresignResponse {
  uploadUrl: string;
  method: 'PUT';
  key: string;
  publicUrl: string;
}

export function useSignedUpload(kind: UploadKind) {
  return useMutation({
    mutationFn: async (file: File): Promise<{ key: string; publicUrl: string }> => {
      const presign = await api
        .post<PresignResponse>('/api/shop/upload/signed-url', { kind, contentType: file.type })
        .then((r) => r.data);

      const put = await fetch(presign.uploadUrl, {
        method: presign.method,
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!put.ok) throw new Error('อัปโหลดไฟล์ไม่สำเร็จ');
      return { key: presign.key, publicUrl: presign.publicUrl };
    },
  });
}
