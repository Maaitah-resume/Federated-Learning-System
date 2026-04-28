import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';

const SocketContext = createContext<Socket | null>(null);

export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    // Hardcoded production URL as fallback (since .env.production is gitignored)
    const backendUrl = 
      import.meta.env.VITE_WS_URL || 
      'https://earnest-heart-production.up.railway.app';
    
    console.log('🔌 WebSocket connecting to:', backendUrl);
    
    const newSocket = io(backendUrl, {
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
      transports: ['websocket', 'polling'],
    });

    newSocket.on('connect', () => {
      console.log('✅ WebSocket connected');
    });

    newSocket.on('disconnect', () => {
      console.log('❌ WebSocket disconnected');
    });

    newSocket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error.message);
    });

    setSocket(newSocket);

    return () => {
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
