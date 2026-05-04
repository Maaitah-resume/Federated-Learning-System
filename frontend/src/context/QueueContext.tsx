import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { apiClient } from '../config/api';

interface QueueNode {
  companyId: string;
  joinedAt:  string;
  status:    string;
}

interface QueueState {
  count:     number;
  companies: QueueNode[];
  activeJob: { jobId: string; status: string } | null;
}

interface QueueContextType {
  queue:    QueueState;
  inQueue:  boolean;
  loading:  boolean;
  refresh:  () => Promise<void>;
}

const QueueContext = createContext<QueueContextType | undefined>(undefined);

export function QueueProvider({ children }: { children: ReactNode }) {
  const [queue,   setQueue]   = useState<QueueState>({ count: 0, companies: [], activeJob: null });
  const [inQueue, setInQueue] = useState(false);
  const [loading, setLoading] = useState(true);

  const currentId = (() => {
    const saved = localStorage.getItem('fl_participant');
    return saved ? JSON.parse(saved) : null;
  })();

  const refresh = useCallback(async () => {
    if (!currentId) return;
    try {
      const res   = await apiClient.get('/api/queue');
      const nodes = res.data.participants || res.data.companies || [];
      setQueue({ ...res.data, companies: nodes });
      setInQueue(nodes.some((c: QueueNode) => c.companyId === currentId));
    } catch (err) {
      console.error('Queue fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [currentId]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000); // poll every 5s globally
    return () => clearInterval(interval);
  }, [refresh]);

  return (
    <QueueContext.Provider value={{ queue, inQueue, loading, refresh }}>
      {children}
    </QueueContext.Provider>
  );
}

export function useQueue() {
  const ctx = useContext(QueueContext);
  if (!ctx) throw new Error('useQueue must be used within QueueProvider');
  return ctx;
}
