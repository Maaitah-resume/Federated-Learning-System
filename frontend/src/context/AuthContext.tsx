import React, { createContext, useState, useContext, ReactNode } from 'react';

interface User {
  company: string;
  token: string;
  email: string;
}

interface AuthContextType {
  user: User | null;
  login: (email: string, company: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('fl_user');
    return saved ? JSON.parse(saved) : null;
  });

  const login = (email: string, company: string) => {
    const newUser = { email, company, token: 'mock-jwt-token' };
    setUser(newUser);
    localStorage.setItem('fl_user', JSON.stringify(newUser));
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('fl_user');
  };

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
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
