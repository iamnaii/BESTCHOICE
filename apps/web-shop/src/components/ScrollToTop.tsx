import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router';

/** เฟรมสูงสุดที่รอให้หน้าแบบ lazy วาด element ปลายทางของ #hash (ราว 2 วินาทีที่ 60fps) */
const HASH_WAIT_FRAMES = 120;

function hashTargetId(hash: string): string {
  const raw = hash.slice(1);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Reset scroll on SPA navigation (PUSH/REPLACE). POP (back/forward) is left
    to the browser's own scroll restoration so history feels native.

    A link with a #hash (e.g. `/how-it-works#rates` from the product card) lands on
    a lazy page whose section is not in the DOM yet when this effect runs, so the
    browser's own anchor jump never happens — poll a few frames for the target and
    scroll to it once it renders. The first entry of a fresh load (key `default`,
    reported as POP) gets the same treatment so a shared link with #hash works too.
    Deriving that from the location key (not a ref) keeps it correct under
    StrictMode's double effect; the key itself stays out of the deps so a search-param
    change on the same page does not jump to the top. */
export function ScrollToTop() {
  const { pathname, hash, key } = useLocation();
  const navigationType = useNavigationType();
  const isInitialEntry = key === 'default';

  useEffect(() => {
    if (navigationType === 'POP' && !isInitialEntry) return;
    const id = hash ? hashTargetId(hash) : '';
    const target = id ? document.getElementById(id) : null;
    if (target) {
      target.scrollIntoView();
      return;
    }
    if (navigationType !== 'POP') window.scrollTo(0, 0);
    if (!id) return;

    let frame = 0;
    let raf = 0;
    const waitForTarget = () => {
      const rendered = document.getElementById(id);
      if (rendered) {
        rendered.scrollIntoView();
        return;
      }
      frame += 1;
      if (frame < HASH_WAIT_FRAMES) raf = requestAnimationFrame(waitForTarget);
    };
    raf = requestAnimationFrame(waitForTarget);
    return () => cancelAnimationFrame(raf);
  }, [pathname, hash, navigationType, isInitialEntry]);

  return null;
}
