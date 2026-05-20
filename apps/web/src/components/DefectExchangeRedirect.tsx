import { Navigate, useLocation } from 'react-router';

/**
 * 2026-05-20 unification: /defect-exchange* URLs forward to the unified wizard
 * at /insurance/new with intent=exchange. Preserves any query string so e.g.
 * /defect-exchange?contractId=X → /insurance/new?intent=exchange&contractId=X
 */
export function DefectExchangeRedirect() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  params.set('intent', 'exchange');
  return <Navigate to={`/insurance/new?${params.toString()}`} replace />;
}
