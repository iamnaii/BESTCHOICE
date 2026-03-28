import React, { useState, useRef, useEffect, useCallback } from 'react';
import api, { getErrorMessage } from '@/lib/api';
import { compressImageForOcr } from '@/lib/compressImage';
import { toast } from 'sonner';
import type { PendingDoc, OcrResult } from '../types';

interface UseDocumentUploadParams {
  ocrLoading: boolean;
  setOcrLoading: (v: boolean) => void;
  setOcrResult: (v: OcrResult | null) => void;
  setShowOcrPanel: (v: boolean) => void;
  setShowCreateCustomer: (v: boolean) => void;
}

export function useDocumentUpload({
  ocrLoading,
  setOcrLoading,
  setOcrResult,
  setShowOcrPanel,
  setShowCreateCustomer,
}: UseDocumentUploadParams) {
  const [pendingDocs, setPendingDocs] = useState<PendingDoc[]>([]);
  const [dragOverType, setDragOverType] = useState<string | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Cleanup object URLs on unmount to prevent memory leaks
  const pendingDocsRef = useRef(pendingDocs);
  pendingDocsRef.current = pendingDocs;
  useEffect(() => {
    return () => {
      pendingDocsRef.current.forEach((doc) => URL.revokeObjectURL(doc.preview));
    };
  }, []);

  const addDocFileForType = useCallback((file: File, docType: string) => {
    if (file.size > 10 * 1024 * 1024) {
      toast.error('ไฟล์ต้องมีขนาดไม่เกิน 10MB');
      return;
    }
    const validTypes = ['image/', 'application/pdf'];
    if (!validTypes.some((t) => file.type.startsWith(t))) {
      toast.error('รองรับเฉพาะไฟล์รูปภาพหรือ PDF เท่านั้น');
      return;
    }
    const preview = URL.createObjectURL(file);
    setPendingDocs((prev) => [...prev, { id: crypto.randomUUID(), type: docType, file, preview }]);

    // Trigger OCR when uploading ID card image
    if (docType === 'ID_CARD_COPY' && file.type.startsWith('image/') && !ocrLoading) {
      (async () => {
        setOcrLoading(true);
        try {
          const imageBase64 = await compressImageForOcr(file);
          const { data } = await api.post('/ocr/id-card', { imageBase64 }, { timeout: 90000 });
          setOcrResult(data);
          setShowOcrPanel(true);
          setShowCreateCustomer(false);
          const pct = (data.confidence * 100).toFixed(0);
          if (data.confidence < 0.5) {
            toast.error(`อ่านบัตรได้ แต่ความมั่นใจต่ำมาก (${pct}%) กรุณาตรวจสอบข้อมูล`);
          } else if (data.confidence < 0.7) {
            toast.warning(`อ่านบัตรสำเร็จ แต่ความมั่นใจค่อนข้างต่ำ (${pct}%)`);
          } else {
            toast.success(`อ่านบัตรประชาชนสำเร็จ (ความมั่นใจ ${pct}%)`);
          }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (err: any) {
          if (err.code === 'ECONNABORTED' || !err.response) {
            toast.error('OCR ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง');
          } else {
            toast.error(getErrorMessage(err));
          }
        } finally {
          setOcrLoading(false);
        }
      })();
    }
  }, [ocrLoading]);

  const handleDropForType = useCallback((e: React.DragEvent, docType: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverType(null);
    const file = e.dataTransfer.files?.[0];
    if (file) addDocFileForType(file, docType);
  }, [addDocFileForType]);

  const handleFileInputForType = useCallback((e: React.ChangeEvent<HTMLInputElement>, docType: string) => {
    const file = e.target.files?.[0];
    if (!file) return;
    addDocFileForType(file, docType);
    e.target.value = '';
  }, [addDocFileForType]);

  const handleRemoveDoc = (id: string) => {
    setPendingDocs((prev) => {
      const doc = prev.find((d) => d.id === id);
      if (doc) URL.revokeObjectURL(doc.preview);
      return prev.filter((d) => d.id !== id);
    });
  };

  return {
    pendingDocs,
    setPendingDocs,
    dragOverType,
    setDragOverType,
    fileInputRefs,
    addDocFileForType,
    handleDropForType,
    handleFileInputForType,
    handleRemoveDoc,
  };
}
