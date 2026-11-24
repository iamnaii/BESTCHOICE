# Simplified online listing — approved design

Goal: make listing a recorded phone on the shop a single, understandable workflow.
User approved removing the grade requirement and automatically using the six recorded
product angles (front, back, left, right, top, bottom), front as default cover with
an optional cover choice. Replacements update the same angle, never append copies.
Only product angles are public; staff evidence remains private. Existing manual
galleries remain the fallback for products without active angle photos.

Approaches: retain manual promotion (duplicates work); synchronize storage copies
on every write (many writers, stale copies and retries); derive the public gallery
from current angle records (selected: applies to existing stock without backfill).
Serve individual validated images behind the same public eligibility rule. Query
only angle presence in batches; never load base64 into catalog list responses.
Grade remains optional product/QC metadata, never a publish gate. Hidden, deleted,
no-price, non-shop category and out-of-stock products retain existing eligibility.
Removing the grade gate can make already-enabled eligible stock visible immediately.

UI: compact readiness summary with failed requirements first, collapsible passed
checks, visibility near the top, automatic angle gallery, cover control, compact
warranty. Reuse current form APIs. Mark immediate visibility/cover actions explicitly;
retain explicit saves for descriptive fields. Preserve SHOP/FINANCE and permissions.
Implement locally, verify desktop/mobile and API behavior, do not deploy.
