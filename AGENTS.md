# BESTCHOICE local handoff

Read `.claude/CLAUDE.md` and the relevant workflow/rules before changing code.

The user wants a working local preview and basic checks **after every code change**. This is a standing preference, not a request to deploy.

Navigation rule confirmed by the owner: **งานหน้าร้าน = SHOP; งานการเงิน = FINANCE**. Use one work/company choice in the sidebar. Do not reintroduce an independent company selector in the top bar. Preserve existing company grants and explicit comparison/report filters.

- Work in the checkout containing the actual changes. Do not serve another worktree's frontend or silently reuse its backend.
- Before handing back code, run `npm run local:check`. It fails on errors, refreshes the managed preview, checks the browser, and records `.tmp/local-preview/check.json`. In an older checkout without this command, perform equivalent checks and start its own local app; never silently point it to another checkout.
- This command's default preview covers Inbox, customers, credit, offers, contract handoff, dashboard reads, and the FINANCE portfolio with synthetic data/AI. For other features, also run the appropriate app/API locally from this checkout and exercise the changed flow; do not claim this limited preview validates the whole application.
- Run meaningful tests for the changed behavior in addition to basic checks. For financial/API changes use the existing isolated PostgreSQL test harness; do not run DB-backed tests against an inherited application database.
- API/shared/schema changes require a fresh backend; Vite HMR alone is insufficient. The managed command rebuilds shared code/generates Prisma clients before restarting its own preview.
- Preserve other sessions' processes and work. Never kill by port or process name. If port 5195 belongs to another server, use `LOCAL_PREVIEW_PORT` with a free port and report that URL.
- Leave the verified local server running. Include its clickable URL, what was checked, and any simulated behavior or missing verification in the final reply. If checks fail, report the failure rather than claiming completion.
- Do not automatically merge, deploy, or send messages as part of local verification.

Commands and scope: [docs/guides/local-check.md](docs/guides/local-check.md).
