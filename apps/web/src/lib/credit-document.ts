import api, { getErrorMessage } from '@/lib/api';
import { toast } from 'sonner';

export const isRoomCreditDocument = (url: string) =>
  /^\/staff-chat\/rooms\/[^/]+\/credit-check\/files\/[^/?#]+$/.test(url);

/** Open protected media with the in-memory bearer token, not a public/signed URL. */
export async function openCreditDocument(url: string): Promise<void> {
  if (!isRoomCreditDocument(url)) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  const tab = window.open('', '_blank');
  if (!tab) {
    toast.error('กรุณาอนุญาตให้เปิดแท็บใหม่เพื่อดูเอกสาร');
    return;
  }
  tab.opener = null;
  tab.document.title = 'กำลังเปิดเอกสาร';
  tab.document.body.textContent = 'กำลังโหลดเอกสาร…';
  try {
    const { data } = await api.get<Blob>(url, { responseType: 'blob', timeout: 120000 });
    const objectUrl = URL.createObjectURL(data);
    tab.location.href = objectUrl;
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  } catch (error) {
    tab.close();
    toast.error(getErrorMessage(error));
  }
}
