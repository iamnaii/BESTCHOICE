import { ReverseReasonsManagementCard } from '../components/ReverseReasonsManagementCard';

/**
 * InternalControlActionBar — Settings tab that hosts company-wide internal
 * control configuration. Initial content is the reverse-reasons dropdown
 * manager (used by the shared ReverseConfirmDialog across 3 modules).
 *
 * Permission gating: SettingsPage already redirects non-OWNER away from
 * this entire route, so no extra guard is needed here.
 */
export function InternalControlTab() {
  return (
    <div className="space-y-4">
      <ReverseReasonsManagementCard />
    </div>
  );
}
