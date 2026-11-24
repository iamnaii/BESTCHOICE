# Owner employee access console

Approved for planning and local implementation by the owner on 2026-11-24 ("ok ครับ วางแผน ทำด้วยได้เลย"), following the proposed พนักงานและสิทธิ์ page. This is the console slice of `2026-11-24-role-access-renewal-design.md`, not authorization to migrate production staff or deploy.

## Outcome

Owner-only `/settings/access/employee-permissions` with three tabs: พนักงาน, ตำแหน่งและสิทธิ์, ประวัติการเปลี่ยนแปลง. Reuse the existing positions/assignments service and its transaction/audit/revision protections. Thai UI, existing app layout, responsive and keyboard accessible.

Positions: searchable grouped catalog, reserved owner/all-staff entries explained and unassignable; explicit initialize missing templates; create, clone with reviewed new code/name, edit and activate/deactivate; preview added/removed permissions and affected staff count before mutations. Owner authority stays outside editable positions. Disabling an in-use position clearly warns that its grants cease immediately; owner may confirm the revocation, consistent with existing service semantics. No implicit grants or template overwrite.

Employees: search, legacy/managed/inactive/owner status; select a person, see current server snapshot and grant source grouped by position/work/scope/branches. Edit multiple assignment tuples independently. BRANCHES requires at least one eligible branch, COMPANY clears branch selection, ASSIGNED explains that an actual assigned resource is additionally required. No role/company/branch cross product. Owners are displayed but not editable here; account ownership is a separate function. Inactive staff cannot be assigned.

Before saving assignments display before/after tuples and permission changes, explicit warnings for company-wide access and empty access, and a confirmation explaining immediate conversion from legacy rules and removal of old individual grants. Show actual legacy override summary from migration-preview. Warn that managed integration is still incomplete: this page does not certify every business workflow. Never silently migrate on opening, template creation, or previews. Existing APIs remain the authoritative mutation validators.

The effective-access panel describes actual access snapshot policy, not a promise that every route works. ASSIGNED is conditional. Dependency warnings are an explicit, small reviewed mapping (e.g. a mutation normally needs its module read permission); advisory only, never auto-grant. Explain uncertainty and leave final business policy to owner.

History: owner-only bounded paginated access configuration events with actor/time/action/target and safe before/after projection (permission keys and tuple scope, never arbitrary AuditLog payloads or unrelated events). Detail includes human-readable labels. No audit mutation.

## Server additions

Owner-rechecked read endpoints under `/employee-access`: `context` (active branch options with company codes), `employees/:id/effective-access` (current snapshot), `history?page=1&limit=20` (max 50). Follow existing guards and manifest. Shared DTO response types for these additions. Reject owner assignment mutation server-side as well as UI to protect implicit owner authority.

## Acceptance and verification

Test unauthorized reads/mutations, stale revisions, invalid scope/branch, reserved grants, template non-overwrite, immediate revocation, owner-target protection, access-only safe history projection, pagination bounds; real isolated PostgreSQL persistence. UI tests exercise searching/editing/confirmation/error/conflict, tuple independence, owner locks and history. Browser run against the actual Nest employee-access service using isolated synthetic PostgreSQL data, with mutations persisted and read back; separate standard `local:check` preview remains limited to its documented domains. No real database credentials or accounts, no external side effects, no merge/push/deploy.
