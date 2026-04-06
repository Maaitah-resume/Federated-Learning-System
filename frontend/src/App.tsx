import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import TrainingControl from './pages/TrainingControl';
import Training from './pages/Training';
import Queue from './pages/Queue';
import Models from './pages/Models';
import Login from './pages/Login';

function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

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
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<ProtectedLayout><Dashboard /></ProtectedLayout>} />
      <Route path="/control" element={<ProtectedLayout><TrainingControl /></ProtectedLayout>} />
      <Route path="/training" element={<ProtectedLayout><Training /></ProtectedLayout>} />
      <Route path="/queue" element={<ProtectedLayout><Queue /></ProtectedLayout>} />
      <Route path="/models" element={<ProtectedLayout><Models /></ProtectedLayout>} />
      <Route path="/settings" element={<ProtectedLayout><div className="p-10 text-slate-400">Settings page coming soon...</div></ProtectedLayout>} />
      <Route path="*" element={<Navigate to="/" replace />} />
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
