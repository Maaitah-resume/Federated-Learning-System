import React, { useState, useEffect, useCallback } from 'react';
import { Users, Loader2, CheckCircle2, Monitor, Shield, Upload, FileText, X } from 'lucide-react';
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
  const [queue,   setQueue]   = useState<QueueState>({ count: 0, companies: [], activeJob: null });
  const [inQueue, setInQueue] = useState(false);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [file,    setFile]    = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const currentId = (() => {
    const saved = localStorage.getItem('fl_participant');
    return saved ? JSON.parse(saved) : null;
  })();

  const fetchQueue = useCallback(async () => {
    try {
      const res   = await apiClient.get('/api/queue');
      const nodes = res.data.participants || res.data.companies || [];
      setQueue({ ...res.data, companies: nodes });
      const inQ = nodes.some((c: QueueNode) => c.companyId === currentId);
      setInQueue(inQ);
    } catch (err) {
      console.error('Queue fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [currentId]);

  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, 5000);
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

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Node Waiting Room</h1>
        <p className="text-slate-500 mt-1">Upload your private data and join the federated learning cluster.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left panel */}
        <div className="lg:col-span-1 space-y-6">

          {/* Step 1: Upload Data */}
          <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center text-sm font-bold">1</div>
              <h3 className="font-bold text-slate-900">Upload Private Data</h3>
            </div>
            <div
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              className={`border-2 border-dashed rounded-2xl p-6 text-center transition-colors cursor-pointer ${
                dragOver ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 hover:border-indigo-300'
              }`}
              onClick={() => document.getElementById('file-input')?.click()}
            >
              <input
                id="file-input"
                type="file"
                className="hidden"
                accept=".csv,.json,.txt"
                onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])}
              />
              {file ? (
                <div className="flex items-center justify-between bg-indigo-50 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-2 text-indigo-700">
                    <FileText size={18} />
                    <span className="text-sm font-medium truncate max-w-[120px]">{file.name}</span>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); setFile(null); }} className="text-slate-400 hover:text-red-500">
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <>
                  <Upload size={28} className="mx-auto mb-2 text-slate-300" />
                  <p className="text-sm text-slate-500">Drop your CSV/JSON file here</p>
                  <p className="text-xs text-slate-400 mt-1">or click to browse</p>
                </>
              )}
            </div>
          </div>

          {/* Step 2: Join Queue */}
          <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-indigo-600"></div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center text-sm font-bold">2</div>
              <h3 className="font-bold text-slate-900">Join Waiting Room</h3>
            </div>

            <motion.p
              key={queue.count}
              initial={{ scale: 1.2, color: '#4f46e5' }}
              animate={{ scale: 1,   color: '#0f172a' }}
              className="text-5xl font-black mb-1"
            >
              {loading ? '...' : queue.count}
            </motion.p>
            <p className="text-slate-500 font-medium uppercase tracking-widest text-xs mb-4">Active Participants</p>

            {queue.activeJob && (
              <div className="mb-4 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-lg text-xs font-bold inline-block">
                Training {queue.activeJob.status}
              </div>
            )}

            <AnimatePresence mode="wait">
              {!inQueue ? (
                <motion.button
                  key="join"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  onClick={joinQueue}
                  disabled={joining || !file}
                  title={!file ? 'Upload your data first' : ''}
                  className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold text-lg shadow-xl shadow-indigo-100 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {joining ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="animate-spin" size={20} /> Joining...
                    </span>
                  ) : 'Join Waiting Room'}
                </motion.button>
              ) : (
                <motion.div
                  key="waiting"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-3"
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

            {!file && !inQueue && (
              <p className="text-xs text-slate-400 mt-3">⬆ Upload your data first to enable joining</p>
            )}
          </div>

          {/* Secure Aggregation info */}
          <div className="bg-slate-900 p-6 rounded-[2rem] text-white">
            <Shield className="text-indigo-400 mb-3" size={28} />
            <h3 className="text-base font-bold mb-1">Secure Aggregation</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              Your data never leaves your device. Only model updates are shared using differential privacy.
            </p>
          </div>
        </div>

        {/* Right panel - Connected Nodes */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-6 border-b border-slate-50 flex justify-between items-center">
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
                <p className="text-sm mt-1">Upload your data and join to be the first!</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {queue.companies.map((node, i) => (
                  <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1 }}
                    key={node.companyId}
                    className={`p-6 flex items-center justify-between transition-colors ${
                      node.companyId === currentId ? 'bg-indigo-50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center text-slate-400">
                        <Monitor size={24} />
                      </div>
                      <div>
                        <p className="font-bold text-slate-900">
                          {node.companyId}
                          {node.companyId === currentId && (
                            <span className="ml-2 text-xs text-indigo-500 font-normal">(you)</span>
                          )}
                        </p>
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

            <div className="p-4 bg-slate-50 text-center text-xs text-slate-400">
              {queue.companies.length} of {queue.count} nodes shown · refreshes every 5s
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
