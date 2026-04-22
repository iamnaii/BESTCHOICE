# `shop.bestchoicephone.app` Setup Runbook

One-time owner setup to bring the customer-facing web-shop online on its own subdomain. After completing these steps, every push to `main` will build and deploy both the admin and the shop in a single CI run.

## What exists after this PR merges

- `firebase.json` has two hosting targets: `admin` (`apps/web`) and `shop` (`apps/web-shop`)
- `.firebaserc` maps targets to site IDs: `admin → bestchoice-prod`, `shop → bestchoice-shop`
- `.github/workflows/deploy-gcp.yml` builds both apps and deploys admin first, then shop (shop step has `continue-on-error: true` so an unconfigured shop site won't break admin deploys)

## What the owner must do (once)

### 1. Create the Firebase Hosting site `bestchoice-shop`

```bash
firebase hosting:sites:create bestchoice-shop --project bestchoice-prod
```

Or via console: Firebase Console → `bestchoice-prod` project → Hosting → **Add another site** → site ID `bestchoice-shop`.

### 2. Connect the custom domain

In Firebase Console → Hosting → the `bestchoice-shop` site → **Add custom domain** → `shop.bestchoicephone.app`. Firebase will give two records to add at the domain registrar (Cloudflare / whoever manages `bestchoicephone.app`):

- a TXT record for domain verification, and
- an A record (or two) pointing to Firebase Hosting IPs

After DNS propagation (5 min – a few hours), Firebase auto-provisions the TLS certificate. The page will turn green in the console.

### 3. Trigger a re-deploy

Either push any commit to `main` or manually re-run the last `Deploy to GCP` workflow. The `Deploy shop hosting` step will now succeed and publish `apps/web-shop/dist` to `shop.bestchoicephone.app`.

### 4. Sanity check

```bash
curl -sI https://shop.bestchoicephone.app | head -5
curl -s https://shop.bestchoicephone.app/api/shop/public-config/analytics
```

Both should return 200. The second proves the `/api/**` rewrite on the shop hosting site is working — it proxies to the same Cloud Run `bestchoice-api` service as the admin site.

## Rollback

Remove the `deploy shop hosting` step from the workflow, or set `if: false`. The admin deploy is independent and unaffected.

## Why a subdomain, not path-based

Two SPAs on the same origin would share cookies, service workers, and the global `window.fbq` / `gtag` singletons — and admin login cookies would leak into the public shop. Subdomain separation is required for clean auth boundaries.

## Post-launch

Once stable, drop the `continue-on-error: true` flag on the `Deploy shop hosting` step so a broken shop build surfaces as a red CI build instead of silently skipping.
