import React, { useEffect, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, BarChart, Bar, Legend,
} from 'recharts';
import { Activity, Users, TrendingUp, ShieldCheck, Cpu, Lock } from 'lucide-react';
import { motion } from 'motion/react';
import { apiClient } from '../config/api';
import { useQueue } from '../context/QueueContext';
import { useAuth } from '../context/AuthContext';

interface RoundMetric {
  round:     number;
  accuracy?: number;
  loss?:     number;
  f1Score?:  number;
}

interface MyMetric {
  round:       number;
  accuracy?:   number;
  loss?:       number;
  datasetSize?: number;
  durationMs?:  number;
  epochsRun?:   number;
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
  const { queue }  = useQueue();
  const { user }   = useAuth();
  const [rounds,    setRounds]    = useState<RoundMetric[]>([]);
  const [myMetrics, setMyMetrics] = useState<MyMetric[]>([]);
  const [maxRound,  setMaxRound]  = useState(0);
  const [loading,   setLoading]   = useState(true);

  const fetchMetrics = async () => {
    try {
      const res = await apiClient.get('/api/metrics/current');
      setRounds(res.data.rounds     || []);
      setMyMetrics(res.data.myMetrics || []);
      setMaxRound(res.data.maxRound   || 0);
    } catch (err) {
      console.error('Metrics fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 5000);
    return () => clearInterval(interval);
  }, []);

  const latestGlobal  = rounds[rounds.length - 1];
  const latestMine    = myMetrics[myMetrics.length - 1];
  const currentRound  = latestGlobal?.round || 0;
  const totalRounds   = 10;

  const globalAccuracyPct = latestGlobal?.accuracy != null
    ? `${(latestGlobal.accuracy * 100).toFixed(1)}%` : '—';

  const myAccuracyPct = latestMine?.accuracy != null
    ? `${(latestMine.accuracy * 100).toFixed(1)}%` : '—';

  const lossDisplay = latestGlobal?.loss != null
    ? latestGlobal.loss.toFixed(4) : '—';

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <header className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">System Overview</h1>
          <p className="text-slate-500 mt-1">
            Real-time federated learning performance for <span className="font-semibold text-slate-700">{user?.company}</span>.
          </p>
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
          value={loading ? '...' : globalAccuracyPct}
          icon={ShieldCheck}
          color="bg-indigo-600"
          subtitle="Aggregated across all nodes"
        />
        <StatCard
          title="My Node Accuracy"
          value={loading ? '...' : myAccuracyPct}
          icon={Cpu}
          color="bg-violet-600"
          subtitle="Your local model performance"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

        {/* Global Accuracy Chart */}
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Global Training Progress</h2>
              <p className="text-xs text-slate-400 mt-0.5">Aggregated model accuracy across all participants</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-indigo-600"></div>
              <span className="text-sm text-slate-500 font-medium">Accuracy</span>
            </div>
          </div>
          {rounds.length === 0 ? (
            <div className="h-72 flex items-center justify-center text-slate-400">
              <div className="text-center">
                <Activity size={40} className="mx-auto mb-3 opacity-30" />
                <p>No training data yet</p>
                <p className="text-xs mt-1">Charts appear once training begins</p>
              </div>
            </div>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rounds}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="round" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dy={10}
                    label={{ value: 'Round', position: 'insideBottom', offset: -5, fill: '#94a3b8', fontSize: 11 }} />
                  <YAxis domain={[0, 1]} axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dx={-10}
                    tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                  <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                    formatter={(v: any) => [`${(v * 100).toFixed(2)}%`, 'Global Accuracy']} />
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
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Loss Reduction</h2>
              <p className="text-xs text-slate-400 mt-0.5">Global model loss per round</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-rose-500"></div>
              <span className="text-sm text-slate-500 font-medium">Loss</span>
            </div>
          </div>
          {rounds.length === 0 ? (
            <div className="h-72 flex items-center justify-center text-slate-400">
              <div className="text-center">
                <TrendingUp size={40} className="mx-auto mb-3 opacity-30" />
                <p>No loss data yet</p>
              </div>
            </div>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={rounds}>
                  <defs>
                    <linearGradient id="colorLoss" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#f43f5e" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="round" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dx={-10} />
                  <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                    formatter={(v: any) => [v.toFixed(4), 'Global Loss']} />
                  <Area type="monotone" dataKey="loss" stroke="#f43f5e" fillOpacity={1} fill="url(#colorLoss)" strokeWidth={3} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* My Node Performance — private to current user */}
      <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-xl font-bold text-slate-900">My Node Performance</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Your local training metrics — private to your account only
            </p>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-violet-50 border border-violet-200 rounded-xl">
            <Lock size={13} className="text-violet-500" />
            <span className="text-xs font-bold text-violet-600">Private</span>
          </div>
        </div>

        {myMetrics.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-slate-400">
            <div className="text-center">
              <Cpu size={36} className="mx-auto mb-3 opacity-30" />
              <p>No local metrics yet</p>
              <p className="text-xs mt-1">Join training to see your node's performance</p>
            </div>
          </div>
        ) : (
          <>
            {/* My accuracy per round chart */}
            <div className="h-64 mb-6">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={myMetrics} barSize={32}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="round" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dy={10}
                    label={{ value: 'Round', position: 'insideBottom', offset: -5, fill: '#94a3b8', fontSize: 11 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dx={-10} />
                  <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                  <Legend />
                  <Bar dataKey="accuracy" fill="#7c3aed" radius={[6, 6, 0, 0]} name="My Accuracy" />
                  <Bar dataKey="loss"     fill="#f43f5e" radius={[6, 6, 0, 0]} name="My Loss" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Summary stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-violet-50 p-4 rounded-2xl">
                <p className="text-xs font-bold text-violet-400 uppercase tracking-widest mb-1">Rounds Done</p>
                <p className="text-2xl font-black text-violet-700">{myMetrics.length}</p>
              </div>
              <div className="bg-indigo-50 p-4 rounded-2xl">
                <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-1">Best Accuracy</p>
                <p className="text-2xl font-black text-indigo-700">
                  {myMetrics.length > 0
                    ? `${(Math.max(...myMetrics.map(m => m.accuracy || 0)) * 100).toFixed(1)}%`
                    : '—'}
                </p>
              </div>
              <div className="bg-slate-50 p-4 rounded-2xl">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Dataset Size</p>
                <p className="text-2xl font-black text-slate-700">
                  {latestMine?.datasetSize?.toLocaleString() || '—'}
                </p>
              </div>
              <div className="bg-emerald-50 p-4 rounded-2xl">
                <p className="text-xs font-bold text-emerald-400 uppercase tracking-widest mb-1">Avg Duration</p>
                <p className="text-2xl font-black text-emerald-700">
                  {myMetrics.length > 0
                    ? `${(myMetrics.reduce((s, m) => s + (m.durationMs || 0), 0) / myMetrics.length / 1000).toFixed(1)}s`
                    : '—'}
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
