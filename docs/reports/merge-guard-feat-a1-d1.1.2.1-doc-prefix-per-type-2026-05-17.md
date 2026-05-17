# Merge Guard Report — feat/a1-d1.1.2.1-doc-prefix-per-type

**Date**: 2026-05-17  
**Author**: iamnaii@MacBook-Pro-khxng-Akenarin.local (iamnaii)  
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/api/src/modules/expense-documents/services/doc-number.service.ts` | `PREFIX_MAP` moved to `SettingsService`; `resolvePrefixMap()` private method added |
| `apps/api/src/modules/settings/settings.service.ts` | `DEFAULT_DOC_PREFIX_MAP`, `DOC_PREFIX_REGEX` exported; `getDocPrefixMap()`, `validateKeyValue()` added; `getUiFlags()` includes `docPrefixMap` |
| `apps/web/src/hooks/useUiFlags.ts` | `docPrefixMap` field added to `UiFlags` interface + `DEFAULT_UI_FLAGS` |
| `docs/superpowers/tracking/D1-settings-implement.md` | Tracking doc update |

---

## Issues by Severity

### Critical — None

No new controllers. No new guards needed. No `Number()` on financial fields. `$executeRawUnsafe` in `doc-number.service.ts` is pre-existing (line 81 in `origin/main`), not introduced by this branch. No hardcoded secrets.

### Warning

**W1 — Silent fallback in `resolvePrefixMap()` swallows all errors without logging**  
```ts
private async resolvePrefixMap(): Promise<Record<DocumentType, string>> {
  try {
    return await this.settings.getDocPrefixMap();
  } catch {
    return { ...DEFAULT_DOC_PREFIX_MAP };
  }
}
```
The defensive fallback is intentional (documented in the docstring). However, a silent catch — including programming errors, DB connection failures during high load, etc. — gives operators no signal that the override is being silently ignored. A `Logger.warn('doc-prefix fallback to defaults: ...')` on catch would let alerts fire without breaking doc creation.

### Info

1. **Multi-line docstrings** throughout `settings.service.ts` additions — violates one-line-max rule.
2. **`DOC_PREFIX_REGEX` silently ignores numbers** — `^[A-Z]{2,4}$` rejects hypothetical future prefixes like `EX2` or `CN1`. Acceptable restriction for now, but worth noting if future `DocumentType` additions need numeric suffixes.
3. **`validateKeyValue` is open-coded** — if more keys need value validation in the future, this method will grow into a long `if/else` chain. Not a current problem (only one validated key), just a heads-up for the next person to touch it.

---

## Summary

Well-designed defensive implementation. The silent catch in `resolvePrefixMap()` is the only non-trivial concern; adding a `Logger.warn` on fallback is a low-effort improvement that significantly improves observability. Does not block merge.
