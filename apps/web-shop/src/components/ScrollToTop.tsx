import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router';

/** Reset scroll on SPA navigation (PUSH/REPLACE). POP (back/forward) is left
    to the browser's own scroll restoration so history feels native. */
export function ScrollToTop() {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    if (navigationType !== 'POP') window.scrollTo(0, 0);
  }, [pathname, navigationType]);

  return null;
}
