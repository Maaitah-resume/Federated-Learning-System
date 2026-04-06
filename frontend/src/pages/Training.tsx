import React, { useState, useEffect } from 'react';
import { Cpu, Loader2, CheckCircle2, AlertCircle, Database, ArrowUpRight, Activity } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function Training() {
  const [round, setRound] = useState(1);
  const [status, setStatus] = useState<'idle' | 'local_training' | 'uploading' | 'aggregating'>('idle');
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let interval: any;
    
    if (status === 'idle') {
      const timeout = setTimeout(() => setStatus('local_training'), 2000);
      return () => clearTimeout(timeout);
    }

    if (status === 'local_training') {
      interval = setInterval(() => {
        setProgress(p => {
          if (p >= 100) {
            clearInterval(interval);
            setStatus('uploading');
            return 100;
          }
          return p + 2;
        });
      }, 50);
    }

    if (status === 'uploading') {
      const timeout = setTimeout(() => {
        setStatus('aggregating');
        setProgress(0);
      }, 2000);
      return () => clearTimeout(timeout);
    }

    if (status === 'aggregating') {
      const timeout = setTimeout(() => {
        if (round < 10) {
          setRound(r => r + 1);
          setStatus('local_training');
          setProgress(0);
        } else {
          setStatus('idle'); // Complete
        }
      }, 3000);
      return () => clearTimeout(timeout);
    }

    return () => clearInterval(interval);
  }, [status, round]);

  const getStatusInfo = () => {
    switch (status) {
      case 'local_training': return { label: 'Local Training', icon: Cpu, color: 'text-indigo-600', bg: 'bg-indigo-50' };
      case 'uploading': return { label: 'Uploading Weights', icon: ArrowUpRight, color: 'text-amber-600', bg: 'bg-amber-50' };
      case 'aggregating': return { label: 'Global Aggregation', icon: Database, color: 'text-emerald-600', bg: 'bg-emerald-50' };
      default: return { label: 'Waiting for Round', icon: Activity, color: 'text-slate-400', bg: 'bg-slate-50' };
    }
  };

  const info = getStatusInfo();

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Active Training Session</h1>
          <p className="text-slate-500 mt-1">Monitoring the current federated learning lifecycle on your device.</p>
        </div>
        <div className="bg-white px-6 py-3 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-3">
          <span className="text-slate-400 font-bold text-xs uppercase tracking-widest">Current Round</span>
          <span className="text-2xl font-black text-indigo-600">{round} <span className="text-slate-300 text-lg">/ 10</span></span>
        </div>
      </header>

      <div className="bg-white p-12 rounded-[3rem] shadow-sm border border-slate-100 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-2 bg-slate-50">
          <motion.div 
            className="h-full bg-indigo-600"
            initial={{ width: 0 }}
            animate={{ width: `${(round / 10) * 100}%` }}
          />
        </div>

        <div className="flex flex-col items-center text-center">
          <motion.div 
            key={status}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={`p-8 rounded-[2.5rem] ${info.bg} ${info.color} mb-8`}
          >
            <info.icon size={64} className={status !== 'idle' ? 'animate-pulse' : ''} />
          </motion.div>

          <h2 className="text-3xl font-bold text-slate-900 mb-2">{info.label}</h2>
          <p className="text-slate-500 max-w-md mb-10">
            {status === 'local_training' && "Your device is processing local data to compute gradient updates using Stochastic Gradient Descent."}
            {status === 'uploading' && "Local weights are being encrypted and securely transmitted to the central aggregator."}
            {status === 'aggregating' && "The server is combining updates from all participating nodes using the FedAvg algorithm."}
            {status === 'idle' && "Preparing for the next round of federated optimization."}
          </p>

          <div className="w-full max-w-md space-y-4">
            <div className="flex justify-between text-sm font-bold uppercase tracking-widest">
              <span className="text-slate-400">Progress</span>
              <span className={info.color}>{progress}%</span>
            </div>
            <div className="h-4 bg-slate-100 rounded-full overflow-hidden">
              <motion.div 
                className={`h-full ${info.color.replace('text-', 'bg-')}`}
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ type: 'spring', bounce: 0, duration: 0.5 }}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-8 mt-16 pt-10 border-t border-slate-50">
          <div className="text-center">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Local Loss</p>
            <p className="text-xl font-bold text-slate-900">0.241</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Battery Impact</p>
            <p className="text-xl font-bold text-emerald-600">-1.2%</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Data Used</p>
            <p className="text-xl font-bold text-slate-900">4.2 MB</p>
          </div>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-100 p-6 rounded-3xl flex gap-4 items-start">
        <AlertCircle className="text-amber-600 shrink-0" size={24} />
        <div>
          <h4 className="font-bold text-amber-900">Training Notice</h4>
          <p className="text-sm text-amber-800 leading-relaxed">
            Do not close this tab or disconnect from the network. Training is performed locally on your hardware. 
            Interrupting the process may result in your node being dropped from the current round.
          </p>
        </div>
      </div>
    </div>
  );
}
