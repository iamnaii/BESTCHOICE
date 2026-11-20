import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router';
export type SellStep =
  | { kind: 'device' | 'storage' | 'review' | 'eligibility' | 'result' | 'seller' }
  | { kind: 'question'; key: string };
interface Entry {
  session: string;
  index: number;
  step: SellStep;
}
export function useSellNavigation(initialStep: SellStep) {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const session = useRef(crypto.randomUUID());
  const initial = useRef(initialStep);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const entry = location.state?.sellStep as Entry | undefined;
  const ownEntry = entry?.session === session.current ? entry : undefined;
  const step = ownEntry?.step ?? initial.current;
  const cancelAdvance = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setTransitioning(false);
  }, []);
  useLayoutEffect(() => {
    if (navigationType === 'POP') cancelAdvance();
  }, [location.key, navigationType, cancelAdvance]);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const go = (next: SellStep) => {
    cancelAdvance();
    navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      {
        state: {
          ...location.state,
          sellStep: { session: session.current, index: (ownEntry?.index ?? 0) + 1, step: next },
        },
      },
    );
  };
  const advance = (next: SellStep) => {
    if (timer.current !== null) return;
    setTransitioning(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      go(next);
    }, 220);
  };
  const back = (fallback: SellStep) => {
    cancelAdvance();
    if ((ownEntry?.index ?? 0) > 0) navigate(-1);
    else go(fallback);
  };
  const reset = (next: SellStep) => {
    cancelAdvance();
    session.current = crypto.randomUUID();
    initial.current = next;
    navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      {
        replace: true,
        state: { ...location.state, sellStep: { session: session.current, index: 0, step: next } },
      },
    );
  };
  return { step, transitioning, go, advance, back, reset, cancelAdvance };
}
