import React, { createContext, useState, useContext, ReactNode } from 'react';

interface User {
  company:   string;
  companyId: string;
  email:     string;
  token:     string;
  role?:     string;
}

interface AuthContextType {
  user:              User | null;
  login:             (email: string, password: string) => Promise<void>;
  selectParticipant: (participantId: string) => void;
  logout:            () => void;
  isLoading:         boolean;
  error:             string | null;
}

const PARTICIPANT_PROFILES: Record<string, User> = {
  mohammad: {
    company:   'Mohammad HTU',
    companyId: 'mohammad',
    email:     'Mohammad@htu.edu.jo',
    token:     'demo-token-mohammad',
    role:      'client',
  },
  amer: {
    company:   'Amer HTU',
    companyId: 'amer',
    email:     'Amer@htu.edu.jo',
    token:     'demo-token-amer',
    role:      'client',
  },
  ammar: {
    company:   'Ammar HTU',
    companyId: 'ammar',
    email:     'Ammar@htu.edu.jo',
    token:     'demo-token-ammar',
    role:      'client',
  },
};

const VALID_PASSWORD = '123';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [error, setError] = useState<string | null>(null);

  const [user, setUser] = useState<User | null>(() => {
    try {
      const saved = localStorage.getItem('fl_participant');
      if (saved) {
        const id = JSON.parse(saved);
        return PARTICIPANT_PROFILES[id] || null;
      }
    } catch { /* ignore */ }
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

  const login = async (email: string, password: string) => {
    setError(null);

    // Check password first
    if (password !== VALID_PASSWORD) {
      setError('Invalid email or password.');
      throw new Error('Invalid credentials');
    }

    // Match by email (case-insensitive) or by companyId
    const id = Object.keys(PARTICIPANT_PROFILES).find(
      (key) =>
        PARTICIPANT_PROFILES[key].email.toLowerCase() === email.toLowerCase() ||
        key.toLowerCase() === email.toLowerCase()
    );

    if (id) {
      selectParticipant(id);
    } else {
      setError('Invalid email or password.');
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
