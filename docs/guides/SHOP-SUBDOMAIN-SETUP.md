# `shop.bestchoicephone.app` Setup Runbook

One-time setup to bring the customer-facing web-shop online on its own subdomain. After completing these steps, every push to `main` will build and deploy both the admin and the shop in a single CI run.

## What exists after this PR merges

- `firebase.json` has two hosting targets: `admin` (`apps/web`) and `shop` (`apps/web-shop`)
- `.firebaserc` maps targets to site IDs: `admin → bestchoice-prod`, `shop → bestchoicephone-shop`
- The `bestchoicephone-shop` site was provisioned via the Firebase REST API on 2026-04-22; default URL is already live at https://bestchoicephone-shop.web.app
- `.github/workflows/deploy-gcp.yml` builds both apps and deploys admin first, then shop (shop step has `continue-on-error: true` as a safety net; once the custom domain is live and stable, remove that flag)

## What the owner must do (once)

### 1. ~~Create the Firebase Hosting site~~ — done

Site `bestchoicephone-shop` already exists in project `bestchoice-prod`. No action needed.

### 2. Connect the custom domain

Firebase Console → Hosting → **bestchoicephone-shop** site → **Add custom domain** → `shop.bestchoicephone.app`. Firebase will show two records to add at the domain registrar (Cloudflare / whoever manages `bestchoicephone.app`):

- a TXT record for domain verification, and
- an A record (or two) pointing to Firebase Hosting IPs

After DNS propagation (5 min – a few hours), Firebase auto-provisions the TLS certificate. The console turns green.

### 3. Trigger a re-deploy

Either push any commit to `main` or manually re-run the latest `Deploy to GCP` workflow. The **Deploy shop hosting** step will publish `apps/web-shop/dist` to the site, reachable at both `https://bestchoicephone-shop.web.app` and `https://shop.bestchoicephone.app` once the custom domain is live.

### 4. Sanity check

```bash
curl -sI https://bestchoicephone-shop.web.app | head -5
curl -s https://bestchoicephone-shop.web.app/api/shop/public-config/analytics
# once custom domain is live:
curl -sI https://shop.bestchoicephone.app | head -5
```

The `/api/**` path proves the Firebase rewrite is proxying to the same Cloud Run `bestchoice-api` service as the admin site.

## Rollback

Flip the `deploy shop hosting` step to `if: false`, or revert this PR. The admin deploy is independent and unaffected.

## Why a subdomain, not path-based

Two SPAs on the same origin would share cookies, service workers, and the global `window.fbq` / `gtag` singletons — and admin login cookies would leak into the public shop. Subdomain separation is required for clean auth boundaries.

## Post-launch

Once `shop.bestchoicephone.app` is stable, drop the `continue-on-error: true` flag on the `Deploy shop hosting` step so a broken shop build surfaces as a red CI build instead of silently skipping.
