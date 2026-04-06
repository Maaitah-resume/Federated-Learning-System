import React, { useState, useEffect } from 'react';
import { Users, Loader2, CheckCircle2, Monitor, Globe, Shield } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const mockNodes = [
  { id: 'node_8291', status: 'ready', type: 'Edge Device', location: 'London, UK' },
  { id: 'node_1022', status: 'ready', type: 'Server', location: 'New York, USA' },
  { id: 'node_4431', status: 'ready', type: 'Mobile', location: 'Tokyo, JP' },
  { id: 'node_9902', status: 'ready', type: 'Edge Device', location: 'Berlin, DE' },
];

export default function Queue() {
  const [inQueue, setInQueue] = useState(false);
  const [participants, setParticipants] = useState(14);
  const [nodes, setNodes] = useState(mockNodes);

  useEffect(() => {
    if (inQueue) {
      const interval = setInterval(() => {
        setParticipants(p => p + Math.floor(Math.random() * 2));
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [inQueue]);

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Node Waiting Room</h1>
        <p className="text-slate-500 mt-1">Monitor distributed nodes as they join the federated learning cluster.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-8">
          <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100 text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-indigo-600"></div>
            <div className="w-20 h-20 bg-indigo-50 rounded-3xl flex items-center justify-center mx-auto mb-6">
              <Users size={40} className="text-indigo-600" />
            </div>
            <p className="text-5xl font-black text-slate-900 mb-2">{participants}</p>
            <p className="text-slate-500 font-medium uppercase tracking-widest text-xs mb-8">Active Participants</p>
            
            <AnimatePresence mode="wait">
              {!inQueue ? (
                <motion.button 
                  key="join"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  onClick={() => setInQueue(true)} 
                  className="w-full bg-indigo-600 text-white py-5 rounded-2xl font-bold text-lg shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-all"
                >
                  Join Waiting Room
                </motion.button>
              ) : (
                <motion.div 
                  key="waiting"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-4"
                >
                  <div className="flex items-center justify-center gap-3 text-emerald-600 font-bold bg-emerald-50 py-4 rounded-2xl">
                    <CheckCircle2 size={20} />
                    You are in the queue
                  </div>
                  <div className="flex items-center justify-center gap-2 text-slate-400 text-sm">
                    <Loader2 className="animate-spin" size={16} />
                    Waiting for server to start training...
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="bg-slate-900 p-8 rounded-[2.5rem] text-white">
            <Shield className="text-indigo-400 mb-4" size={32} />
            <h3 className="text-lg font-bold mb-2">Secure Aggregation</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              All nodes use differential privacy and secure multi-party computation to ensure local data never leaves the device.
            </p>
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-8 border-b border-slate-50 flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-900">Recent Node Activity</h2>
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Real-time Feed</span>
            </div>
            <div className="divide-y divide-slate-50">
              {nodes.map((node, i) => (
                <motion.div 
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1 }}
                  key={node.id} 
                  className="p-6 flex items-center justify-between hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center text-slate-400">
                      {node.type === 'Server' ? <Globe size={24} /> : <Monitor size={24} />}
                    </div>
                    <div>
                      <p className="font-bold text-slate-900">{node.id}</p>
                      <p className="text-xs text-slate-500 font-medium">{node.type} • {node.location}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-lg text-xs font-bold uppercase tracking-wider">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                    {node.status}
                  </div>
                </motion.div>
              ))}
            </div>
            <div className="p-6 bg-slate-50 text-center">
              <button className="text-indigo-600 font-bold text-sm hover:underline">View All Connected Nodes</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
