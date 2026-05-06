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

  // Not logged in → show login
  if (!user) return <ParticipantPicker onSelect={selectParticipant} />;

  // Admin accidentally hit a client route → send to admin dashboard
  if (user.role === 'admin') return <Navigate to="/admin" replace />;

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

  if (!user) return <ParticipantPicker onSelect={() => {}} />;
  if (user.role !== 'admin') return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      <div className="bg-slate-900 text-white px-8 py-4 flex items-center justify-between sticky top-0 z-50 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-violet-600 rounded-xl flex items-center justify-center text-sm font-black shadow-lg shadow-violet-500/20">
            A
          </div>
          <div>
            <p className="font-bold text-sm leading-tight">FL Admin Panel</p>
            <p className="text-[10px] text-slate-400 uppercase tracking-widest">Control Center</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-slate-400 hidden sm:block">{user.email}</span>
          <button
            onClick={logout}
            className="text-xs bg-slate-700 hover:bg-red-600 px-4 py-2 rounded-xl font-medium transition-colors"
          >
            Logout
          </button>
        </div>
      </div>
      <main>{children}</main>
    </div>
  );
}

// ── Routes ────────────────────────────────────────────────────────────────────
function AppRoutes() {
  const { user } = useAuth();
  const isAdmin  = user?.role === 'admin';

  return (
    <Routes>
      {/* Admin dashboard */}
      <Route path="/admin"  element={<AdminShell><AdminDashboard /></AdminShell>} />

      {/* Client routes — admin gets bounced to /admin inside AppShell */}
      <Route path="/"       element={<AppShell><Dashboard /></AppShell>} />
      <Route path="/queue"  element={<AppShell><Queue /></AppShell>} />
      <Route path="/models" element={<AppShell><Models /></AppShell>} />

      {/* Catch-all */}
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
