import { useSearchParams } from 'react-router';
import { useCallback, useMemo } from 'react';

type Options = {
  defaultPage?: number;
  defaultSize?: number;
};

/**
 * D1.2.3.2 — URL `?size=N` is clamped to this inclusive range. The backend
 * still validates server-side, but clamping client-side avoids sending
 * obviously-bad values (e.g. `?size=99999` triggering 50MB JSON payloads or
 * `?size=0` causing empty-page UX confusion).
 *
 * Lower bound 10: smallest sensible page that still has meaningful pagination
 * UI (page-jumper visible, etc).
 * Upper bound 200: large enough for power users but caps server work + DOM
 * size at a level where typical list pages still scroll smoothly.
 */
const URL_SIZE_MIN = 10;
const URL_SIZE_MAX = 200;

export function usePaginationParams(options: Options = {}) {
  const { defaultPage = 1, defaultSize = 50 } = options;
  const [searchParams, setSearchParams] = useSearchParams();

  const page = useMemo(() => {
    const raw = Number(searchParams.get('page'));
    return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : defaultPage;
  }, [searchParams, defaultPage]);

  const size = useMemo(() => {
    const rawParam = searchParams.get('size');
    if (rawParam === null) return defaultSize;
    const raw = Number(rawParam);
    if (!Number.isFinite(raw) || raw < 1) return defaultSize;
    // Clamp to [URL_SIZE_MIN, URL_SIZE_MAX] so a bookmarked / hand-edited URL
    // can't blow up the server with a 99999-row request or render an empty
    // page from `?size=0`.
    return Math.min(URL_SIZE_MAX, Math.max(URL_SIZE_MIN, Math.floor(raw)));
  }, [searchParams, defaultSize]);

  const setPage = useCallback((nextPage: number) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('page', String(nextPage));
      return next;
    });
  }, [setSearchParams]);

  const setSize = useCallback((nextSize: number) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('size', String(nextSize));
      next.set('page', '1'); // reset to first page on size change
      return next;
    });
  }, [setSearchParams]);

  return { page, size, setPage, setSize };
}
