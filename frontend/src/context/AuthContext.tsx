import React, { createContext, useState, useContext, ReactNode } from 'react';
import { api } from '../config/api';

interface User {
  company: string;
  token: string;
  email: string;
  user_id?: string;
  username?: string;
}

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
  error: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('fl_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = async (username: string, password: string) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await api.auth.login({ username, password });
      
      if (response.data.status === 'success') {
        const userData = response.data.data;
        const newUser: User = {
          company: userData.username || username,
          email: userData.email || `${username}@demo.com`,
          token: userData.token,
          user_id: userData.user_id,
          username: userData.username,
        };
        
        setUser(newUser);
        localStorage.setItem('fl_user', JSON.stringify(newUser));
      } else {
        throw new Error(response.data.detail || 'Login failed');
      }
    } catch (err: any) {
      const errorMessage = err.response?.data?.detail || err.message || 'Login failed';
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
