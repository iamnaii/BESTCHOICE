import OverduePage from '@/pages/OverduePage';

/**
 * AllTab wraps the existing /overdue page for audit/admin use. Provides backward
 * compatibility — the original table + kanban + all modals are preserved verbatim
 * while collectors shift to the new workflow tabs.
 *
 * The original OverduePage includes its own PageHeader — appearing under the
 * CollectionsPage PageHeader. Accepted as a temporary migration artifact;
 * Plan 3 refactors OverduePage to be embeddable without its own header.
 */
export default function AllTab() {
  return <OverduePage />;
}
