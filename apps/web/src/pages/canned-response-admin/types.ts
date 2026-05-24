export interface CannedResponse {
  id: string;
  shortcut: string;
  title: string;
  content: string;
  category: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
}

export interface ReorderItem {
  id: string;
  sortOrder: number;
  category: string | null;
}

/** A grouped category in the tree */
export interface CategoryGroup {
  name: string; // "อื่นๆ" for null
  items: CannedResponse[]; // sorted by sortOrder asc
}
