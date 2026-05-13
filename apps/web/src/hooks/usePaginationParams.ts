import { useSearchParams } from 'react-router';
import { useCallback, useMemo } from 'react';

type Options = {
  defaultPage?: number;
  defaultSize?: number;
};

export function usePaginationParams(options: Options = {}) {
  const { defaultPage = 1, defaultSize = 50 } = options;
  const [searchParams, setSearchParams] = useSearchParams();

  const page = useMemo(() => {
    const raw = Number(searchParams.get('page'));
    return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : defaultPage;
  }, [searchParams, defaultPage]);

  const size = useMemo(() => {
    const raw = Number(searchParams.get('size'));
    return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : defaultSize;
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
