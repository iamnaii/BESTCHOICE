# System icon inventory

Baseline captured on 2026-11-23 in the BESTCHOICE checkout at `6a8481e1b`. The working tree already held separate product photo and evidence changes. The pre-extraction status, binary diff, dirty-file hashes and per-chunk sizes are recorded in the local task evidence under `.superpowers/sdd/2026-11-23-system-icons/`. The captured patch matched the prior checkout baseline.

## Bundle baseline

Measured the existing built files under each app’s `dist/assets` before extraction. Sizes are bytes on disk and bytes from Node’s default gzip of each JavaScript asset. Totals sum assets individually and include lazy chunks.

| Surface | JavaScript asset | Bytes | Gzip bytes |
| --- | --- | ---: | ---: |
| Admin | Entry `index-C2qw9g1g.js` | 323,176 | 84,762 |
| Admin | Icons `icons-CSp_OcoU.js` | 798,284 | 174,378 |
| Admin | React vendor `vendor-C8hSRH6v.js` | 219,415 | 69,637 |
| Admin | Product detail `ProductDetailPage-jbxu9dAy.js` | 102,501 | 23,783 |
| Admin | All 443 JavaScript assets | 12,221,664 | 3,257,314 |
| Storefront | Entry `index-DK_-Mk0y.js`, the only JavaScript asset | 995,009 | 294,819 |

## Shared renderer and navigation

| File | Owner and state | Category | Task 1 result | Evidence |
| --- | --- | --- | --- | --- |
| `apps/web/src/lib/icons/index.ts` | Admin semantic glyphs for actions, status and decoration | UI glyphs | Moved to `packages/icons/src/index.ts` with identical mappings and retained the admin import path | Existing semantic export tests and single-icon production fixtures |
| `apps/web/src/lib/icons/create-icon.ts` | Admin SVG props, weight and refs | UI renderer | Moved to `packages/icons/src/create-icon.ts` and retained the admin import path | Package consumer render and admin SVG compatibility tests |
| `apps/web/src/config/navigation-icons.ts` | SHOP, FINANCE and settings destinations, aliases, groups and work selectors | Navigation | Admin registry consumes the shared factory through the admin adapter | Existing geometry tests, six-role coverage and SHOP/FINANCE navigation component rendering |

Task 1 admin production output contains 443 JavaScript assets (12,221,170 bytes and 3,257,308 gzip bytes). The relocated icon chunk `src-B7kHX2E-.js` is 798,284 bytes and 174,378 gzip bytes. A production fixture importing only `ShieldCheck` rendered that one semantic export and only its two Phosphor glyph modules under both Vite versions used in the repository.

## Storefront Lucide consumers

Source inspection confirmed the 48 planned files and 61 imported names, including the `LucideIcon` type and one button story. Tasks 2 and 3 migrated the storefront consumers listed below, including the story. Route ownership comes from `apps/web-shop/src/App.tsx`, page imports and component usage. The state column identifies source contexts. The route/state matrix below records browser and component verification.

The migration reused identically named shared semantic exports and used these mappings for the remaining names.

| Existing name | Target |
| --- | --- |
| `BadgeCheck` | Shared `BadgeCheck` wrapping Phosphor `SealCheck` |
| `BatteryCharging` | Shared `BatteryCharging` wrapping Phosphor `BatteryCharging` |
| `Compass` | Shared `Compass` wrapping Phosphor `Compass` |
| `Expand` | Shared `Expand` wrapping Phosphor `ArrowsOut` |
| `Share2` | Shared `Share2` wrapping Phosphor `ShareNetwork` |
| `Facebook` | `FacebookLogo` on the home page and in the footer |
| `Music2` | `TiktokLogo` in the footer |
| `LucideIcon` | `AppIcon` type |

| File | Imported names | Category | Route and state |
| --- | --- | --- | --- |
| `apps/web-shop/src/components/InstallmentCalculatorCard.tsx` | `MessageCircle` | control | `/products/:id` · Installment estimate contact action |
| `apps/web-shop/src/components/catalog/Breadcrumb.tsx` | `ChevronRight` | navigation | `/products/:id` · Breadcrumb separator |
| `apps/web-shop/src/components/catalog/CatalogResults.tsx` | `Search` | status | `/products` · Empty search results |
| `apps/web-shop/src/components/catalog/FilterSidebar.tsx` | `SlidersHorizontal`, `Sparkles`, `Smartphone`, `X` | control | `/products` · Desktop and mobile filters, device and plan controls, clear filter |
| `apps/web-shop/src/components/catalog/GalleryImage.tsx` | `ImageOff` | status | `/products/:id` · Photo load fallback in gallery and lightbox |
| `apps/web-shop/src/components/catalog/ImageLightbox.tsx` | `ChevronLeft`, `ChevronRight`, `ZoomIn`, `ZoomOut`, `X` | control | `/products/:id` · Expanded gallery previous, next, zoom and close |
| `apps/web-shop/src/components/catalog/Product360Viewer.tsx` | `RotateCw` | control | `/products/:id` · 360-degree gallery affordance |
| `apps/web-shop/src/components/catalog/ProductGallery.tsx` | `ChevronLeft`, `ChevronRight`, `Expand`, `ImageOff` | control, status | `/products/:id` · Thumbnail navigation, open lightbox, no-photo state |
| `apps/web-shop/src/components/hero/CategoryHero.tsx` | `ChevronRight` | navigation | Category and account pages · Optional breadcrumb separator |
| `apps/web-shop/src/components/hero/HomeHero.tsx` | `ArrowRight`, `MessageCircle` | control | `/` · Browse and chat calls to action |
| `apps/web-shop/src/components/hero/PhoneShowcase.tsx` | `ShieldCheck` | decoration | `/` · Trust badge on phone display |
| `apps/web-shop/src/components/layout/FloatingLineButton.tsx` | `MessageCircle` | control | ShopLayout routes · Floating LINE contact and mobile visibility |
| `apps/web-shop/src/components/layout/ShopFooter.tsx` | `Facebook`, `MessageCircle`, `Music2`, `MapPin`, `Phone` | brand, control | ShopLayout routes · Facebook, LINE and TikTok links, store map and phone |
| `apps/web-shop/src/components/layout/ShopHeader.tsx` | `Menu`, `Search`, `User`, `X` | control, navigation | ShopLayout routes · Search, account and mobile menu open or close |
| `apps/web-shop/src/components/shop/FaqAccordion.tsx` | `Plus` | control | `/how-it-works` · Question expand and collapse |
| `apps/web-shop/src/components/shop/PromotionsStrip.tsx` | `Gift`, `Percent`, `Tag`, `Sparkles`, `ChevronRight` | decoration, navigation | `/` and `/promotions` · Promotion types and continuation |
| `apps/web-shop/src/components/shop/TrustStrip.tsx` | `ShieldCheck`, `Wallet`, `MessageCircle`, `BadgeCheck` | decoration | `/`, `/products/:id`, `/how-it-works`, `/returns` · Trust and contact feature cards |
| `apps/web-shop/src/components/states/ErrorState.tsx` | `AlertCircle`, `RefreshCw` | status, control | Catalogue, order detail and sell flow · Error illustration and optional retry |
| `apps/web-shop/src/components/ui/Stepper.tsx` | `Check` | status | `/orders/:orderNumber` and `/sell/:id` · Completed step |
| `apps/web-shop/src/components/ui/button.tsx` | `ChevronDown`, `Loader2`, `LucideIcon` | control, status, type | Shared storefront buttons · Split-trigger chevron, pending spinner and icon prop type |
| `apps/web-shop/src/components/ui/dialog.tsx` | `X` | control | `/products`, `/products/:id`, `/account/addresses` · Dialog dismiss in mobile filters, lightbox and address editor |
| `apps/web-shop/src/components/ui/native-select.tsx` | `ChevronDown` | control | `/products` and `/products/:id` · Filter, sorting and installment selector caret |
| `apps/web-shop/src/pages/AboutPage.tsx` | `BadgeCheck`, `ShieldCheck`, `MapPin`, `type LucideIcon` | decoration, control, type | `/about` · Benefits and store map |
| `apps/web-shop/src/pages/CatalogPage.tsx` | `SlidersHorizontal`, `ChevronDown`, `X`, `Banknote`, `CalendarClock` | control, status | `/products` · Mobile filters, chips and cash or installment selector |
| `apps/web-shop/src/pages/ContactPage.tsx` | `MessageCircle`, `Phone`, `MapPin`, `Clock`, `Send` | control, decoration | `/contact` · LINE, phone, map, hours and contact action |
| `apps/web-shop/src/pages/HomePage.tsx` | `Search`, `ShieldCheck`, `BadgeCheck`, `Wallet`, `Briefcase`, `MessageCircle`, `Smartphone`, `Repeat`, `MapPin`, `Clock`, `Star`, `Facebook` | control, decoration, brand | `/` · Product search, trust, devices, store hours and Facebook |
| `apps/web-shop/src/pages/HowItWorksPage.tsx` | `MessageCircle`, `CreditCard`, `PartyPopper`, `ShieldCheck`, `type LucideIcon` | navigation, decoration, type | `/how-it-works` · Purchase steps, trust and the ShieldCheck link to `/installment-terms` |
| `apps/web-shop/src/pages/InstallmentTermsPage.tsx` | `Calculator`, `FileCheck`, `Lock`, `Check`, `AlarmClock`, `BadgePercent`, `QrCode`, `MessageCircle`, `ShieldCheck` | control, decoration | `/installment-terms` · Requirements, payment information and contact |
| `apps/web-shop/src/pages/NotFoundPage.tsx` | `Compass` | status | Unmatched route · 48 px not-found illustration |
| `apps/web-shop/src/pages/OrdersPage.tsx` | `Package` | status | `/orders` · Empty order history |
| `apps/web-shop/src/pages/ProductDetailPage.tsx` | `MessageCircle`, `Phone`, `Share2` | control | `/products/:id` · Chat, phone and share actions |
| `apps/web-shop/src/pages/PromotionsPage.tsx` | `Gift`, `MessageCircle` | control, status | `/promotions` · Offer tiles, empty promotion state and chat |
| `apps/web-shop/src/pages/ReturnsPage.tsx` | `ShieldCheck`, `RotateCcw`, `MessageCircle`, `Phone` | control, decoration | `/returns` · Return and warranty information, chat and phone |
| `apps/web-shop/src/pages/ShippingPage.tsx` | `Store`, `Truck`, `Package`, `MapPin`, `Clock`, `type LucideIcon` | decoration, type | `/shipping` · Pickup, shipping and timing |
| `apps/web-shop/src/pages/account/AccountPage.tsx` | `BadgeCheck`, `LogOut`, `MapPin`, `Package` | navigation, control, status | `/account` · Addresses, orders, logout and account identity |
| `apps/web-shop/src/pages/account/AddressBookPage.tsx` | `MapPin`, `Plus` | control, status | `/account/addresses` · Add address and address/empty-state glyph |
| `apps/web-shop/src/pages/auth/LineCallbackPage.tsx` | `MessageCircle` | control | `/auth/line-callback` · LINE support action on callback error |
| `apps/web-shop/src/pages/auth/LoginPage.tsx` | `MessageCircle` | control | `/login` · LINE sign-in |
| `apps/web-shop/src/pages/landing/InstallmentLopburiPage.tsx` | `UserCheck`, `Clock3`, `Store`, `ShieldCheck` | decoration | `/ผ่อนไอโฟนลพบุรี` · Eligibility, timing, shop and warranty benefits |
| `apps/web-shop/src/pages/landing/NoCreditCardPage.tsx` | `UserCheck`, `X`, `Check` | status, decoration | `/ผ่อนมือถือไม่ใช้บัตรเครดิต` · Eligibility and requirements |
| `apps/web-shop/src/pages/landing/UsedIphoneLopburiPage.tsx` | `BadgeCheck`, `BatteryCharging`, `ShieldCheck`, `Repeat` | decoration | `/iphone-มือสอง-ลพบุรี` · Device quality, battery, warranty and exchange |
| `apps/web-shop/src/pages/sell/SellLandingPage.tsx` | `ArrowRight`, `Store` | control, decoration | `/sell` · Start sell flow and highlight store |
| `apps/web-shop/src/pages/sell/SellStatusPage.tsx` | `MessageCircle`, `Phone` | control | `/sell/:id` · Chat and phone contact in status view |
| `apps/web-shop/src/pages/sell/components/ChoiceButton.tsx` | `Check` | status | `/sell/quote` · Selected choice across device, origin, questions and quote |
| `apps/web-shop/src/pages/sell/components/QuoteResultStep.tsx` | `Clock3`, `ShieldCheck` | status, decoration | `/sell/quote` · Quote timing and trust information at result |
| `apps/web-shop/src/pages/sell/components/SellContactLinks.tsx` | `MapPin`, `MessageCircle`, `UserPlus` | control | `/sell/quote` and `/sell/:id` · Map, LINE chat and add-friend actions |
| `apps/web-shop/src/pages/sell/components/SellFlowLayout.tsx` | `ArrowLeft` | control | `/sell/quote` · Back action in wizard shell |
| `apps/web-shop/src/stories/button.story.tsx` | `ArrowRight`, `LogIn` | example | Button story · Icon button examples |

## Admin and shared status migrations

Paths in this section are relative to `apps/web/src` unless a storefront path is given. All rows are migrated. Browser and component states are listed in the verification matrix.

| File | Route and state | Shared glyphs |
| --- | --- | --- |
| `components/accounting/ReverseConfirmDialog.tsx` | `/expenses` and `/assets/:id`, reversal impact | AlertTriangle |
| `components/contract/ContractDocuments.tsx` | `/contracts/:id`, signed and unsigned documents, PDPA consent | Check, Square |
| `components/layout/TestModeBanner.tsx` | Staff layout and public signing, enabled test mode | AlertTriangle |
| `components/signing/ProgressStepper.tsx` | `/contracts/:id/sign`, completed wizard step | Check |
| `components/signing/StepKycVerification.tsx` | Signing wizard, verified and completed states and verified OTP | CheckCircle2, Check, replacing three `&#10003;` entities |
| `components/signing/StepPdpaConsent.tsx` | Signing wizard, existing consent | CheckCircle2, replacing `&#10003;` |
| `components/signing/StepSignature.tsx` | Signing wizard, completed signer, all signed and current signer confirmation | Check, CheckCircle2, replacing two `&#10003;` entities |
| `components/signing/StepComplete.tsx` | Signing wizard, completed flow | CheckCircle2, replacing `&#10003;` |
| `pages/ChannelSettingsPage.tsx` | `/settings/comms/channels`, channel tiles | MessageSquare for LINE, FacebookLogo, TiktokLogo |
| `pages/ExpenseDetailPage.tsx` | `/expenses/:id` and verification views, draft through reversal status | PencilLine, Clock, CheckCircle2, BookOpen, RotateCcw |
| `pages/FinanceReceivablePage/ContactTimeline.tsx` | `/finance-receivable`, contact appointment outcomes | CheckCircle2, XCircle, Clock |
| `pages/LineGreetingPage.tsx` | `/settings/comms/greeting`, editor tip | Lightbulb |
| `pages/PurchaseOrdersPage/components/UnitInspectScreen.tsx` | `/purchase-orders`, unit inspection pass and fail | Check, X |
| `pages/TradeInPage/components/ValuationsTab.tsx` | `/trade-in`, valuations guidance | AlertTriangle |
| `pages/UnifiedInboxPage/components/ChatLibraryPicker.tsx` | `/inbox/:roomId?`, selected library item | Check |
| `pages/UnifiedInboxPage/components/ChatMediaPicker.tsx` | `/inbox/:roomId?`, open media picker sticker tab | Package |
| `pages/UnifiedInboxPage/components/MessageBubble.tsx` | `/inbox/:roomId?`, auto-reply timestamp | Bot |
| `pages/UnifiedInboxPage/components/gfin/GfinStepCustomer.tsx` | `/inbox/:roomId?`, GFIN identification validation | Check, X |
| `pages/canned-response-admin/QuickReplyEditor.tsx` | `/canned-responses`, channel behavior warning | AlertTriangle |
| `pages/liff/LiffFinanceVerify.tsx` | `/liff/finance-verify`, already-linked account | CheckCircle2, replacing `&#10003;` |
| `pages/liff/LiffNotificationSettings.tsx` | `/liff/notifications`, preference categories | Wallet, AlertTriangle, Receipt |
| `components/ui/sonner.tsx` and `apps/web-shop/src/components/ui/sonner.tsx` | Toast success, info, warning, error, loading and dismiss | CheckCircle2, Info, AlertTriangle, CircleX, animated Loader2, X |
| `pages/MigrationPage.tsx` | `/migration`, empty import result | Package, replacing `&#128230;`. The 36 px illustration retains the scale of the original empty-state mark. |
| `pages/liff/LiffNotificationSettings.tsx`, `LiffFinanceVerify.tsx`, `LiffBranches.tsx`, `LiffReceipts.tsx` | LIFF error cards | 48 px AlertCircle, replacing standalone `!` at the original illustration scale |
| `pages/liff/LiffEarlyPayoff.tsx`, `LiffHistory.tsx`, `LiffProfile.tsx` | LIFF error cards inside 80 px circular backgrounds | 36 px AlertCircle, replacing standalone `!` at the original illustration scale |
| `pages/ReportsPage.tsx` | `/reports`, data-loading failure and retry | AlertCircle at regular 20 px, replacing standalone `!` |
| `pages/DashboardPage/components/DashboardKPIs.tsx` | `/`, year-over-year revenue indicator | ArrowUp and ArrowDown replace `↑` and `↓`. The numeric value and directional condition are preserved. |
| `components/payment/PaymentHistorySheet.tsx` | Payment history, paid receipt badge | CheckCircle2 replaces the `●` mark before the paid label |
| `pages/assets/AssetSchedulePage.tsx` | `/assets/:id/schedule`, current period row | ArrowLeft replaces the `←` marker. Screen readers receive the current-period description. |
| `pages/shop-daily-cash/CashCloseSteps.tsx` | `/shop/daily-cash`, labelled step sequence | ArrowRight replaces the directional separator |
| `components/expense-form-v4/PayrollLinesSection.tsx` and `components/expense-form-v4/payroll-system/PayrollSystemRows.tsx` | Expense payroll form, custom income and system deductions headers | Plus and Minus |
| `components/payment/SlipReviewTab.tsx` | `/payments?tab=slip-review`, open slip preview | Plus and Minus. Thai accessible names identify image zoom direction. |
| `components/ui/data-grid-pagination.tsx` | Previous and next page-group controls | 16 px MoreHorizontal replaces the two clickable `...` marks. Each has a Thai accessible name for its direction. |
| `pages/PurchaseOrdersPage/components/wizard/PaymentSection.tsx` | Remove a named purchase-order attachment | 16 px X replaces `&times;`. The attachment label and removal target are preserved. |
| `pages/UnifiedInboxPage/components/ChatMediaPicker.tsx` | Emoji tab | 16 px Smile replaces the leading emoji on the tab. Selectable message emoji and category samples remain. |
| `pages/CustomersPage/components/FilterSelect.tsx` | Subordinate filter options | 16 px CornerDownRight replaces `↳` in the list. The plain option label drives Radix typeahead and selected trigger text. |
| `pages/CustomerDetailPage/tabs/LoyaltyTab.tsx` | Earned and redeemed points, round status mark | 16 px Plus and Minus replace the standalone signs. The signs on numeric amounts remain text. |
| `components/product/ProductPhotosPanel.tsx` | Upload pending in the checked-in product photo panel | 16 px Loader2 replaces the rotating CSS border. The upload condition, size, animation and color are retained. |

The shared 36, 48 and 60 px signing confirmations retain their original illustration scale and have visible result headings. The storefront retains 28 px trust and selection-card glyphs, 32 px gallery load-error glyphs, the 40 px no-photo glyph and 48 px standalone illustrations for empty, error and not-found states.

## Navigation and inline actions

The admin menu geometry test covers every registered destination, group and selector, with per-zone mappings for OWNER, FINANCE_MANAGER, ACCOUNTANT, BRANCH_MANAGER, SALES and VIEWER. SHOP and FINANCE render actual expanded navigation leaves. The settings test compares each rendered category and the contacts link to its registered SVG geometry. The existing `/collections` and `/overdue` alias maps to one destination identity. Text-only settings group headings keep their text presentation.

| Storefront location | Destination or action | Geometry |
| --- | --- | --- |
| `components/layout/ShopHeader.tsx` | Account destination `/account` | User |
| `pages/account/AccountPage.tsx` | Orders destination `/orders` | Package |
| `pages/account/AccountPage.tsx` | Addresses destination `/account/addresses` | MapPin |
| [HowItWorksPage.tsx](../../../apps/web-shop/src/pages/HowItWorksPage.tsx#L119) | Installment terms destination `/installment-terms` from the guide FAQ section | ShieldCheck |
| `pages/account/AccountPage.tsx` | Logout action and loyalty status | LogOut and BadgeCheck |
| `components/layout/ShopHeader.tsx` | Open menu, close menu and search | Menu, X, Search. X is also used to dismiss dialogs and galleries. |
| `components/hero/HomeHero.tsx`, `components/layout/SectionHeader.tsx` | Browse and view all CTAs to `/products` | ArrowRight for the continuation action, at 20 and 16 px respectively |
| `pages/sell/SellLandingPage.tsx`, `components/shop/PromotionsStrip.tsx` | Start quote at `/sell/quote` and continue to `/promotions` | ArrowRight follows the quote CTA, ChevronRight follows a promotion tile. The leading promotion glyph conveys offer type. |
| `components/catalog/Breadcrumb.tsx`, `components/hero/CategoryHero.tsx` | Breadcrumb separator | ChevronRight identifies hierarchy |
| `components/layout/ShopFooter.tsx`, `components/layout/FloatingLineButton.tsx` and page CTAs | External LINE, call and map contact actions and Facebook/TikTok brand links | MessageCircle, Phone, MapPin, FacebookLogo, TiktokLogo |

The header account, orders, addresses and installment terms links have distinct SVG geometry. A duplicate fixture using Package for the address hub fails the rendered test. Repeated occurrences of `/products`, `/sell`, `/promotions` and `/how-it-works` in the desktop header, mobile menu and footer keep their text-only menu presentation. The home wordmark is a brand image within the home link. The footer hours pin accompanies location copy.

These remaining visual action marks were migrated at 16 px. The route target, labels, conditions and handlers retain their existing behavior.

| Shared glyph | Exact source contexts in `apps/web/src` |
| --- | --- |
| ArrowLeft | `pages/liff/LiffNotificationSettings.tsx` profile return, `LiffBranches.tsx` and `LiffReceipts.tsx` contract return. `components/contract/ContractEarlyPayoff.tsx`, `pages/PaymentsPage/components/PaymentModals.tsx`, `RepossessionOverlay.tsx` and `RescheduleOverlay.tsx` back controls. `pages/ChatbotFinanceSessionsPage.tsx` previous-page control. |
| ArrowRight | `pages/liff/LiffNotificationSettings.tsx` view contract. `pages/StoreAppointmentsPage/AppointmentCalendar.tsx` open appointment. `pages/FinanceReceivablePage/FinanceReceivableDetailDrawer.tsx` finance-company link. `pages/canned-response-admin/bubble-editors/LocationBubbleEditor.tsx` map link. `pages/ChatbotFinanceSessionsPage.tsx` next page. `pages/UnifiedInboxPage/components/ConversationList.tsx` expired-room filter. `pages/assets/AssetSummaryReportPage.tsx` all transfers and `AssetDetailPage.tsx` transfer and audit history links. |
| ChevronRight | `pages/UnifiedInboxPage/components/RoomDossier.tsx` sibling-room button and `DossierCards.tsx` view-contract buttons |
| Plus | `pages/BranchesPage.tsx` new branch, `ChartOfAccountsPage.tsx` account, `ChatbotFinanceKnowledgePage.tsx` FAQ, `CollectionsPage/components/ContactLogDialog.tsx` appointment time, `CustomersPage/index.tsx` buyer or prospect, `CustomerDetailPage/tabs/CreditTab.tsx` credit check, `ExpenseFavoritesPage.tsx` recurring bill, `GfinConfigPage/RateFactorsTab.tsx` rate factor, `InterestConfigPage.tsx` rate setting, `interest-config/RateRowsEditor.tsx` installment row, `NotificationsPage/components/TemplateManager.tsx` template |
| Plus | `pages/PaymentsPage/components/RecordPaymentWizard.tsx` memo disclosure, `PricingTemplatesPage.tsx` price template, `PurchaseOrdersPage/index.tsx` purchase, `PurchaseOrdersPage/components/wizard/PaymentSection.tsx` attachment, `RecurringBillsPage/components/MonthHeader.tsx` and `RecurringBillsPage/index.tsx` recurring bill, `StockAlertsPage.tsx` reorder point, `StockCountPage.tsx` stock count, `StockPage/components/PriceManagementModal.tsx` price, `SuppliersPage/components/SupplierForm.tsx` payment method, `UsersPage/index.tsx` user, `UsersPage/UserDetailPage.tsx` HR details and `other-income/OtherIncomeTemplatesPage.tsx` new document |
| Plus | `components/contacts/ContactCombobox.tsx` create contact uses the existing `components/ui/combobox.tsx` icon. The duplicate plus character was removed from the label. |

## Reviewed exceptions

These entries preserve graphics, content or controls owned by the browser or an external service. Links point to the source that renders or defines each exception.

| Surface and state | Exact source and classification |
| --- | --- |
| Storefront `/stock`, loading and iframe | [stock/index.html](../../../apps/web-shop/public/stock/index.html#L82) renders BESTCHOICE’s 56 px logo, loading status, telephone and LINE text links. The Google Apps Script frame owns its content. [firebase.json](../../../firebase.json#L47) provides the storefront hosting context. |
| Admin `/privacy.html` and `/terms.html` | [privacy.html](../../../apps/web/public/privacy.html) and [terms.html](../../../apps/web/public/terms.html) contain public legal text and links. Both have zero SVG/image/button markup. The separate [React privacy page](../../../apps/web/src/pages/PrivacyPolicyPage.tsx) uses the admin adapter for its UI. |
| Historical Flex message visual reference | [design-preview-flex-messages.html](../../../apps/web/public/design-preview-flex-messages.html#L65) keeps inline SVGs and icons in template mockups. |
| Historical LIFF contract visual reference | [design-preview-liff-contract.html](../../../apps/web/public/design-preview-liff-contract.html#L157) keeps the texture SVG, back mark, badges, previews and progress graphics. |
| Historical LIFF payoff visual reference | [design-preview-liff-early-payoff.html](../../../apps/web/public/design-preview-liff-early-payoff.html#L58) keeps its back and state glyphs. |
| Historical LIFF payment history visual reference | [design-preview-liff-history.html](../../../apps/web/public/design-preview-liff-history.html#L56) keeps its back, successful-payment and other mockup glyphs. |
| Historical LIFF profile visual reference | [design-preview-liff-profile.html](../../../apps/web/public/design-preview-liff-profile.html#L56) keeps its back, verification and profile glyphs. |
| Storefront `/products` hero, `/` hero and `/sell/quote` body condition | The 112 px phone drawing in [CatalogPage.tsx](../../../apps/web-shop/src/pages/CatalogPage.tsx#L252), CSS handset silhouette in [phone-showcase.css](../../../apps/web-shop/src/components/hero/phone-showcase.css) and 36 by 50 px damage diagrams in [QuestionStep.tsx](../../../apps/web-shop/src/pages/sell/components/QuestionStep.tsx#L88) illustrate products and phone condition. |
| Product, shop, staff and customer images | [Storefront public media](../../../apps/web-shop/public/media), actual [ProductGallery](../../../apps/web-shop/src/components/catalog/ProductGallery.tsx) and [360-degree image frames](../../../apps/web-shop/src/components/catalog/Product360Viewer.tsx), admin [ProductPhotosPanel](../../../apps/web/src/components/product/ProductPhotosPanel.tsx), and customer-generated or remote [avatar](../../../apps/web/src/lib/avatar.ts) are images. Adjacent gallery and photo controls use system icons. |
| Brand marks | Both [admin](../../../apps/web/index.html) and [storefront](../../../apps/web-shop/index.html) set browser icons. Admin [manifest](../../../apps/web/public/manifest.json), [kiosk manifest](../../../apps/web/public/kiosk/manifest.webmanifest) and storefront [manifest](../../../apps/web-shop/public/site.webmanifest) use install icons. [Admin public logos](../../../apps/web/public), [storefront public logos](../../../apps/web-shop/public), [Sidebar](../../../apps/web/src/components/layout/Sidebar.tsx), [ShopHeader](../../../apps/web-shop/src/components/layout/ShopHeader.tsx), [ShopFooter](../../../apps/web-shop/src/components/layout/ShopFooter.tsx) and [chat notification](../../../apps/web/src/pages/UnifiedInboxPage/components/chat-notification.ts) retain BESTCHOICE identity. |
| Admin social channel identity | [ChannelBadge.tsx](../../../apps/web/src/components/chat/ChannelBadge.tsx#L36) and [ConversationItem.tsx](../../../apps/web/src/pages/UnifiedInboxPage/components/ConversationItem.tsx#L122) render letter/brand-color marks including TikTok’s `♪`. The discussion state and contact action icons use Phosphor. |
| Inbox emoji and media, Flex previews and LINE OA content | [ChatMediaPicker.tsx](../../../apps/web/src/pages/UnifiedInboxPage/components/ChatMediaPicker.tsx#L7) retains selectable Unicode emoji, their category samples and LINE sticker images. [ConversationItem.tsx](../../../apps/web/src/pages/UnifiedInboxPage/components/ConversationItem.tsx#L22) retains Flex message previews. [LineGreetingPage.tsx](../../../apps/web/src/pages/LineGreetingPage.tsx), [line-flex.ts](../../../apps/web/src/lib/line-flex.ts) and [RichMenuPage.tsx](../../../apps/web/src/pages/RichMenuPage.tsx) retain greeting/template/preview content and rich-menu graphics. [AppointmentAlertBar.tsx](../../../apps/web/src/pages/UnifiedInboxPage/components/AppointmentAlertBar.tsx#L101) uses a bell in the browser tab title, where React SVG cannot render. |
| App notices and punctuation | [ReversePermissionCard.tsx](../../../apps/web/src/pages/SettingsPage/components/ReversePermissionCard.tsx#L107) quotes the existing control name in explanatory prose. [ReverseConfirmDialog.tsx](../../../apps/web/src/components/accounting/ReverseConfirmDialog.tsx#L62) retains `Dr↔Cr` notation. [DeviceOriginStep.tsx](../../../apps/web-shop/src/pages/sell/components/DeviceOriginStep.tsx#L42) retains the iOS path instructions. [CatalogPage.tsx](../../../apps/web-shop/src/pages/CatalogPage.tsx#L55) and [SortDropdown.tsx](../../../apps/web-shop/src/components/catalog/SortDropdown.tsx#L10) retain text that describes sort order. [Bookings detail help](../../../apps/web/src/pages/BookingsPage/components/BookingDetailSheet.tsx#L410) quotes a menu symbol. |
| Accounting and process notation | [EquityStatementPage](../../../apps/web/src/pages/EquityStatementPage.tsx#L235) retains plus and minus column captions for arithmetic. [PaymentKpiCards](../../../apps/web/src/pages/PaymentsPage/components/PaymentKpiCards.tsx#L48) retains arrows that identify journal destinations. [ChatbotFinanceLearningPage](../../../apps/web/src/pages/ChatbotFinanceLearningPage.tsx#L260) uses an arrow between approval and the resulting knowledge-base creation in the action text. [ShortcutsHelpOverlay](../../../apps/web/src/components/ShortcutsHelpOverlay.tsx#L55) uses a plus between keyboard keys. |
| Keyboard and native-option labels | [CommandPalette.tsx](../../../apps/web/src/components/CommandPalette.tsx#L378), [KeyboardShortcutsOverlay.tsx](../../../apps/web/src/pages/CollectionsPage/components/KeyboardShortcutsOverlay.tsx#L41) and [CatalogPicker.tsx](../../../apps/web/src/pages/PurchaseOrdersPage/components/wizard/items/CatalogPicker.tsx#L212) retain arrow-key labels. [FinanceContactLogDialog.tsx](../../../apps/web/src/pages/FinanceReceivablePage/FinanceContactLogDialog.tsx#L88) retains the primary-contact star within a native option. [TemplateForm.tsx](../../../apps/web/src/pages/NotificationsPage/components/TemplateForm.tsx#L564) uses `&#10;` as a placeholder newline. |
| CSS decorations | [ScreenTable mobile labels](../../../apps/web/src/components/ui/screen-table.css#L71) use generated text and a select-all label. [Inbox mobile nav underline](../../../apps/web/src/pages/UnifiedInboxPage/inbox-workspace.css#L141) and [header active underline](../../../apps/web-shop/src/components/layout/ShopHeader.tsx#L104) are selection indicators. [ConversationItem.tsx](../../../apps/web/src/pages/UnifiedInboxPage/components/ConversationItem.tsx#L45) pairs CSS status dots with state names. [Switch](../../../apps/web/src/components/ui/switch.tsx) uses a CSS thumb. [App CSS](../../../apps/web/src/index.css#L570) generates the Tiptap placeholder. The production CSS scan found no image-backed icon or glyph-generating rule. The app markup also contains the specific loading graphics listed below. |
| Charts and progress | [SystemStatusPage](../../../apps/web/src/pages/SystemStatusPage.tsx#L169) draws service connection paths. [LiffContract](../../../apps/web/src/pages/liff/LiffContract.tsx#L458) and [RingProgress](../../../apps/web/src/components/ui/progress.tsx#L56) draw data-driven rings. [DashboardCharts](../../../apps/web/src/pages/DashboardPage/components/DashboardCharts.tsx) and the shared [chart wrapper](../../../apps/web/src/components/ui/chart.tsx) preserve Recharts rendering and legends. |
| QR, signed record and printed document graphics | [MobileReceipt](../../../apps/web/src/components/payment/MobileReceipt.tsx), [PaymentVoucherPage](../../../apps/web/src/pages/PaymentVoucherPage.tsx), [StickerCard](../../../apps/web/src/pages/StickerPrintPage/StickerCard.tsx), [ParcelLabelCard](../../../apps/web/src/pages/ParcelLabelPage/ParcelLabelCard.tsx) and [LineLinkInvite](../../../apps/web/src/components/customer/LineLinkInvite.tsx) encode data in QR symbols. [SignaturePadFull](../../../apps/web/src/components/signing/SignaturePadFull.tsx), [IdCardCapture](../../../apps/web/src/components/signing/IdCardCapture.tsx), [SignatureBlock](../../../apps/web/src/components/template-editor/preview/SignatureBlock.tsx) and [templateStore](../../../apps/web/src/store/templateStore.ts) preserve signature/capture canvases and document mark-up. |
| Browser and external UI | The admin and storefront [native select](../../../apps/web/src/components/ui/native-select.tsx) and [storefront native select](../../../apps/web-shop/src/components/ui/native-select.tsx) use an app caret and browser option picker. Search clear, date/time calendar, file chooser and native checkbox/radio controls belong to the browser, including [ShopHeader search](../../../apps/web-shop/src/components/layout/ShopHeader.tsx#L156), [DateRangeField](../../../apps/web/src/components/ui/DateRangeField.tsx) and [DataTable](../../../apps/web/src/components/ui/DataTable.tsx). [PdfPreview](../../../apps/web/src/components/PdfPreview.tsx), [CreditNoteViewPage](../../../apps/web/src/pages/CreditNoteViewPage.tsx), [SaleReceiptViewPage](../../../apps/web/src/pages/SaleReceiptViewPage.tsx) and [PDFExportModal](../../../apps/web/src/components/template-editor/pdf/PDFExportModal.tsx) embed browser PDF rendering. [VoiceMemoPlayback](../../../apps/web/src/pages/CollectionsPage/components/VoiceMemoPlayback.tsx#L92) and [VideoBubbleEditor](../../../apps/web/src/pages/canned-response-admin/bubble-editors/VideoBubbleEditor.tsx#L22) use native media controls. [HomePage](../../../apps/web-shop/src/pages/HomePage.tsx#L281) embeds the external store map. |
| Signed counts and linked record identifiers | The [storefront photo count](../../../apps/web-shop/src/components/catalog/ProductCard.tsx#L253) displays `+{overflow}` with a link named for all photos. The [command-palette tracking result](../../../apps/web/src/components/CommandPalette.tsx#L328) uses `→` between the tracking number and its linked contract number. [Loyalty history](../../../apps/web/src/pages/CustomerDetailPage/tabs/LoyaltyTab.tsx) retains `+` and `-` on numeric point amounts. |
| List bullets and missing data | [CreditCheckCard](../../../apps/web/src/components/credit-check/CreditCheckCard.tsx#L193) uses generated bullets for the positive and risk factor lists below their headings. LIFF customer initials, customer avatars and inbox participant avatars retain `?` when a name is missing. |

The [machine exception manifest](../../../tools/icon-exceptions.json) records current candidates by exact source path, kind and normalized syntax, with one reason per entry. The historical previews use a separate SHA-256 entry for each file. The scanner checks static module imports in both app source trees and the icon package, and reviews UI candidates in app source, first-party HTML and CSS and PWA icon manifests. Generated `dist`, dependencies and coverage output are excluded. Test fixtures are scanned for forbidden imports, while their rendered examples are excluded from the production candidate baseline. Runtime customer media, remote frames and generated graphics remain covered by the source inventory where their rendered pixels are unavailable to a static check.

### CSS indeterminate progress rings

The entries below identify rotating progress graphics drawn as partial CSS borders or gradients. Active sites indicate loading, a pending operation or a missing-data fallback. The list also records an unused reports helper found in source. The existing motion, size and accessible status treatment are preserved.

| Surface | Exact loading graphic and render condition |
| --- | --- |
| Admin route and session | [App.tsx:256](../../../apps/web/src/App.tsx#L256) renders the 32 px Suspense fallback while a route chunk loads. [App.tsx:271](../../../apps/web/src/App.tsx#L271) renders the 32 px app-wide authentication loader before route rendering while `useAuth().isLoading` is true. [ProtectedRoute.tsx:19](../../../apps/web/src/components/ProtectedRoute.tsx#L19) renders the 32 px auth loader with a named status. |
| Public and customer document routes | [RegisterInvitePage.tsx:92](../../../apps/web/src/pages/RegisterInvitePage.tsx#L92) renders a 32 px invite-link validation loader. [CustomerPortalPage.tsx:76](../../../apps/web/src/pages/CustomerPortalPage.tsx#L76) renders a 40 px portal data loader. [ContractVerifyPage.tsx:55](../../../apps/web/src/pages/ContractVerifyPage.tsx#L55) and [ReceiptVerifyPage.tsx:33](../../../apps/web/src/pages/ReceiptVerifyPage.tsx#L33) render 32 px and 48 px verification loaders respectively. |
| Contract signing | [ContractSignPage.tsx:58](../../../apps/web/src/pages/ContractSignPage.tsx#L58) renders the 32 px contract load. [StepContractReview.tsx:37](../../../apps/web/src/components/signing/StepContractReview.tsx#L37) indicates document preview loading at 32 px in a status region with loading text. [StepSignature.tsx:221](../../../apps/web/src/components/signing/StepSignature.tsx#L221) waits for auto-sign at 32 px and [StepSignature.tsx:307](../../../apps/web/src/components/signing/StepSignature.tsx#L307) indicates a GPS request at 12 px. [StepComplete.tsx:92](../../../apps/web/src/components/signing/StepComplete.tsx#L92) uses a 20 px ring in the PDF generation status. |
| Report, stock and payment data | [ReportsPage.tsx:674](../../../apps/web/src/pages/ReportsPage.tsx#L674) defines a 32 px ring in an unused local `LoadingState` helper. Report panels use `QueryBoundary` for data loading. [StockDashboardTab.tsx:74](../../../apps/web/src/pages/StockPage/components/StockDashboardTab.tsx#L74) renders a 28 px fallback while dashboard data is absent. The overview can also show the dashboard query error. [PaymentHistorySheet.tsx:275](../../../apps/web/src/components/payment/PaymentHistorySheet.tsx#L275), [PaymentTable.tsx:217](../../../apps/web/src/pages/PaymentsPage/components/PaymentTable.tsx#L217), and [PaymentSummary.tsx:254](../../../apps/web/src/pages/PaymentsPage/components/PaymentSummary.tsx#L254) render 32 px loaders while history, pending payments or payment totals load respectively. |
| Customer and contract operations | Customer creation uses 16 px rings while [reading the smart card](../../../apps/web/src/components/customer/CustomerCreateDialog.tsx#L716), [reading the ID scan](../../../apps/web/src/components/customer/CustomerCreateDialog.tsx#L741) and [saving the form](../../../apps/web/src/components/customer/CustomerCreateDialog.tsx#L1434). [CustomerCreateModal.tsx:145](../../../apps/web/src/pages/ContractCreatePage/components/CustomerCreateModal.tsx#L145) renders a 20 px smart-card loader in contract creation. [CustomerEditModal.tsx:275](../../../apps/web/src/components/contract/CustomerEditModal.tsx#L275) renders a 32 px loader fetching customer data. [CreditCheckPanel.tsx:194](../../../apps/web/src/components/contract/CreditCheckPanel.tsx#L194) presents 16 px upload progress. |
| Credit check modal | [CreditCheckCreateModal.tsx:271](../../../apps/web/src/components/credit-check/CreditCheckCreateModal.tsx#L271) and [CreditCheckCreateModal.tsx:385](../../../apps/web/src/components/credit-check/CreditCheckCreateModal.tsx#L385) render 12 px salary-slip and bank-statement analysis progress. [CreditCheckCreateModal.tsx:523](../../../apps/web/src/components/credit-check/CreditCheckCreateModal.tsx#L523) renders 16 px pending risk calculation. |
| POS search and submit | [CustomerSearch.tsx:161](../../../apps/web/src/pages/POSPage/components/CustomerSearch.tsx#L161) and [ProductSearch.tsx:245](../../../apps/web/src/pages/POSPage/components/ProductSearch.tsx#L245) show 20 px search progress while fetching. Product search also shows it while the query is debouncing. [SaleSummary.tsx:250](../../../apps/web/src/pages/POSPage/components/SaleSummary.tsx#L250) renders a 16 px ring while the sale is saving. |
| Payment slip reads | [PaymentsPage/index.tsx:726](../../../apps/web/src/pages/PaymentsPage/index.tsx#L726) renders 16 px quick slip scan progress. [PaymentModals.tsx:60](../../../apps/web/src/pages/PaymentsPage/components/PaymentModals.tsx#L60) renders 12 px progress while reading a slip. |
| LIFF early payoff | [LiffEarlyPayoff.tsx:260](../../../apps/web/src/pages/liff/LiffEarlyPayoff.tsx#L260) rotates a 64 px conic-gradient ring around the existing shared Sparkles glyph while creating the payoff payment link. |

## Route and state verification

Source coverage is route-wide. The inspected production surface includes the 225 named admin route declarations, one index route and one pathless protected wrapper in [admin App.tsx](../../../apps/web/src/App.tsx), all settings registry items in [settings-registry.tsx](../../../apps/web/src/config/settings-registry.tsx), 38 named storefront declarations including redirect aliases and fallback in [storefront App.tsx](../../../apps/web-shop/src/App.tsx), and both apps' public HTML and shared components. The source audit searched imports and re-exports, inline SVG, static assets and image references, CSS-generated content and image glyphs, Unicode and HTML entities and standalone punctuation used as UI. Source classification is independent of which fixture states were exercised.

| Route or surface | Verified state | Evidence and environment |
| --- | --- | --- |
| Storefront `/` | Desktop account link, social icons, hero browse and featured view-all arrows. At 390 px, menu open/close, text-only links and search submission. | Task 4 Chromium at 1280 and 390 px with synthetic product/promotion responses. |
| Storefront `/products` | Desktop and mobile device/search filters, selector, filter reset and query preservation. Mobile search landing, catalogue phone illustration in DOM, filter close. | Task 2 storefront Playwright fixtures and Task 4 Chromium with synthetic data. |
| Storefront `/products/icons-fixture` and `/products/phone-1` | Populated gallery, slide navigation, thumbnail state, expandable gallery, zoom and dismiss, share payload and device-origin label. | Task 2 Chromium and Playwright with synthetic product/media data and simulated native share. |
| Storefront `/account`, `/account/addresses`, `/login?returnTo=/account` | Authenticated account hubs, address dialog open and close, logout and redirect. | Task 2 Chromium with synthetic session and address data. Task 4 rendered geometry comparison includes the header account link. |
| Storefront `/how-it-works` | FAQ-section link to `/installment-terms` with a decorative ShieldCheck. | Task 4 rendered page and link geometry in a memory router after going through the header link. |
| Storefront `/sell/quote` | Model selection and transition, reduced motion, selection feedback, 390 px cash assessment without issues. | Task 2 Playwright with synthetic responses. |
| Storefront `/stock/index.html` | Static wrapper status, loading logo, phone and LINE links, correct iframe height/width after a synthetic frame loads. | Task 4 Chromium served the checked-in HTML directly. The canonical `/stock` hosting route was reviewed in source. Google Apps Script traffic was intercepted. |
| Admin `/privacy.html`, `/terms.html` | Local HTTP 200, visible policy/terms headings, zero SVG/image/buttons. | Task 4 Chromium on the actual static assets. |
| Admin `/migration` | Empty result and 36 px illustration. | Task 4 Chromium with owner identity and migration status fixtures. |
| Admin `/liff/notifications` | Mobile preference list, successful and failed save, toast announcement and dismissal, contract and profile links. | Task 3 and 4 Chromium at 390 px with synthetic LINE identity and API reads/writes. |
| Admin `/liff/branches`, `/liff/receipts` | Empty branch list, branch-load failure, populated receipts, contract return links. | Task 4 Chromium at 390 px using synthetic records and error response. |
| Admin `/liff/finance-verify` | Already-linked state and return-to-chat label. | Task 3 Chromium at 390 px with synthetic LINE and API responses. |
| Admin `/contracts/fixture/sign` | Existing KYC and PDPA, sign step, completed step names, signed company signer chip and confirmation, test-mode banner. | Task 3 Chromium at 390 px with synthetic session, signatures and agreement data. Signed completion and OTP entry are covered in source separately. |
| Admin work navigation and `/settings/accounting` | Six roles across registered SHOP, FINANCE and settings. Rendered owner SHOP and FINANCE leaves and groups, settings category SVGs and current category. | Task 4 Vitest with in-memory routing and role/session fixtures. |
| Admin payment and contract overlays | Repossession confirmation back action and posted receipt indicator. | Task 4 Vitest in rendered components with fixtures. |
| App-level status, application and library controls | Both Sonner wrappers' six glyph slots. Admin component states include reversal impact, signing/consent, channel warning, appointment outcome, inspection, chat-picker selection, auto-reply and national ID validation. Storefront component states include native-select caret, busy buttons, gallery controls and empty/error results. | Tasks 2–4 Vitest, component fixtures. |

No post-migration browser check in this inventory used a real API. The prior managed preview run at the baseline revision predates the workspace changes. The final managed real-API run is tracked separately.

The storefront routes without browser coverage include `/how-it-works`, `/shipping`, `/returns`, `/about`, `/contact`, `/promotions`, `/installment-terms`, `/orders`, `/orders/:orderNumber`, direct login and callback error, all three Thai landing pages, `/sell`, `/sell/:id`, redirect aliases and the unmatched-route screen. Storefront component and redirect tests cover some of these paths without browser execution. Catalogue and product source states also include populated 360-degree frames, no-photo and load-failure branches, and out-of-stock and financing choices beyond the browser rows. On admin, routes and alternate states outside the browser rows retain source and existing test evidence only. Examples include the five historical previews, public document views, the React privacy page, LIFF error variants other than the verified branches case, signing OTP and all-signed completion, chart-data and QR/print states. A successful render of a shared component gives evidence for the named route and state where it was exercised.
