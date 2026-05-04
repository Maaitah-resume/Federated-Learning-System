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
  selectParticipant: (participantId: string) => void;
  logout:    () => void;
  isLoading: boolean;
  error:     string | null;
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
  const [user, setUser] = useState<User | null>(() => {
    // Restore from localStorage on page refresh
    const saved = localStorage.getItem('fl_participant');
    if (saved) {
      const id = JSON.parse(saved);
      return PARTICIPANT_PROFILES[id] || null;
    }
    return null;
  });

  const selectParticipant = (participantId: string) => {
    const profile = PARTICIPANT_PROFILES[participantId];
    if (profile) {
      setUser(profile);
      localStorage.setItem('fl_participant', JSON.stringify(participantId));
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('fl_participant');
  };

  return (
    <AuthContext.Provider value={{ user, selectParticipant, logout, isLoading: false, error: null }}>
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
