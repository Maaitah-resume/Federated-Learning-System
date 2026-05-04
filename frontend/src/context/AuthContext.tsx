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

// Demo user - automatically signed in, no login needed
const DEMO_USER: User = {
  company:   'Demo Company',
  companyId: 'demo',
  email:     'demo@fedlearning.com',
  token:     'demo-token-auto',
  role:      'client',
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Always start logged in as demo user
  const [user] = useState<User | null>(DEMO_USER);
  const [isLoading] = useState(false);
  const [error] = useState<string | null>(null);

  const logout = () => {
    // No-op in demo mode - just reload the page
    window.location.reload();
  };

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
