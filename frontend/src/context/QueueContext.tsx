// frontend/src/context/QueueContext.tsx
//
// FIX: Listen for the 'config:updated' WebSocket event emitted by the backend
// when an admin saves new settings.  This immediately updates minRequired in
// all connected clients without waiting for the next 3-second poll.
//
import React, {
  createContext, useContext, useEffect, useState,
  ReactNode, useCallback, useRef,
} from 'react';
import { apiClient } from '../config/api';
import { useSocket } from './SocketContext';

interface QueueNode {
  companyId:    string;
  companyName?: string;
  joinedAt:     string;
  status:       string;
}

interface ActiveJob {
  jobId:        string;
  status:       string;
  currentRound: number;
  totalRounds:  number;
}

interface QueueState {
  count:       number;
  minRequired: number;   // ← dynamic from backend (set by admin)
  companies:   QueueNode[];
  activeJob:   ActiveJob | null;
}

interface QueueContextType {
  queue:    QueueState;
  inQueue:  boolean;
  loading:  boolean;
  refresh:  () => Promise<void>;
}

const QueueContext = createContext<QueueContextType | undefined>(undefined);

export function QueueProvider({ children }: { children: ReactNode }) {
  const [queue,   setQueue]   = useState<QueueState>({ count: 0, minRequired: 2, companies: [], activeJob: null });
  const [inQueue, setInQueue] = useState(false);
  const [loading, setLoading] = useState(true);
  const socket = useSocket();

  const currentId = (() => {
    const saved = localStorage.getItem('fl_participant');
    return saved ? JSON.parse(saved) : null;
  })();

  const refresh = useCallback(async () => {
    if (!currentId) return;
    try {
      const res   = await apiClient.get('/api/queue');
      const nodes = res.data.participants || res.data.companies || [];

      setQueue({
        ...res.data,
        companies:   nodes,
        minRequired: res.data.minRequired ?? 2,
      });

      const found = nodes.some((c: QueueNode) => c.companyId === currentId);
      setInQueue(found);
    } catch (err) {
      console.error('Queue fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [currentId]);

  // Regular polling
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [refresh]);

  // ── Live config updates from admin ────────────────────────────────────────
  // When admin saves a new MIN_CLIENTS the backend emits 'config:updated'.
  // We update minRequired immediately so the queue page shows the right
  // threshold without waiting for the next poll.
  useEffect(() => {
    if (!socket) return;

    const onConfigUpdated = (data: { config: { MIN_CLIENTS?: number } }) => {
      if (data?.config?.MIN_CLIENTS !== undefined) {
        setQueue(prev => ({ ...prev, minRequired: data.config.MIN_CLIENTS! }));
        // Also do a full refresh to get accurate count / participants
        refresh();
      }
    };

    socket.on('config:updated', onConfigUpdated);
    return () => { socket.off('config:updated', onConfigUpdated); };
  }, [socket, refresh]);

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
