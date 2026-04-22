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
      </Routes>
    </>
  );
}
