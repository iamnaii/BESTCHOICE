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

Source inspection confirmed the 48 planned files and 61 imported names, including the `LucideIcon` type and one button story. Every row is pending storefront migration. Route ownership comes from `apps/web-shop/src/App.tsx`, page imports and component usage. The state column identifies representative source contexts for later runtime checks.

Use the identically named shared semantic export where it exists. The approved additions and replacements are below.

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
| `apps/web-shop/src/pages/HowItWorksPage.tsx` | `MessageCircle`, `CreditCard`, `PartyPopper`, `ShieldCheck`, `type LucideIcon` | control, decoration, type | `/how-it-works` · Purchase steps, trust and LINE contact |
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

## Additional baseline candidates

These entries are the initial source findings for the admin, static UI and library audit.

| File | Symbol or context | Category | Route and state | Baseline disposition |
| --- | --- | --- | --- | --- |
| `apps/web/src/components/layout/TestModeBanner.tsx` | Warning emoji | Status | Admin layout with test mode enabled | Pending shared warning glyph |
| `apps/web/src/pages/TradeInPage/components/ValuationsTab.tsx` | Pricing guidance warning emoji | Status | `/trade-in`, valuations tab | Pending shared warning glyph |
| `apps/web/src/pages/ExpenseDetailPage.tsx` | Draft, approval and accrual badge emoji | Status | `/expenses/:id` and `/expenses/verify/:id` | Pending shared document, wait and ledger glyphs |
| `apps/web/src/pages/canned-response-admin/QuickReplyEditor.tsx` | Channel behavior warning emoji in editor help | Status | `/canned-responses`, quick reply editor | Pending shared warning glyph |
| `apps/web/src/components/accounting/ReverseConfirmDialog.tsx` | Impact warning in reversal confirmation | Status | `/expenses` and `/assets/:id`, reversal confirmation | Pending shared warning glyph |
| `apps/web/src/pages/liff/LiffNotificationSettings.tsx` | Category emoji and navigation arrows | Status, navigation | `/liff/notifications`, preference rows and return links | Pending shared preference and directional glyphs |
| `apps/web/src/pages/UnifiedInboxPage/components/ChatMediaPicker.tsx` | Emoji and sticker tab glyphs | Control | `/inbox/:roomId?`, open media picker | Pending review of display glyphs. The GIF tab is text-only |
| `apps/web/src/pages/UnifiedInboxPage/components/ChatMediaPicker.tsx` | Selectable emoji, category samples and LINE sticker images | Message content | `/inbox/:roomId?`, media selection | Preserve emoji and sticker content choices |
| `apps/web/src/components/ui/sonner.tsx` | Sonner default toast glyphs | Status, control | Shared admin toast variants and close | Pending configuration of the six icon slots |
| `apps/web-shop/src/main.tsx` | Sonner default toast glyphs | Status, control | Shared storefront toast variants and close | Pending configuration of the six icon slots |
| `apps/web/src/pages/SystemStatusPage.tsx` | Connection diagram SVG paths | Data graphic | `/system-status`, loaded health diagram | Preserve service connectivity and health colors |
| `apps/web/src/pages/liff/LiffContract.tsx` | Payment progress SVG ring | Data graphic | `/liff/contract`, contract loaded | Preserve data-driven ring geometry |
| `apps/web/src/components/ui/progress.tsx` | Progress ring SVG circles | Data graphic | Shared progress component | Preserve value-driven progress geometry |
| `apps/web-shop/src/pages/CatalogPage.tsx` | 112 px phone drawing in catalogue hero | Product illustration | `/products`, hero at small breakpoints and up | Preserve original artwork |
| `apps/web-shop/public/stock/index.html` | `/logo-icon.svg` over external iframe during loading | Brand, external boundary | `/stock`, wrapper loading and iframe load | Preserve BESTCHOICE logo. Runtime-check first-party wrapper. Google Apps Script iframe UI is externally owned |
| `apps/web/public/privacy.html` | Static privacy policy | Legal content | `/privacy.html` | Source has no SVG, image or button markup. Preserve legal copy |
| `apps/web/public/terms.html` | Static terms of service | Legal content | `/terms.html` | Source has no SVG, image or button markup. Preserve legal copy |
| `apps/web/public/design-preview-flex-messages.html` | Flex message template mockups | Historical reference | Static design preview | Preserve mockup glyphs for visual reference |
| `apps/web/public/design-preview-liff-contract.html` | Contract screen mockup | Historical reference | Static design preview | Preserve mockup glyphs for visual reference |
| `apps/web/public/design-preview-liff-early-payoff.html` | Early payoff screen mockup | Historical reference | Static design preview | Preserve mockup glyphs for visual reference |
| `apps/web/public/design-preview-liff-history.html` | Payment history screen mockup | Historical reference | Static design preview | Preserve mockup glyphs for visual reference |
| `apps/web/public/design-preview-liff-profile.html` | Profile screen mockup | Historical reference | Static design preview | Preserve mockup glyphs for visual reference |

The storefront uses 48 px illustrations for errors, not-found routes, empty catalogue results, empty promotion lists and empty order history. The product gallery uses a 40 px fallback illustration when there are no photos. These sizes give standalone states a visual anchor. Application browser coverage, CSS and image icon classification, and final migration status remain open in this baseline.
