import { useEffect } from 'react';
import { Routes, Route, useLocation, useParams, Navigate } from 'react-router';
import { trackPageView } from './lib/tracking';
import { ScrollToTop } from './components/ScrollToTop';
import HomePage from './pages/HomePage';
import CatalogPage from './pages/CatalogPage';
import ProductDetailPage from './pages/ProductDetailPage';
import CartPage from './pages/CartPage';
import CheckoutPage from './pages/CheckoutPage';
import HowItWorksPage from './pages/HowItWorksPage';
import ShippingPage from './pages/ShippingPage';
import ReturnsPage from './pages/ReturnsPage';
import AboutPage from './pages/AboutPage';
import ContactPage from './pages/ContactPage';
import OrderSuccessPage from './pages/OrderSuccessPage';
import OrdersPage from './pages/OrdersPage';
import OrderDetailPage from './pages/OrderDetailPage';
import AccountPage from './pages/account/AccountPage';
import AddressBookPage from './pages/account/AddressBookPage';
import InstallmentApplyPage from './pages/apply/InstallmentApplyPage';
import ApplySuccessPage from './pages/apply/ApplySuccessPage';
import ApplyStatusPage from './pages/apply/ApplyStatusPage';
import PromotionsPage from './pages/PromotionsPage';
import InstallmentTermsPage from './pages/InstallmentTermsPage';
import SellLandingPage from './pages/sell/SellLandingPage';
import SellQuotePage from './pages/sell/SellQuotePage';
import SellStatusPage from './pages/sell/SellStatusPage';
import SavingPlanLandingPage from './pages/saving-plan/SavingPlanLandingPage';
import SavingPlanCreatePage from './pages/saving-plan/SavingPlanCreatePage';
import SavingPlanDetailPage from './pages/saving-plan/SavingPlanDetailPage';
import SavingPlansPage from './pages/account/SavingPlansPage';
import LoginPage from './pages/auth/LoginPage';
import LineCallbackPage from './pages/auth/LineCallbackPage';
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
        <Route path="/cart" element={<CartPage />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/how-it-works" element={<HowItWorksPage />} />
        <Route path="/shipping" element={<ShippingPage />} />
        <Route path="/returns" element={<ReturnsPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/checkout/success/:orderNumber" element={<OrderSuccessPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/orders/:orderNumber" element={<OrderDetailPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/account/addresses" element={<AddressBookPage />} />
        <Route path="/promotions" element={<PromotionsPage />} />
        <Route path="/installment-terms" element={<InstallmentTermsPage />} />
        <Route path="/apply/status" element={<ApplyStatusPage />} />
        <Route path="/apply/:productId" element={<InstallmentApplyPage />} />
        <Route path="/apply/success/:applicationNumber" element={<ApplySuccessPage />} />
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
        <Route path="/saving-plan" element={<SavingPlanLandingPage />} />
        <Route path="/saving-plan/create" element={<SavingPlanCreatePage />} />
        <Route path="/saving-plan/:id" element={<SavingPlanDetailPage />} />
        <Route path="/account/saving-plans" element={<SavingPlansPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/line-callback" element={<LineCallbackPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}
