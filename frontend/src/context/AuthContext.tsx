import React, { createContext, useState, useContext, ReactNode } from 'react';
import { api } from '../config/api';

interface User {
  company:    string;
  companyId:  string;
  email:      string;
  token:      string;
  role?:      string;
}

interface AuthContextType {
  user:      User | null;
  login:     (email: string, password: string) => Promise<void>;
  logout:    () => void;
  isLoading: boolean;
  error:     string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('fl_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await api.auth.login({ email, password });
      const { token, company } = response.data;

      const newUser: User = {
        company:   company.companyName,
        companyId: company.companyId,
        email:     company.email,
        token,
        role:      company.role,
      };

      setUser(newUser);
      localStorage.setItem('fl_user', JSON.stringify(newUser));
    } catch (err: any) {
      const errorMessage =
        err.response?.data?.error?.message ||
        err.message ||
        'Login failed. Please try again.';
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    setUser(null);
    setError(null);
    localStorage.removeItem('fl_user');
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading, error }}>
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
