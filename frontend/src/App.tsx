import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import ParticipantPicker from './components/ParticipantPicker';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import TrainingControl from './pages/TrainingControl';
import Training from './pages/Training';
import Queue from './pages/Queue';
import Models from './pages/Models';
import Login from './pages/Login';

function AppShell({ children }: { children: React.ReactNode }) {
  const { user, selectParticipant } = useAuth();

  if (!user) {
    return <ParticipantPicker onSelect={selectParticipant} />;
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
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/login"    element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/"         element={<AppShell><Dashboard /></AppShell>} />
      <Route path="/control"  element={<AppShell><TrainingControl /></AppShell>} />
      <Route path="/training" element={<AppShell><Training /></AppShell>} />
      <Route path="/queue"    element={<AppShell><Queue /></AppShell>} />
      <Route path="/models"   element={<AppShell><Models /></AppShell>} />
      <Route path="/settings" element={<AppShell><div className="p-10 text-slate-400">Settings coming soon...</div></AppShell>} />
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
