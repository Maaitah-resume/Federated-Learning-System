import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import TrainingControl from './pages/TrainingControl';
import Training from './pages/Training';
import Queue from './pages/Queue';
import Models from './pages/Models';

// No login required - direct access to all pages
function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-slate-50 font-sans text-slate-900">
      <Sidebar />
      <main className="flex-1 p-10 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/"         element={<Layout><Dashboard /></Layout>} />
      <Route path="/control"  element={<Layout><TrainingControl /></Layout>} />
      <Route path="/training" element={<Layout><Training /></Layout>} />
      <Route path="/queue"    element={<Layout><Queue /></Layout>} />
      <Route path="/models"   element={<Layout><Models /></Layout>} />
      <Route path="/settings" element={<Layout><div className="p-10 text-slate-400">Settings page coming soon...</div></Layout>} />
      <Route path="*"         element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <SocketProvider>
        <Router>
          <AppRoutes />
        </Router>
      </SocketProvider>
    </AuthProvider>
  );
}
