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
      reconnectionAttempts: 20,
      // FIX: Use polling FIRST — works behind all proxies/CDNs
      // WebSocket upgrade happens automatically after connection established
      transports: ['polling', 'websocket'],
    });

    newSocket.on('connect', () => {
      console.log('✅ Socket connected, transport:', newSocket.io.engine.transport.name);
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
