import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

export type LegalDocKind = 'complaint' | 'summons' | 'judgment' | 'settlement' | 'other';

export interface LegalCaseDocument {
  id: string;
  kind: LegalDocKind;
  filename: string;
  s3Url: string;
  uploadedAt: string;
  uploadedByUserId: string;
}

export interface LegalCase {
  id: string;
  contractId: string;
  caseNumber: string;
  court: string;
  hearingDate: string | null;
  lawyerName: string | null;
  lawyerPhone: string | null;
  notes: string | null;
  documents: LegalCaseDocument[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateLegalCasePayload {
  caseNumber: string;
  court: string;
  hearingDate?: string;
  lawyerName?: string;
  lawyerPhone?: string;
  notes?: string;
}

export type UpdateLegalCasePayload = Partial<CreateLegalCasePayload>;

export function useLegalCase(contractId: string | null) {
  return useQuery({
    queryKey: ['legal-case', contractId],
    queryFn: async () => {
      const res = await api.get(`/legal-cases/${contractId}`);
      return res.data as LegalCase | null;
    },
    enabled: !!contractId,
    staleTime: 30_000,
  });
}

export function useCreateLegalCase(contractId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateLegalCasePayload) => {
      const res = await api.post(`/legal-cases/${contractId}`, payload);
      return res.data as LegalCase;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['legal-case', contractId] });
    },
  });
}

export function useUpdateLegalCase(contractId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: UpdateLegalCasePayload) => {
      const res = await api.patch(`/legal-cases/${contractId}`, payload);
      return res.data as LegalCase;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['legal-case', contractId] });
    },
  });
}

interface PresignResp {
  uploadUrl: string;
  method: 'PUT';
  key: string;
  publicUrl: string;
  maxContentLength?: number;
}

/** 10MB — must match LEGAL_DOC_MAX_BYTES in the API DTO. */
export const LEGAL_DOC_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Two-step doc upload: presign → PUT file to signed URL → register.
 * Returns the registered LegalCaseDocument.
 */
export function useUploadLegalDocument(contractId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { file: File; kind: LegalDocKind }) => {
      if (args.file.size > LEGAL_DOC_MAX_BYTES) {
        throw new Error('ไฟล์ใหญ่เกิน 10MB');
      }
      const presign = await api.post(`/legal-cases/${contractId}/documents/presign`, {
        contentType: args.file.type,
        kind: args.kind,
        filename: args.file.name,
        contentLength: args.file.size,
      });
      const { uploadUrl, method, key, maxContentLength } =
        presign.data as PresignResp;
      const putHeaders: Record<string, string> = {
        'Content-Type': args.file.type,
      };
      // GCS V4 presigned URLs sign the x-goog-content-length-range header;
      // the PUT must echo it byte-for-byte or GCS rejects with 403.
      if (typeof maxContentLength === 'number' && uploadUrl.includes('storage.googleapis.com')) {
        putHeaders['x-goog-content-length-range'] = `0,${maxContentLength}`;
      }
      const putRes = await fetch(uploadUrl, {
        method,
        body: args.file,
        headers: putHeaders,
      });
      if (!putRes.ok) {
        throw new Error('อัปโหลดไฟล์ไม่สำเร็จ');
      }
      const reg = await api.post(`/legal-cases/${contractId}/documents`, {
        kind: args.kind,
        filename: args.file.name,
        s3Key: key,
      });
      return reg.data as LegalCaseDocument;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['legal-case', contractId] });
    },
  });
}
