// frontend/src/context/SocketContext.tsx
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

    const newSocket = io(backendUrl, {
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,  // keep trying forever during a training job

      // ── FIX: WebSocket FIRST ────────────────────────────────────────────────
      // The original order ['polling', 'websocket'] causes Railway's reverse
      // proxy to terminate the short-lived polling HTTP connections every
      // 10-30 s, producing a constant reconnect storm and aborting in-flight
      // weight submissions (BadRequestError: request aborted).
      //
      // With WebSocket first the client opens one persistent TCP connection
      // and only falls back to polling if the server actively rejects the
      // upgrade — which Railway does NOT do.
      transports: ['websocket', 'polling'],
    });

    newSocket.on('connect', () => {
      console.log(
        '✅ Socket connected — id:', newSocket.id,
        '| transport:', newSocket.io.engine.transport.name,
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
