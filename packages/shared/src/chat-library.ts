export interface ChatLibraryFolder {
  id: string; name: string; branchId: string | null;
}
export interface ChatLibraryFile {
  id: string; name: string; mimeType: string; size: number; folderId: string | null;
  branchId: string | null; company: 'SHOP' | 'FINANCE'; createdAt: string;
}
export interface ChatLibraryPage<T> { data: T[]; total: number; page: number; limit: number }
export type LibraryDeliveryStatus = 'SENT' | 'FAILED' | 'UNKNOWN';
export interface LibraryDeliveryResult { fileId: string; requestKey: string; status: LibraryDeliveryStatus; error?: string }
