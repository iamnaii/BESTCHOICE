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
}

/**
 * Two-step doc upload: presign → PUT file to signed URL → register.
 * Returns the registered LegalCaseDocument.
 */
export function useUploadLegalDocument(contractId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { file: File; kind: LegalDocKind }) => {
      const presign = await api.post(`/legal-cases/${contractId}/documents/presign`, {
        contentType: args.file.type,
        kind: args.kind,
        filename: args.file.name,
      });
      const { uploadUrl, method, key } = presign.data as PresignResp;
      const putRes = await fetch(uploadUrl, {
        method,
        body: args.file,
        headers: { 'Content-Type': args.file.type },
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
