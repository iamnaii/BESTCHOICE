/**
 * `GET /e-tax-xml` caps `limit` at 200 (ListEtaxQueryDto). The document center
 * maps every submission onto the month's invoice rows, so it walks the pages
 * instead of asking for one oversized page (which the API rejects with 400 and
 * left every row without a status — DOC-07, #1566).
 */
export const ETAX_SUBMISSIONS_PAGE_SIZE = 200;

export interface ETaxSubmissionsPage<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export async function fetchAllETaxSubmissions<T>(
  getPage: (url: string) => Promise<ETaxSubmissionsPage<T>>,
  pageSize = ETAX_SUBMISSIONS_PAGE_SIZE,
): Promise<{ data: T[] }> {
  const data: T[] = [];
  for (let page = 1; ; page += 1) {
    const result = await getPage(`/e-tax-xml?page=${page}&limit=${pageSize}`);
    data.push(...result.data);
    const exhausted = result.data.length < pageSize || data.length >= result.total;
    if (exhausted || result.data.length === 0) break;
  }
  return { data };
}
