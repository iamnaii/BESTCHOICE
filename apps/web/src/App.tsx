import { Routes, Route } from 'react-router-dom';

function HomePage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">
          ระบบผ่อนชำระ
        </h1>
        <p className="text-lg text-gray-600 mb-2">Best Choice Mobile</p>
        <p className="text-sm text-gray-400">v1.0.0 — Phase 1: Foundation</p>
        <div className="mt-8 p-4 bg-green-50 rounded-lg border border-green-200">
          <p className="text-green-700 font-medium">
            ระบบพร้อมใช้งาน
          </p>
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
    </Routes>
  );
}

export default App;
