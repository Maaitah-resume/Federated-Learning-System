import React, { createContext, useState, useContext, ReactNode } from 'react';

interface User {
  company:   string;
  companyId: string;
  email:     string;
  token:     string;
  role:      string;
}

interface AuthContextType {
  user:              User | null;
  login:             (email: string, password: string) => Promise<void>;
  selectParticipant: (participantId: string) => void;
  logout:            () => void;
  isLoading:         boolean;
  error:             string | null;
}

const API_BASE =
  (import.meta as any).env?.VITE_API_URL ||
  'https://earnest-heart-production.up.railway.app';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [error,     setError]     = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [user, setUser] = useState<User | null>(() => {
    try {
      const saved = localStorage.getItem('fl_user_session');
      if (saved) return JSON.parse(saved);
    } catch { /* ignore */ }
    return null;
  });

  /**
   * Login via backend API — works for ANY user in the database.
   * No hardcoded user list needed.
   */
  const login = async (email: string, password: string) => {
    setError(null);
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        const msg = data?.error?.message || 'Invalid email or password.';
        setError(msg);
        throw new Error(msg);
      }

      const { token, company } = data;

      const userObj: User = {
        company:   company.companyName,
        companyId: company.companyId,
        email:     company.email,
        token,
        role:      company.role,
      };

      setUser(userObj);
      // Save participant ID for api.ts interceptor
      localStorage.setItem('fl_participant',    JSON.stringify(company.companyId));
      // Save full session for page reloads
      localStorage.setItem('fl_user_session',   JSON.stringify(userObj));
    } catch (err: any) {
      if (!error) setError(err.message || 'Login failed');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * selectParticipant kept for ParticipantPicker compatibility
   * (now unused but harmless to keep)
   */
  const selectParticipant = (participantId: string) => {
    console.warn('selectParticipant is deprecated — use login() instead');
  };

  const logout = () => {
    setUser(null);
    setError(null);
    localStorage.removeItem('fl_participant');
    localStorage.removeItem('fl_user_session');
  };

  return (
    <AuthContext.Provider
      value={{ user, login, selectParticipant, logout, isLoading, error }}
    >
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
