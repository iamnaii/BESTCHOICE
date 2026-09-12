import { useEffect, useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import api, { getErrorMessage } from '@/lib/api';
import { getCompanyScopeRevision } from '@/lib/company-scope';

class LetterPdfError extends Error {}

/** Own both the in-flight request and the preview URL for one selected batch. */
export function useLetterPdf(ids: readonly string[], enabled: boolean, storedUrls: Record<string, string> = {}) {
  const key = JSON.stringify(ids.map(id => [id, storedUrls[id] ?? null]));
  const [scope] = useState(getCompanyScopeRevision);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; scope: number; url: string | null; error: string | null }>({ key: '', scope, url: null, error: null });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let active = true;
    let ownedUrl: string | undefined;
    const current = () => active && scope === getCompanyScopeRevision();
    setState({ key, scope, url: null, error: null });
    void (async () => {
      try {
        const letterIds: Array<[string, string | null]> = JSON.parse(key);
        if (!letterIds.length) throw new LetterPdfError('กรุณาเลือกจดหมาย');
        const parts: ArrayBuffer[] = [];
        for (const [id, storedUrl] of letterIds) {
          if (!current()) return;
          let data: ArrayBuffer;
          if (storedUrl) {
            // Stored public upload URLs are already exposed as download links. Never
            // forward the staff API credentials or proxy arbitrary URLs through the server.
            try {
              const url = new URL(storedUrl);
              if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new LetterPdfError('เปิดไฟล์เดิมไม่ได้ กรุณาตรวจสอบลิงก์เอกสาร');
              const response = await fetch(url.href, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
              if (!response.ok) throw new LetterPdfError('โหลดไฟล์เดิมไม่สำเร็จ กรุณาลองใหม่หรือเปิดเอกสารรายฉบับ');
              data = await response.arrayBuffer();
            } catch (error) {
              if (error instanceof LetterPdfError) throw error;
              throw new LetterPdfError('โหลดไฟล์เดิมไม่สำเร็จ กรุณาลองใหม่หรือเปิดเอกสารรายฉบับ');
            }
          } else {
            ({ data } = await api.get<ArrayBuffer>(`/overdue/letters/${id}/pdf`, {
              responseType: 'arraybuffer', signal: controller.signal, timeout: 120000,
            }));
          }
          if (!current()) return;
          parts.push(data);
        }
        let blob: Blob;
        if (parts.length === 1) blob = new Blob(parts, { type: 'application/pdf' });
        else {
          const merged = await PDFDocument.create();
          for (const part of parts) {
            const document = await PDFDocument.load(part);
            const pages = await merged.copyPages(document, document.getPageIndices());
            pages.forEach(page => merged.addPage(page));
          }
          blob = new Blob([new Uint8Array(await merged.save())], { type: 'application/pdf' });
        }
        if (!current()) return;
        ownedUrl = URL.createObjectURL(blob);
        setState({ key, scope, url: ownedUrl, error: null });
      } catch (error) {
        if (current()) setState({ key, scope, url: null, error: error instanceof LetterPdfError ? error.message : getErrorMessage(error) });
      }
    })();
    return () => {
      active = false;
      controller.abort();
      if (ownedUrl) URL.revokeObjectURL(ownedUrl);
    };
  }, [key, enabled, attempt, scope]);
  const scopeChanged = scope !== getCompanyScopeRevision();
  const currentState = enabled && !scopeChanged && state.key === key && state.scope === scope;
  const url = currentState ? state.url : null;
  const error = enabled && scopeChanged ? 'เปลี่ยนบริษัทแล้ว กรุณาเปิดเอกสารใหม่' : currentState ? state.error : null;
  return { url, error, loading: enabled && !url && !error, retry: () => setAttempt(value => value + 1) };
}
