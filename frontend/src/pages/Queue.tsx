import React, { useState } from 'react';
import { Users, Loader2, CheckCircle2, Monitor, Shield, Upload, FileText, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { apiClient } from '../config/api';
import { useQueue } from '../context/QueueContext';

export default function Queue() {
  const { queue, inQueue, loading, refresh } = useQueue();
  const [joining,  setJoining]  = useState(false);
  const [leaving,  setLeaving]  = useState(false);
  const [file,     setFile]     = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const currentId = (() => {
    const saved = localStorage.getItem('fl_participant');
    return saved ? JSON.parse(saved) : null;
  })();

  const joinQueue = async () => {
    if (!file) return;
    setJoining(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await apiClient.post('/api/data/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await apiClient.post('/api/queue/join');
      await refresh();
    } catch (err: any) {
      const status = err.response?.status;
      const msg    = err.response?.data?.error?.message || err.response?.data?.message || '';

      // Race condition: training already started when we were the 3rd user — just refresh
      if (status === 409 || msg.toLowerCase().includes('already')) {
        await refresh();
        return;
      }

      console.error('Join queue error:', err);
      alert(msg || 'Failed to join queue');
    } finally {
      setJoining(false);
    }
  };

  const leaveQueue = async () => {
    setLeaving(true);
    try {
      await apiClient.post('/api/queue/leave');
      await refresh();
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

  const MIN_REQUIRED = 3;
  const slotsLeft    = Math.max(0, MIN_REQUIRED - queue.count);

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Node Waiting Room</h1>
        <p className="text-slate-500 mt-1">Upload your private data and join the federated learning cluster.</p>
      </header>

      {/* Global training-active banner */}
      <AnimatePresence>
        {queue.activeJob && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-gradient-to-r from-indigo-600 to-emerald-600 p-6 rounded-3xl text-white shadow-xl shadow-indigo-100"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-white/20 backdrop-blur rounded-2xl flex items-center justify-center">
                <Loader2 className="animate-spin" size={24} />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-lg">🚀 Federated Training in Progress</h3>
                <p className="text-sm text-white/80">
                  Job <span className="font-mono">{queue.activeJob.jobId.slice(0, 8)}</span> · Status:{' '}
                  <span className="font-bold uppercase">{queue.activeJob.status}</span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-white/70 uppercase tracking-widest">Participants</p>
                <p className="text-2xl font-black">{queue.count}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">

          {/* Step 1: Upload */}
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
                  <button
                    onClick={(e) => { e.stopPropagation(); setFile(null); }}
                    className="text-slate-400 hover:text-red-500"
                  >
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
              {loading ? '...' : `${queue.count} / ${MIN_REQUIRED}`}
            </motion.p>
            <p className="text-slate-500 font-medium uppercase tracking-widest text-xs mb-4">Active Participants</p>

            {/* Need more participants hint */}
            {!queue.activeJob && inQueue && slotsLeft > 0 && (
              <div className="mb-4 p-2 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700 font-medium">
                Need {slotsLeft} more {slotsLeft === 1 ? 'participant' : 'participants'} to auto-start training
              </div>
            )}

            {/* Training started badge */}
            {queue.activeJob && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="mb-4 p-3 bg-gradient-to-r from-emerald-50 to-indigo-50 border border-emerald-200 rounded-xl"
              >
                <div className="flex items-center justify-center gap-2 text-emerald-700 font-bold text-sm mb-1">
                  <Loader2 className="animate-spin" size={14} />
                  Training Started!
                </div>
                <p className="text-xs text-slate-600">
                  Job <span className="font-mono">{queue.activeJob.jobId.slice(0, 8)}</span> ·{' '}
                  <span className="font-bold uppercase">{queue.activeJob.status}</span>
                </p>
              </motion.div>
            )}

            <AnimatePresence mode="wait">
              {!inQueue ? (
                <motion.button
                  key="join"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  onClick={joinQueue}
                  disabled={joining || !file || !!queue.activeJob}
                  title={
