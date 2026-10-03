import { useEffect } from 'react';
import { Routes, Route, useLocation, useParams, Navigate } from 'react-router';
import { trackPageView } from './lib/tracking';
import { ScrollToTop } from './components/ScrollToTop';
import HomePage from './pages/HomePage';
import CatalogPage from './pages/CatalogPage';
import ProductDetailPage from './pages/ProductDetailPage';
import HowItWorksPage from './pages/HowItWorksPage';
import ShippingPage from './pages/ShippingPage';
import ReturnsPage from './pages/ReturnsPage';
import AboutPage from './pages/AboutPage';
import ContactPage from './pages/ContactPage';
import OrdersPage from './pages/OrdersPage';
import OrderDetailPage from './pages/OrderDetailPage';
import AccountPage from './pages/account/AccountPage';
import AddressBookPage from './pages/account/AddressBookPage';
import PromotionsPage from './pages/PromotionsPage';
import InstallmentTermsPage from './pages/InstallmentTermsPage';
import SellLandingPage from './pages/sell/SellLandingPage';
import SellQuotePage from './pages/sell/SellQuotePage';
import SellStatusPage from './pages/sell/SellStatusPage';
import LoginPage from './pages/auth/LoginPage';
import LineCallbackPage from './pages/auth/LineCallbackPage';
import InstallmentLopburiPage from './pages/landing/InstallmentLopburiPage';
import UsedIphoneLopburiPage from './pages/landing/UsedIphoneLopburiPage';
import NoCreditCardPage from './pages/landing/NoCreditCardPage';
import NotFoundPage from './pages/NotFoundPage';

function RedirectPreserveSearch({ to }: { to: string }) {
  const location = useLocation();
  return <Navigate to={{ pathname: to, search: location.search }} replace />;
}

function RedirectWithId({ base }: { base: string }) {
  const { id } = useParams();
  const location = useLocation();
  return <Navigate to={{ pathname: `${base}/${id ?? ''}`, search: location.search }} replace />;
}

function RouteTracker() {
  const location = useLocation();
  useEffect(() => {
    trackPageView(location.pathname);
  }, [location.pathname]);
  return null;
}

export default function App() {
  return (
    <>
      <RouteTracker />
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/products" element={<CatalogPage />} />
        <Route path="/products/:id" element={<ProductDetailPage />} />
        <Route path="/how-it-works" element={<HowItWorksPage />} />
        <Route path="/shipping" element={<ShippingPage />} />
        <Route path="/returns" element={<ReturnsPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/orders/:orderNumber" element={<OrderDetailPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/account/addresses" element={<AddressBookPage />} />
        <Route path="/promotions" element={<PromotionsPage />} />
        <Route path="/installment-terms" element={<InstallmentTermsPage />} />
        <Route path="/sell" element={<SellLandingPage />} />
        <Route path="/sell/quote" element={<SellQuotePage />} />
        <Route path="/sell/:id" element={<SellStatusPage />} />
        {/* ลิงก์เก่าทุกเส้น (LINE/โฆษณา/bookmark) — ส่งต่อ query string (utm) ด้วย */}
        <Route path="/buyback" element={<RedirectPreserveSearch to="/sell" />} />
        <Route path="/buyback/quote" element={<RedirectPreserveSearch to="/sell/quote" />} />
        <Route path="/buyback/submit" element={<RedirectPreserveSearch to="/sell/quote" />} />
        <Route path="/buyback/:id" element={<RedirectWithId base="/sell" />} />
        <Route path="/trade-in" element={<RedirectPreserveSearch to="/sell" />} />
        <Route path="/trade-in/submit" element={<RedirectPreserveSearch to="/sell/quote" />} />
        <Route path="/trade-in/:id" element={<RedirectWithId base="/sell" />} />
        {/* ร้านขายผ่านแชท/โทรเท่านั้น (คำสั่งเจ้าของ 2026-08-31) — ตะกร้า ชำระเงิน สมัครผ่อน และ
            ออมดาวน์ ถูกถอดแล้ว ลิงก์เก่าพาไปหน้าที่ยังใช้ได้แทนหน้า "ไม่พบหน้านี้"
            `/apply/status` กับ `/apply/success/*` ต้องประกาศแยก ไม่งั้นจะตกไปที่ `/apply/:id`
            แล้วกลายเป็น /products/status */}
        <Route path="/cart" element={<RedirectPreserveSearch to="/products" />} />
        <Route path="/checkout/*" element={<RedirectPreserveSearch to="/products" />} />
        <Route path="/apply" element={<RedirectPreserveSearch to="/how-it-works" />} />
        <Route path="/apply/status" element={<RedirectPreserveSearch to="/how-it-works" />} />
        <Route path="/apply/success/*" element={<RedirectPreserveSearch to="/how-it-works" />} />
        <Route path="/apply/:id" element={<RedirectWithId base="/products" />} />
        <Route path="/saving-plan/*" element={<RedirectPreserveSearch to="/how-it-works" />} />
        <Route path="/account/saving-plans" element={<RedirectPreserveSearch to="/account" />} />
        {/* Landing เจาะคำค้นท้องถิ่น (SEO/AI) — เพิ่ม route ที่นี่ต้องอัป sitemap.xml,
            prerender ROUTES และ llms.txt คู่กันเสมอ */}
        <Route path="/ผ่อนไอโฟนลพบุรี" element={<InstallmentLopburiPage />} />
        <Route path="/iphone-มือสอง-ลพบุรี" element={<UsedIphoneLopburiPage />} />
        <Route path="/ผ่อนมือถือไม่ใช้บัตรเครดิต" element={<NoCreditCardPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/line-callback" element={<LineCallbackPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}
