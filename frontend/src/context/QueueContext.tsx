import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { apiClient } from '../config/api';

interface QueueNode {
  companyId:   string;
  companyName?: string;
  joinedAt:    string;
  status:      string;
}

interface ActiveJob {
  jobId:        string;
  status:       string;
  currentRound: number;
  totalRounds:  number;
}

interface QueueState {
  count:     number;
  companies: QueueNode[];
  activeJob: ActiveJob | null;
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

      // User is "in" if they appear in the node list (QUEUED or TRAINING)
      const found = nodes.some((c: QueueNode) => c.companyId === currentId);
      // Also mark as inQueue if active job contains them (even if DB not updated yet)
      const inJob = res.data.activeJob?.jobId && nodes.length > 0;
      setInQueue(found || (!!inJob && nodes.some((c: QueueNode) => c.companyId === currentId)));
    } catch (err) {
      console.error('Queue fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [currentId]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 3000); // poll every 3s for smoother round updates
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
