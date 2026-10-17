# Auth form scale follow-up — 17 October 2026

A post-deployment check of PR #1707 found a remaining auth-form inconsistency. Production login inputs measured 34 px high with 13 px text at both 390 and 1440 px. Login/reset used the compact default Input variant; invite registration used a separate 40 px input class. The full-size form styles had not been applied to these pages.

## Changes

- Login, reset-password and invite registration reuse `formControlClass` and `formLabelClass`: 44 px controls, 16 px text below the desktop breakpoint, 14 px on desktop, and room between labels and focus outlines. Forgot-password already used the full-size field style; its submit button now matches the other auth forms at 44 px.
- The shared auth layout uses 16 px horizontal padding on the smallest screens and permits its grid/flex children to shrink. Invite nickname/phone fields stack below the small-screen breakpoint.
- A valid invitation with a long synthetic email and branch name previously stretched the document to 507 px at a 320 px viewport. Invite metadata now wraps and its role/branch row can wrap; the form remains within the viewport, including with a 20 px root font.
- UI font remains Noto Sans Thai Looped. Compact table controls, document fonts, authentication handlers, API payloads, validation and permissions are unchanged.

## Verification

[Browser results](results.json): **64/64 page states, 160 field measurements passed** using Chromium and WebKit. Each engine covers login, forgot password, reset password with a synthetic token, and a valid invitation with long synthetic metadata, at 320/390/1440 px plus 320 px with a 20 px root font, in light/dark themes.

Assertions cover field/submit dimensions, mobile font size, label association and spacing, font loading, field/document bounds, native required validation, fill/focus and first-to-second input keyboard navigation. A 20 px root font is a font-resizing check, not browser zoom or a physical-device test. There were no uncaught page errors. Auth reads and invite verification are mocked; anonymous logout cleanup is intercepted. No login, reset-email, password-change or registration writes are sent.

The manual [audit harness](audit.cjs) targets the checkout's dedicated Vite docs-QA server at `http://127.0.0.1:53171`; run from the repository with `node docs/reports/auth-field-scale-2026-10-17/audit.cjs`. It writes all screenshots and results alongside itself. The committed screenshots below are representative selections. Development-only quick-login buttons are present in local login screenshots, not evidence of production behavior.

Independent read-only review found no remaining blocker after the long-value wrapping correction. Final `npm run local:check`, PR CI, merge/deployment and public production verification are recorded in the follow-up pull request, so the evidence report does not claim pending release gates have already passed.

## Representative evidence

- [Production login before](production-login-before-390.png)
- [Login at 320 px](login-chromium-320-16-light.png)
- [Desktop login in WebKit](login-webkit-1440-16-light.png)
- [Long invite before](invite-long-before.png)
- [Long invite at 320 px after](invite-chromium-320-16-light.png)
- [Long invite with larger font, WebKit dark](invite-webkit-320-20-dark.png)
- [Forgot password, WebKit dark](forgot-webkit-390-16-dark.png)
- [Reset password](reset-chromium-390-16-light.png)

This closes confirmed auth layout defects. It does not certify real invitation delivery, password reset delivery, every permission/branch combination, live providers, or physical iPhone/Android behavior. Broader UX/UI evidence and its limits are in the [main closure report](../uxui-closure-2026-10-17/README.md).
