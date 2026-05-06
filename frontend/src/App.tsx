import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import { QueueProvider } from './context/QueueContext';
import ParticipantPicker from './components/ParticipantPicker';
import Sidebar from './components/Sidebar';
import AdminDashboard from './pages/AdminDashboard';
import Dashboard from './pages/Dashboard';
import Queue from './pages/Queue';
import Models from './pages/Models';

// ── Shell for regular clients ─────────────────────────────────────────────────
function AppShell({ children }: { children: React.ReactNode }) {
  const { user, selectParticipant } = useAuth();
  if (!user) return <ParticipantPicker onSelect={selectParticipant} />;
  return (
    <QueueProvider>
      <div className="flex min-h-screen bg-slate-50 font-sans text-slate-900">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </QueueProvider>
  );
}

// ── Shell for admin ───────────────────────────────────────────────────────────
function AdminShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  if (!user) return <Navigate to="/" replace />;
  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      {/* Minimal top bar for admin */}
      <div className="bg-slate-900 text-white px-8 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-violet-600 rounded-lg flex items-center justify-center text-xs font-black">A</div>
          <div>
            <p className="font-bold text-sm leading-tight">FL Admin</p>
            <p className="text-[10px] text-slate-400">Control Panel</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-slate-400">{user.email}</span>
          <button
            onClick={logout}
            className="text-xs bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg font-medium transition-colors"
          >
            Logout
          </button>
        </div>
      </div>
      <main>{children}</main>
    </div>
  );
}

// ── Route guard ───────────────────────────────────────────────────────────────
function AppRoutes() {
  const { user } = useAuth();
  const isAdmin  = user?.role === 'admin';

  return (
    <Routes>
      {/* Admin gets their own dashboard */}
      <Route path="/admin" element={
        user
          ? isAdmin
            ? <AdminShell><AdminDashboard /></AdminShell>
            : <Navigate to="/" replace />
          : <Navigate to="/" replace />
      } />

      {/* Regular client routes */}
      <Route path="/"       element={<AppShell><Dashboard /></AppShell>} />
      <Route path="/queue"  element={<AppShell><Queue /></AppShell>} />
      <Route path="/models" element={<AppShell><Models /></AppShell>} />

      {/* Catch-all: admin → /admin, client → / */}
      <Route path="*" element={<Navigate to={isAdmin ? '/admin' : '/'} replace />} />
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
