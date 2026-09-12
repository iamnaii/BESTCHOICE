import api, { getErrorMessage } from './api';
import { getCompanyScopeRevision } from './company-scope';

export class DocumentRequestError extends Error {}

export function getDocumentErrorMessage(error: unknown) {
  return error instanceof DocumentRequestError ? error.message : getErrorMessage(error);
}

type DocumentRequestOptions = { signal?: AbortSignal; method?: 'get' | 'post' };

/** Download protected documents with the same bearer token and scope as the page. */
export async function downloadGeneratedDocument(documentId: string, filename: string) {
  return downloadProtectedDocument(`/documents/${documentId}/download`, filename);
}

export async function getProtectedDocumentResponse(url: string, options: DocumentRequestOptions = {}) {
  const revision = getCompanyScopeRevision();
  try {
    const config = { responseType: 'blob' as const, timeout: 120000, ...(options.signal ? { signal: options.signal } : {}) };
    const response = options.method === 'post'
      ? await api.post<Blob>(url, undefined, config)
      : await api.get<Blob>(url, config);
    options.signal?.throwIfAborted();
    if (getCompanyScopeRevision() !== revision) throw new DocumentRequestError('เปลี่ยนบริษัทระหว่างดาวน์โหลด กรุณาเปิดเอกสารใหม่จากบริษัทที่ต้องการ');
    return response;
  } catch (error) {
    options.signal?.throwIfAborted();
    // Axios keeps JSON error bodies as Blob when the requested response is binary.
    const response = (error as { response?: { status?: number; data?: unknown } })?.response;
    if (response?.data instanceof Blob && response.data.size <= 65536 && /json/i.test(response.data.type)) {
      try {
        const data: unknown = JSON.parse(await response.data.text());
        throw new DocumentRequestError(getErrorMessage({ response: { status: response.status, data } }));
      } catch (decoded) {
        if (decoded instanceof DocumentRequestError) throw decoded;
      }
    }
    throw error;
  }
}

export async function getProtectedDocument(url: string, options: DocumentRequestOptions = {}) {
  return (await getProtectedDocumentResponse(url, options)).data;
}

export function saveDocumentBlob(data: Blob, filename: string) {
  const url = URL.createObjectURL(data);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

export async function downloadProtectedDocument(path: string, filename: string, options: DocumentRequestOptions = {}) {
  const data = await getProtectedDocument(path, options);
  options.signal?.throwIfAborted();
  saveDocumentBlob(data, filename);
}
