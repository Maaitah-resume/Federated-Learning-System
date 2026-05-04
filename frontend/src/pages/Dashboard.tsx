import React, { useEffect, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, BarChart, Bar, Legend
} from 'recharts';
import { Activity, Database, Users, TrendingUp, ShieldCheck, Cpu } from 'lucide-react';
import { motion } from 'motion/react';
import { apiClient } from '../config/api';
import { useQueue } from '../context/QueueContext';

interface RoundMetric {
  round:     number;
  accuracy?: number;
  loss?:     number;
  f1Score?:  number;
}

interface LocalMetric {
  companyId:    string;
  accuracy?:    number;
  loss?:        number;
  datasetSize?: number;
  durationMs?:  number;
}

const StatCard = ({ title, value, icon: Icon, color, subtitle }: any) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col gap-4"
  >
    <div className={`p-3 rounded-xl w-fit ${color} bg-opacity-10`}>
      <Icon className={color.replace('bg-', 'text-')} size={24} />
    </div>
    <div>
      <p className="text-sm text-slate-500 font-medium uppercase tracking-wider">{title}</p>
      <p className="text-3xl font-bold text-slate-900 mt-1">{value}</p>
      {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
    </div>
  </motion.div>
);

export default function Dashboard() {
  const { queue } = useQueue();
  const [rounds,       setRounds]       = useState<RoundMetric[]>([]);
  const [localMetrics, setLocalMetrics] = useState<LocalMetric[]>([]);
  const [loading,      setLoading]      = useState(true);

  const fetchMetrics = async () => {
    try {
      const res = await apiClient.get('/api/metrics/current');
      setRounds(res.data.rounds || []);
      setLocalMetrics(res.data.localMetrics || []);
    } catch (err) {
      console.error('Metrics fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 5000); // poll every 5s during training
    return () => clearInterval(interval);
  }, []);

  const latestRound  = rounds[rounds.length - 1];
  const currentRound = latestRound?.round || 0;
  const totalRounds  = 10; // matches DEFAULT_ROUNDS

  const accuracyPct = latestRound?.accuracy != null
    ? `${(latestRound.accuracy * 100).toFixed(1)}%`
    : '—';

  const lossDisplay = latestRound?.loss != null
    ? latestRound.loss.toFixed(4)
    : '—';

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <header className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">System Overview</h1>
          <p className="text-slate-500 mt-1">Real-time monitoring of federated learning performance.</p>
        </div>
        {queue.activeJob && (
          <div className="px-4 py-2 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-xs font-bold uppercase tracking-wider flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            Training Active
          </div>
        )}
      </header>

      {/* Stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Active Nodes"
          value={queue.count}
          icon={Users}
          color="bg-blue-600"
          subtitle={queue.activeJob ? 'Training together' : 'In waiting room'}
        />
        <StatCard
          title="Current Round"
          value={loading ? '...' : `${currentRound} / ${totalRounds}`}
          icon={Activity}
          color="bg-emerald-600"
        />
        <StatCard
          title="Global Accuracy"
          value={loading ? '...' : accuracyPct}
          icon={ShieldCheck}
          color="bg-indigo-600"
        />
        <StatCard
          title="Current Loss"
          value={loading ? '...' : lossDisplay}
          icon={TrendingUp}
          color="bg-orange-600"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

        {/* Accuracy Chart */}
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-xl font-bold text-slate-900">Training Progress</h2>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-indigo-600"></div>
              <span className="text-sm text-slate-500 font-medium">Accuracy</span>
            </div>
          </div>
          {rounds.length === 0 ? (
            <div className="h-80 flex items-center justify-center text-slate-400">
              <div className="text-center">
                <Activity size={40} className="mx-auto mb-3 opacity-30" />
                <p>No training data yet</p>
                <p className="text-xs mt-1">Charts will appear once training begins</p>
              </div>
            </div>
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rounds}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="round" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dy={10} label={{ value: 'Round', position: 'insideBottom', offset: -5, fill: '#94a3b8', fontSize: 11 }} />
                  <YAxis domain={[0, 1]} axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dx={-10} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                  <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} formatter={(v: any) => `${(v * 100).toFixed(2)}%`} />
                  <Line type="monotone" dataKey="accuracy" stroke="#4f46e5" strokeWidth={4}
                    dot={{ r: 5, fill: '#4f46e5', strokeWidth: 2, stroke: '#fff' }}
                    activeDot={{ r: 7, strokeWidth: 0 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Loss Chart */}
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-xl font-bold text-slate-900">Loss Reduction</h2>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-rose-500"></div>
              <span className="text-sm text-slate-500 font-medium">Loss</span>
            </div>
          </div>
          {rounds.length === 0 ? (
            <div className="h-80 flex items-center justify-center text-slate-400">
              <div className="text-center">
                <TrendingUp size={40} className="mx-auto mb-3 opacity-30" />
                <p>No loss data yet</p>
              </div>
            </div>
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={rounds}>
                  <defs>
                    <linearGradient id="colorLoss" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#f43f5e" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}   />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="round" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dx={-10} />
                  <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} formatter={(v: any) => v.toFixed(4)} />
                  <Area type="monotone" dataKey="loss" stroke="#f43f5e" fillOpacity={1} fill="url(#colorLoss)" strokeWidth={3} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Per-participant local metrics */}
      {localMetrics.length > 0 && (
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-slate-900">Per-Node Performance (Round {currentRound})</h2>
            <Cpu className="text-slate-400" size={20} />
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={localMetrics}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="companyId" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dx={-10} />
                <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                <Legend />
                <Bar dataKey="accuracy" fill="#4f46e5" radius={[8, 8, 0, 0]} name="Accuracy" />
                <Bar dataKey="loss"     fill="#f43f5e" radius={[8, 8, 0, 0]} name="Loss" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Dataset size table */}
          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            {localMetrics.map((m) => (
              <div key={m.companyId} className="bg-slate-50 p-4 rounded-xl">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">{m.companyId}</p>
                <div className="mt-2 flex justify-between text-sm">
                  <span className="text-slate-600">Samples:</span>
                  <span className="font-bold">{m.datasetSize?.toLocaleString() || '—'}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Duration:</span>
                  <span className="font-bold">{m.durationMs ? `${(m.durationMs / 1000).toFixed(1)}s` : '—'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
