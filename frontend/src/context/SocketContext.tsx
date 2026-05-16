// frontend/src/context/SocketContext.tsx
//
// FIX: Pass the demo token in the Socket.IO handshake auth so the backend
// socketHandler can identify this socket's owner and only replay
// round:started events to actual job participants.
//
// Token format: "demo-token-<companyId>"
// Read from fl_participant key (set at login) which stores the companyId.
//
import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';

const SocketContext = createContext<Socket | null>(null);

export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const backendUrl =
      import.meta.env.VITE_WS_URL ||
      'https://earnest-heart-production.up.railway.app';

    console.log('🔌 Connecting to:', backendUrl);

    // Build demo token from the stored participant ID
    // (same format used by api.ts interceptor for HTTP requests)
    const participantId = (() => {
      try {
        const saved = localStorage.getItem('fl_participant');
        return saved ? JSON.parse(saved) : null;
      } catch { return null; }
    })();
    const token = participantId ? `demo-token-${participantId}` : '';

    const newSocket = io(backendUrl, {
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,

      transports: ['websocket', 'polling'],

      // ── Auth token in handshake ───────────────────────────────────────────
      // Accessible on the server as socket.handshake.auth.token
      // The socketHandler uses this to decide whether to replay the current
      // round:started event to this socket (only job participants get it).
      auth: { token },
    });

    newSocket.on('connect', () => {
      console.log(
        '✅ Socket connected — id:', newSocket.id,
        '| transport:', newSocket.io.engine.transport.name,
        '| user:', participantId || 'unknown',
      );
    });

    newSocket.on('reconnect', (attempt) => {
      console.log('🔄 Socket reconnected after', attempt, 'attempt(s)',
        '| transport:', newSocket.io.engine.transport.name);
    });

    newSocket.on('disconnect', (reason) => {
      console.log('❌ Socket disconnected:', reason);
    });

    newSocket.on('connect_error', (error) => {
      console.error('Socket connection error:', error.message);
    });

    setSocket(newSocket);

    return () => { newSocket.close(); };
  }, []);

  return (
    <SocketContext.Provider value={socket}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}
