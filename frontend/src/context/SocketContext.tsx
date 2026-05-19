// frontend/src/context/SocketContext.tsx
//
// FIX: Pass the demo token in the Socket.IO handshake auth so the backend
// socketHandler can identify this socket's owner and only replay
// round:started events to actual job participants.
//
// Token format: "demo-token-<companyId>"
// Read from fl_participant key (set at login) which stores the companyId.
//
// ── FIX: Railway WebSocket keepalive ──────────────────────────────────────────
// Railway's load balancer drops idle WebSocket connections after ~60 s.
// During model.fit (30-90 s on 5000 rows) no application messages are sent,
// so Railway silently closes the TCP connection.  Socket.IO's own ping runs
// at the server's pingInterval (now 10 s), but we add an explicit client-side
// ping every 20 s as a belt-and-suspenders measure — this guarantees traffic
// crosses the wire even if the Socket.IO engine ping is delayed by a busy
// browser main thread during training.
// ─────────────────────────────────────────────────────────────────────────────
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
    const participantId = (() => {
      try {
        const saved = localStorage.getItem('fl_participant');
        return saved ? JSON.parse(saved) : null;
      } catch { return null; }
    })();
    const token = participantId ? `demo-token-${participantId}` : '';

    const newSocket = io(backendUrl, {
      autoConnect:            true,
      reconnection:           true,
      reconnectionDelay:      1000,
      reconnectionDelayMax:   5000,
      reconnectionAttempts:   Infinity,

      transports: ['websocket', 'polling'],

      // ── Auth token in handshake ───────────────────────────────────────────
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

    // ── Client-side keepalive ping ────────────────────────────────────────────
    // Sends a lightweight 'ping' event every 20 s so Railway's load balancer
    // never sees more than 20 s of silence on this connection, staying well
    // below its ~60 s idle-close threshold.
    // The backend does not need to handle this event — Socket.IO silently
    // ignores unregistered events.  We use 20 s (not 10 s) to avoid
    // overwhelming the server when many clients are connected; the server-side
    // pingInterval (10 s) fills any remaining gap.
    const keepalive = setInterval(() => {
      if (newSocket.connected) {
        newSocket.emit('keepalive');
      }
    }, 20000);

    setSocket(newSocket);

    return () => {
      clearInterval(keepalive);
      newSocket.close();
    };
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
