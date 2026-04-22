import { useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router';
import { trackPageView } from './lib/tracking';
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
import TradeInLandingPage from './pages/trade-in/TradeInLandingPage';
import TradeInSubmitPage from './pages/trade-in/TradeInSubmitPage';
import TradeInStatusPage from './pages/trade-in/TradeInStatusPage';
import SavingPlanLandingPage from './pages/saving-plan/SavingPlanLandingPage';
import SavingPlanCreatePage from './pages/saving-plan/SavingPlanCreatePage';
import SavingPlanDetailPage from './pages/saving-plan/SavingPlanDetailPage';
import SavingPlansPage from './pages/account/SavingPlansPage';

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
        <Route path="/apply/:productId" element={<InstallmentApplyPage />} />
        <Route path="/apply/success/:applicationNumber" element={<ApplySuccessPage />} />
        <Route path="/trade-in" element={<TradeInLandingPage />} />
        <Route path="/trade-in/submit" element={<TradeInSubmitPage />} />
        <Route path="/trade-in/:id" element={<TradeInStatusPage />} />
        <Route path="/saving-plan" element={<SavingPlanLandingPage />} />
        <Route path="/saving-plan/create" element={<SavingPlanCreatePage />} />
        <Route path="/saving-plan/:id" element={<SavingPlanDetailPage />} />
        <Route path="/account/saving-plans" element={<SavingPlansPage />} />
      </Routes>
    </>
  );
}
