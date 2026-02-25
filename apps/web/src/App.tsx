import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';
import MainLayout from '@/components/layout/MainLayout';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';
import BranchesPage from '@/pages/BranchesPage';
import SuppliersPage from '@/pages/SuppliersPage';
import SupplierDetailPage from '@/pages/SupplierDetailPage';
import ProductsPage from '@/pages/ProductsPage';
import ProductCreatePage from '@/pages/ProductCreatePage';
import ProductDetailPage from '@/pages/ProductDetailPage';
import StockPage from '@/pages/StockPage';
import InspectionPage from '@/pages/InspectionPage';
import InspectionDetailPage from '@/pages/InspectionDetailPage';
import StickerPrintPage from '@/pages/StickerPrintPage';
import CustomersPage from '@/pages/CustomersPage';
import CustomerDetailPage from '@/pages/CustomerDetailPage';
import ContractsPage from '@/pages/ContractsPage';
import ContractCreatePage from '@/pages/ContractCreatePage';
import ContractDetailPage from '@/pages/ContractDetailPage';

function App() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />}
      />
      <Route
        element={
          <ProtectedRoute>
            <MainLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route
          path="/branches"
          element={
            <ProtectedRoute roles={['OWNER']}>
              <BranchesPage />
            </ProtectedRoute>
          }
        />
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/suppliers/:id" element={<SupplierDetailPage />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/products/create" element={<ProductCreatePage />} />
        <Route path="/products/:id" element={<ProductDetailPage />} />
        <Route path="/stock" element={<StockPage />} />
        <Route path="/inspections" element={<InspectionPage />} />
        <Route path="/inspections/:id" element={<InspectionDetailPage />} />
        <Route path="/stickers" element={<StickerPrintPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/customers/:id" element={<CustomerDetailPage />} />
        <Route path="/contracts" element={<ContractsPage />} />
        <Route path="/contracts/create" element={<ContractCreatePage />} />
        <Route path="/contracts/:id" element={<ContractDetailPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
