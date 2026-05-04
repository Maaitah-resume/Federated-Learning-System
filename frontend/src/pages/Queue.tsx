import React, { useState, useEffect, useCallback } from 'react';
import { Users, Loader2, CheckCircle2, Monitor, Globe, Shield, XCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
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

export default function Queue() {
  const [queue,    setQueue]    = useState<QueueState>({ count: 0, companies: [], activeJob: null });
  const [inQueue,  setInQueue]  = useState(false);
  const [loading,  setLoading]  = useState(true);
  const [joining,  setJoining]  = useState(false);
  const [leaving,  setLeaving]  = useState(false);

  const fetchQueue = useCallback(async () => {
    try {
      const res = await apiClient.get('/api/queue');
      setQueue(res.data);

      // Check if current user (observer) is in queue
      const inQ = res.data.companies?.some((c: QueueNode) => c.companyId === 'observer');
      setInQueue(inQ);
    } catch (err) {
      console.error('Queue fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, 5000); // refresh every 5s
    return () => clearInterval(interval);
  }, [fetchQueue]);

  const joinQueue = async () => {
    setJoining(true);
    try {
      await apiClient.post('/api/queue/join');
      await fetchQueue();
    } catch (err) {
      console.error('Join queue error:', err);
    } finally {
      setJoining(false);
    }
  };

  const leaveQueue = async () => {
    setLeaving(true);
    try {
      await apiClient.post('/api/queue/leave');
      await fetchQueue();
    } catch (err) {
      console.error('Leave queue error:', err);
    } finally {
      setLeaving(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Node Waiting Room</h1>
        <p className="text-slate-500 mt-1">Monitor distributed nodes as they join the federated learning cluster.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left panel */}
        <div className="lg:col-span-1 space-y-8">
          <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100 text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-indigo-600"></div>
            <div className="w-20 h-20 bg-indigo-50 rounded-3xl flex items-center justify-center mx-auto mb-6">
              <Users size={40} className="text-indigo-600" />
            </div>

            {/* REAL participant count from backend */}
            <motion.p
              key={queue.count}
              initial={{ scale: 1.2, color: '#4f46e5' }}
              animate={{ scale: 1,   color: '#0f172a' }}
              className="text-5xl font-black text-slate-900 mb-2"
            >
              {loading ? '...' : queue.count}
            </motion.p>
            <p className="text-slate-500 font-medium uppercase tracking-widest text-xs mb-2">Active Participants</p>

            {/* Active job badge */}
            {queue.activeJob && (
              <div className="mb-6 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-lg text-xs font-bold inline-block">
                Training {queue.activeJob.status}
              </div>
            )}
            {!queue.activeJob && <div className="mb-6"></div>}

            <AnimatePresence mode="wait">
              {!inQueue ? (
                <motion.button
                  key="join"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  onClick={joinQueue}
                  disabled={joining}
                  className="w-full bg-indigo-600 text-white py-5 rounded-2xl font-bold text-lg shadow-xl shadow-indigo-100 hover:bg-indigo-700 disabled:opacity-50 transition-all"
                >
                  {joining ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="animate-spin" size={20} />
                      Joining...
                    </span>
                  ) : 'Join Waiting Room'}
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
                    Waiting for training to start...
                  </div>
                  <button
                    onClick={leaveQueue}
                    disabled={leaving}
                    className="w-full border border-red-200 text-red-500 py-3 rounded-xl text-sm font-medium hover:bg-red-50 transition-all disabled:opacity-50"
                  >
                    {leaving ? 'Leaving...' : 'Leave Queue'}
                  </button>
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

        {/* Right panel - REAL node list */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-8 border-b border-slate-50 flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-900">Connected Nodes</h2>
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                Live Feed
              </span>
            </div>

            {loading ? (
              <div className="p-12 text-center text-slate-400">
                <Loader2 className="animate-spin mx-auto mb-3" size={24} />
                Loading nodes...
              </div>
            ) : queue.companies.length === 0 ? (
              <div className="p-12 text-center text-slate-400">
                <Users size={40} className="mx-auto mb-3 opacity-30" />
                <p className="font-medium">No nodes connected yet</p>
                <p className="text-sm mt-1">Join the waiting room to be the first!</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {queue.companies.map((node, i) => (
                  <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1 }}
                    key={node.companyId}
                    className="p-6 flex items-center justify-between hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center text-slate-400">
                        <Monitor size={24} />
                      </div>
                      <div>
                        <p className="font-bold text-slate-900">{node.companyId}</p>
                        <p className="text-xs text-slate-500 font-medium">
                          Joined {new Date(node.joinedAt).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-lg text-xs font-bold uppercase tracking-wider">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                      {node.status || 'ready'}
                    </div>
                  </motion.div>
                ))}
              </div>
            )}

            <div className="p-6 bg-slate-50 text-center text-xs text-slate-400">
              {queue.companies.length} of {queue.count} nodes shown · refreshes every 5s
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
