# Rulings made during the icon migration

Complete chronological extraction of every recorded `Ruling:` / `ruling:` entry, retained before SDD workspace cleanup. These decisions did not authorize a push, merge or deployment.

1. **Decision:** Continue in the existing non-main feature checkout, with sequential writers and explicit file/hunk staging — owner asked to continue existing work and AGENTS requires the checkout with actual photo changes; a new checkout would omit or duplicate a verified uncommitted backend — risk is accidental mixed commits, mitigated by baseline hashes/patch and reviewing every staged path.
   **Cost if wrong:** Accidental mixed commits; mitigated by exact staging and 30 protected-file hashes.

2. **Decision:** Existing photo/evidence changes remain uncommitted and are not part of icon commits. Task 3 overlap with ContractDetailPage must stage only its new hunks. Never stash/reset/revert them.
   **Cost if wrong:** The photo/evidence feature still needs its own commit/release; it is preserved, not included in icon commits.

3. **Decision:** Run focused verification per task and the mandatory complete local:check at final handoff, not six redundant full runs — final tree and dependency coverage matter; intermediate checks still verify each deliverable.
   **Cost if wrong:** An integration defect may surface at the final gate instead of an intermediate task; focused tests and the final 48-check run cover the final tree.

4. **Decision:** Task 1 inventory is a baseline, completed by Tasks 3–5, not a premature zero-pending claim. Source scanners enumerate candidates for classification; never replace all Unicode strings.
   **Cost if wrong:** A source candidate could be misclassified; explicit reasons, independent review and runtime sampling limit this risk.

5. **Decision:** Keep existing text-only menus text-only, explicitly configure Sonner six slots, review first-party /stock wrapper and record external iframe boundary. Static design-preview HTML is individually listed as reference exceptions.
   **Cost if wrong:** Text-only links remain without icons and the external frame remains outside the migration; those boundaries are disclosed.

6. **Decision:** Task 6 LIFF appearance uses existing mockLiffSdk/mockLiffApi fixture helpers and explicit state assertions when managed preview lacks customer endpoints; do not bootstrap a full financial DB solely for visual icon checks. Actual managed admin API flows still run in local:check; fixture-only coverage must be explicit. Cost if wrong: missing an API-only visual edge, mitigated by unchanged API code and route/state audit.
   **Cost if wrong:** A live LINE/API-only visual edge could remain untested; fixtures are explicitly distinguished from isolated real API checks.

7. **Decision:** Cannot-verify note concerns absent separate raw stdout logs, not absent test evidence: report table records exact commands/exit codes/counts and retained fixture assertions/build log corroborate the results. No functional gap; final validation will persist full stdout. Baseline unchanged chunk warning remains informational.
   **Cost if wrong:** Early task evidence has less standalone raw output; retained final checks and build artifacts provide fresh corroboration.

8. **Decision:** Include discovered HTML-entity status checks in Task3 now (StepSignature, StepKycVerification, StepPdpaConsent, StepComplete, LiffFinanceVerify), not defer residual visible UI to final QA — same approved status scope, preserves adjacent labels/conditions. Task5 scanner must decode decimal/hex/named HTML entities with regression tests; unicode-only discovery was incomplete.
   **Cost if wrong:** An entity replacement could affect alignment or accessible reading; adjacent labels and state tests are preserved.

9. **Decision:** fix discovered MigrationPage numeric package emoji in Task4 inventory phase (Package, decorative, keep36px empty-state illustration) rather than leave an obvious UI remnant. Scope already includes residual glyph completion; no behavior change. Inline ReversePermissionCard quoted action label is documented prose exception.
   **Cost if wrong:** The replacement illustration could look different at the retained 36px size; its empty state was checked.

10. **Decision:** Task4 residual source audit also replaces literal UI action arrows in named LIFF/modal/drawer/pagination/appointment/assets/chat/SectionHeader controls; preserve real prose/message/document/keycap notation. Trend/status symbols must be contextually judged, not automatically data exceptions. Task5 detection expanded to literal/encoded arrows/status glyphs; initial pictographic-only scan missed these.
   **Cost if wrong:** An arrow might be mistaken for data or an action; exact context review and preserved prose prevent blanket replacement.

11. **Decision:** migrate these UI-only remnants within Task4 now; preserve actual arithmetic/keycaps/punctuation/content. Task5 guard requirements and tests expanded accordingly. This is additional discovery within whole-system scope, not new UI behavior.
   **Cost if wrong:** Punctuation could be mistaken for a glyph; numeric, keyboard and content cases remain exact exceptions.

12. **Decision:** preserve CommandPalette trackingNumber → contractNumber as exact data relationship content; preserve storefront ProductCard +overflow as numeric additional-photo count, not add action. Both source contexts reviewed by controller, require exact manifest/inventory entries.
   **Cost if wrong:** Those two symbols could be perceived as UI glyphs; they deliberately retain their data-relationship and additional-count meaning.

13. **Decision:** Task5 discovered real UI remnants must migrate before zero-pending claim: data-grid-pagination clickable ... → MoreHorizontal (descriptive previous/next group names), PurchaseOrders wizard PaymentSection &times; attachment removal→X, inbox ChatMediaPicker Emoji tab 😊→Smile, Customers FilterSelect ↳ hierarchy→shared CornerDownRight/ArrowElbowDownRight16px decorative with explicit Radix textValue and preserved selected label/typeahead. Focused rendered control tests plus scanner fixtures. Source contexts inspected; same approved whole-system scope. CSS generated list bullets remain exact content exceptions.
   **Cost if wrong:** A changed control could lose its name, target or typeahead; focused rendered tests cover those behaviors.

14. **Decision:** CustomerDetailPage/tabs/LoyaltyTab circular standalone +/- EARN/redeem status glyph→shared Plus/Minus, retain signed numeric points unchanged; focused both-state test. Task5 reports7rendered tests pass incl Radix typeahead; clean npm install/SHOP Prisma/both builds pass with all30 protected source overlays.
   **Cost if wrong:** An earned/redeemed sign could be mistaken for a numeric amount; only circular glyphs changed and signed values were tested.

15. **Decision:** Task5 clean index excludes protected uncommitted photo rewrite; HEAD ProductPhotosPanel retained an extra CSS upload spinner absent from working file, making strict stale exceptions incompatible across trees. Approve minimal index-only icon hunk (Camera import+Loader2, CSS spinner→shared16px Loader2 same animation/color/condition, decorative) with unchanged working file bytes. Do not stage photo rewrite. Verify guard both staged snapshot and working source, clean import build/typecheck and30hashes. Reviewer must see actual committed hunk and understand later dirty rewrite removes it.
   **Cost if wrong:** The committed older photo panel differs from the protected working rewrite; both trees were checked, and the working bytes remain unchanged.

16. **Decision:** clean committed-only ProductPhotosPanel conditional missing-photo '-' now caught; align only cached fallback text to approved working rewrite's `ยังไม่มีรูป`, preserving canEdit/disabled/handlers/currentworkingbytes. This avoids stale exception divergence across approved photo rewrite and icon commit; no active UI/content change. Validate both-tree guard and30hashes.
   **Cost if wrong:** The committed older panel receives a clearer empty label; it now matches the already-approved working photo rewrite.

17. **Decision:** update exact obsolete smoke selector + explicit real shared glyph assertion, retainbehaviorassertions; audit relatedlocaltools selectors, run focusedfailedsmokebefore fullrerun. Sourcefreeze withdrawn pending thisnarrowtestfix. Fullfailurelog .tmp/icons/local-check.log/check.json retained. Root inspectedfullAPI390evidencemodalcenteredfit; synthetic1x1 PNGblankappearance requiresdecodednatural-dimension/blobassert inignoredharness (agentdoing), notclaimvisualactualphoto.
   **Cost if wrong:** A broader smoke selector could select the wrong tab; checks scope exact Thai names to the picker and verify glyph, selected state and keyboard activation.

Additional handoff correction: the static storefront alone returned API errors after hydration. An ignored loopback-only public fixture proxy was added at port5293, leaving the verified app build unchanged. Its cost is that preview data is synthetic; account/authentication and transaction writes are unavailable. A fresh browser verified public browsing without request interception and with no external requests.

Final-review dispositions are recorded in [final-review.md](./final-review.md): static scanner limits, baseline layout/motion/focus issues, external/live-provider and physical-screenreader verification boundaries remain disclosed; the observed Chromium accessibility issue and literal add-action detection are being fixed. The single final fix wave also includes the five small concrete regression-test/API-precedence/CI improvements, because one full final verification refresh is already necessary. Cost: additional verification time; no extra product behavior or release scope.

18. **Decision:** Retain the residual formula-fragment scanner false positive as a documented Minor limitation after the single final fix wave. The original add-action regressions are caught, all399 current entries are reviewed, and there is no runtime change or automatic content rewrite.
    **Cost if wrong:** A future JSX-formatted formula caption may fail check:icons until an exact content exception is reviewed. The scoped reviewer classified this residual as Minor; no other new breakage was found.

Integration outcome: retain the existing feature branch and working checkout under the approved local-only plan. No push, merge or deployment is performed. The earlier30 photo/evidence files remain unchanged and uncommitted.
