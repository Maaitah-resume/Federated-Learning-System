import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import { QueueProvider } from './context/QueueContext';
import ParticipantPicker from './components/ParticipantPicker';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Queue from './pages/Queue';
import Models from './pages/Models';

function AppShell({ children }: { children: React.ReactNode }) {
  const { user, selectParticipant } = useAuth();
  if (!user) return <ParticipantPicker onSelect={selectParticipant} />;
  return (
    <QueueProvider>
      <div className="flex min-h-screen bg-slate-50 font-sans text-slate-900">
        <Sidebar />
        <main className="flex-1 p-10 overflow-y-auto">{children}</main>
      </div>
    </QueueProvider>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/"       element={<AppShell><Dashboard /></AppShell>} />
      <Route path="/queue"  element={<AppShell><Queue /></AppShell>} />
      <Route path="/models" element={<AppShell><Models /></AppShell>} />
      <Route path="*"       element={<Navigate to="/" replace />} />
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
