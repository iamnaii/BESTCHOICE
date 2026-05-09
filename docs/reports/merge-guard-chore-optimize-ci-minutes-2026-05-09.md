# Pre-Merge Guard Report

| Field | Value |
|-------|-------|
| **Branch** | `chore/optimize-ci-minutes` |
| **Author** | Akenarin Kongdach |
| **Date** | 2026-05-09 16:29 +0700 |
| **Reviewed** | 2026-05-09 |
| **Recommendation** | 🔶 REVIEW |

## File Changes Summary

2 files changed · 13 insertions · 6 deletions

| Path | Change |
|------|--------|
| `.github/workflows/deploy-gcp.yml` | Remove `needs: lint-and-test` from `build-and-push-api` and `deploy-web`; add `if: github.event_name == 'pull_request'` to `lint-and-test` job |
| `.github/workflows/e2e-tests.yml` | Reduce E2E shards from 4 → 2 |

## Issues

### Critical — Must Fix Before Merge

None — provided branch protection rules are in place (see Warning W-1).

### Warning — Should Fix

| # | File | Issue |
|---|------|-------|
| W-1 | `.github/workflows/deploy-gcp.yml` | `build-and-push-api` and `deploy-web` no longer depend on `lint-and-test`. The `lint-and-test` job now only runs on `pull_request` events. A direct push to `main` (bypassing PR) would deploy to production without running any tests. **This is safe only if branch protection requires PR + passing CI before merge.** Confirm `iamnaii/bestchoice` has: (a) `main` branch protection enabled, (b) `lint-and-test` required status check on PRs. If not enforced, reclassify as Critical. Add a comment to the workflow explicitly documenting this dependency. |
| W-2 | `.github/workflows/e2e-tests.yml` | Shards reduced 4→2. Wall time increases ~50–80% for E2E runs. Monitor first few CI runs for timeouts — the `wait-on` timeout at 15s for the web server is tight and may be the first thing that flakes under slower parallelism. |

### Info

- `lint-and-test` still runs on every PR — test coverage not removed, just repositioned.
- `build-and-push-api` retains its own `if: github.ref == 'refs/heads/main' && github.event_name == 'push'` guard — it won't run on PRs regardless.
- Estimated savings: ~5 min/merge × ~N PRs/month. Reasonable trade-off if branch protection is enforced.
- E2E shard reduction rationale is correct (setup overhead dominates per-shard cost for small suites).

## Verification Checklist

- [x] No application code changes
- [x] No secrets introduced in workflow files
- [ ] Confirm branch protection on `main` requires `lint-and-test` to pass before merge (prerequisite for W-1 to be safe)
- [ ] Add workflow comment documenting that `build-and-push-api` assumes lint+test passed in the PR that introduced the commit
- [ ] Monitor E2E wall time on first run after merge (W-2)
