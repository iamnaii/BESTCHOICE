import type { MouseEvent } from 'react';
import { toast } from 'sonner';
import { getErrorMessage, liffApi } from './api';

/** เอกสารที่หน้า LIFF การเงินเปิดเป็นแท็บใหม่ — ต้องตรงกับ `LIFF_DOWNLOAD_KINDS` ฝั่ง API */
export type LiffDownloadKind = 'contract-document' | 'receipt';

const PATHS: Record<LiffDownloadKind, (id: string) => string> = {
  'contract-document': (id) => `/api/line-oa/liff/contracts/${encodeURIComponent(id)}/document`,
  receipt: (id) => `/api/line-oa/liff/receipts/${encodeURIComponent(id)}/download`,
};

/** href ของลิงก์ดาวน์โหลด — ไม่มีข้อมูลยืนยันตัวตน (เปิดตรง ๆ ได้ 401) · ตัวเปิดจริงคือ `openLiffDownload` */
export function liffDownloadPath(kind: LiffDownloadKind, id: string): string {
  return PATHS[kind](id);
}

/**
 * Task 22 M-3 — เปิดเอกสารโดยไม่ใส่ id_token ใน URL (เดิม `?idToken=` ⇒ token ไปอยู่ใน access log ของ Cloud Run/Firebase):
 * แลก id_token (header `X-Liff-Id-Token` ของ `liffApi`) เป็นตั๋วครั้งเดียวอายุ 60 วิ แล้วเปิด `…?dl=<ตั๋ว>`.
 * เปิดแท็บเปล่าทันทีในจังหวะคลิก (ตัวบล็อกป๊อปอัปยอมเฉพาะในจังหวะนั้น) แล้วค่อยใส่ URL เมื่อได้ตั๋ว · เปิดแท็บไม่ได้ = เปิดในหน้าเดิม ·
 * ขอตั๋วไม่สำเร็จ = ปิดแท็บเปล่าแล้วโยน error ให้ผู้เรียกแสดง
 */
export async function openLiffDownload(
  kind: LiffDownloadKind,
  id: string,
  win: Window = window,
): Promise<void> {
  const tab = win.open('', '_blank');
  if (tab) tab.opener = null;
  try {
    const { data } = await liffApi.post<{ ticket: string }>('/line-oa/liff/download-ticket', {
      kind,
      resourceId: id,
    });
    const url = `${liffDownloadPath(kind, id)}?dl=${encodeURIComponent(data.ticket)}`;
    if (tab && !tab.closed) tab.location.href = url;
    else win.location.assign(url);
  } catch (error) {
    tab?.close();
    throw error;
  }
}

/** onClick ของ `<a href={liffDownloadPath(...)}>` — กันการเปิดลิงก์เปล่า แล้วเปิดผ่านตั๋ว · ล้ม = toast ข้อความจาก API */
export function onLiffDownloadClick(kind: LiffDownloadKind, id: string) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    openLiffDownload(kind, id).catch((error: unknown) => toast.error(getErrorMessage(error)));
  };
}
