# Admin light/dark colors

`apps/web/src/styles/admin-colors.css` applies the owner-selected emerald + neutral gray palette to admin screens. Light mode has white cards on a pale gray page; dark mode separates the page, cards, popovers and hover surfaces with neutral gray levels.

- Use existing semantic tokens (`primary`, `success`, `warning-strong`, `destructive`, `info`, `orange`) and their foreground pairs. Keep `warning` for filled backgrounds and `warning-strong` for text.
- Tailwind v4 `--color-*` aliases are rebound on the guarded body alongside their HSL variables. Overriding only the HSL variables on body leaves inherited root aliases resolved to the old colors.
- Both modes share the document exclusion guard in `admin-typography.css`. The palette is screen-only and turns off while a receipt, document, template, sticker, editor or iframe is mounted. Root tokens, document components and print rules are unchanged.
- The top bar uses `resolvedTheme` so a system-dark preference switches to light on the first click. Main mounts the existing theme-aware Sonner component.
- Normal text/semantic badges target 4.5:1 contrast, input boundaries 3:1, with an explicit keyboard focus outline. Do not dim readable metadata with arbitrary opacity.

Validation for this change covers rendered portfolio, sales, payments, customers and Inbox; shared button/badge variants, input placeholders, notification theme, hover/focus, theme persistence and the system-dark toggle. Real receipt, template preview and sticker components are compared with the palette enabled/disabled in both themes and screen/print media. Browser fixtures use synthetic local data only.
