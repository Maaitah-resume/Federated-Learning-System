import React, { createContext, useState, useContext, ReactNode } from 'react';

interface User {
  company:   string;
  companyId: string;
  email:     string;
  token:     string;
  role?:     string;
}

interface AuthContextType {
  user:               User | null;
  login:              (email: string, password: string) => Promise<void>;
  selectParticipant:  (participantId: string) => void;
  logout:             () => void;
  isLoading:          boolean;
  error:              string | null;
}

const PARTICIPANT_PROFILES: Record<string, User> = {
  alpha: {
    company:   'Participant Alpha',
    companyId: 'alpha',
    email:     'alpha@demo.com',
    token:     'demo-token-alpha',
    role:      'client',
  },
  beta: {
    company:   'Participant Beta',
    companyId: 'beta',
    email:     'beta@demo.com',
    token:     'demo-token-beta',
    role:      'client',
  },
  gamma: {
    company:   'Participant Gamma',
    companyId: 'gamma',
    email:     'gamma@demo.com',
    token:     'demo-token-gamma',
    role:      'client',
  },
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [error, setError] = useState<string | null>(null);

  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('fl_participant');
    if (saved) {
      try {
        const id = JSON.parse(saved);
        return PARTICIPANT_PROFILES[id] || null;
      } catch {
        return null;
      }
    }
    return null;
  });

  const selectParticipant = (participantId: string) => {
    const profile = PARTICIPANT_PROFILES[participantId];
    if (profile) {
      setUser(profile);
      setError(null);
      localStorage.setItem('fl_participant', JSON.stringify(participantId));
    }
  };

  const login = async (email: string, _password: string) => {
    setError(null);
    // Match by email or by participant ID directly
    const id = Object.keys(PARTICIPANT_PROFILES).find(
      (key) =>
        PARTICIPANT_PROFILES[key].email === email ||
        key === email
    );
    if (id) {
      selectParticipant(id);
    } else {
      setError('Invalid credentials. Try alpha, beta, or gamma.');
      throw new Error('Invalid credentials');
    }
  };

  const logout = () => {
    setUser(null);
    setError(null);
    localStorage.removeItem('fl_participant');
  };

  return (
    <AuthContext.Provider
      value={{ user, login, selectParticipant, logout, isLoading: false, error }}
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
