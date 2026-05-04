import React, { createContext, useState, useContext, ReactNode } from 'react';

interface User {
  company:   string;
  companyId: string;
  email:     string;
  token:     string;
  role?:     string;
}

interface AuthContextType {
  user:      User | null;
  logout:    () => void;
  isLoading: boolean;
  error:     string | null;
}

// Demo user — token format must match backend: "demo-token-<companyId>"
// Backend authMiddleware looks up Company where companyId = "observer"
const DEMO_USER: User = {
  company:   'FL Observer',
  companyId: 'observer',
  email:     'observer@fedlearning.com',
  token:     'demo-token-observer',  // ← backend accepts this format
  role:      'client',
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user] = useState<User | null>(DEMO_USER);
  const [isLoading] = useState(false);
  const [error]     = useState<string | null>(null);

  const logout = () => window.location.reload();

  return (
    <AuthContext.Provider value={{ user, logout, isLoading, error }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
