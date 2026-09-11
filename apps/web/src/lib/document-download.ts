import api from './api';
import { getCompanyScopeRevision } from './company-scope';

/** Download protected documents with the same bearer token and scope as the page. */
export async function downloadGeneratedDocument(documentId: string, filename: string) {
  return downloadProtectedDocument(`/documents/${documentId}/download`, filename);
}

export async function getProtectedDocument(url: string) {
  const revision = getCompanyScopeRevision();
  const { data } = await api.get<Blob>(url, { responseType: 'blob', timeout: 120000 });
  if (getCompanyScopeRevision() !== revision) throw new Error('เปลี่ยนบริษัทระหว่างดาวน์โหลด กรุณาเปิดเอกสารใหม่จากบริษัทที่ต้องการ');
  return data;
}

export async function downloadProtectedDocument(path: string, filename: string) {
  const data = await getProtectedDocument(path);
  const url = URL.createObjectURL(data);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}
