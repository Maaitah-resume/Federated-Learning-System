import React, { useEffect, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area
} from 'recharts';
import { Activity, Cpu, Database, Users, TrendingUp, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { apiClient } from '../config/api';

interface SystemStats {
  activeNodes:    number;
  currentRound:   string;
  globalAccuracy: string;
  dataPoints:     string;
  roundHistory:   { round: number; accuracy: number; loss: number }[];
}

const StatCard = ({ title, value, icon: Icon, color, trend }: any) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col gap-4"
  >
    <div className="flex justify-between items-start">
      <div className={`p-3 rounded-xl ${color} bg-opacity-10`}>
        <Icon className={color.replace('bg-', 'text-')} size={24} />
      </div>
      {trend && (
        <div className="flex items-center gap-1 text-green-600 text-sm font-medium bg-green-50 px-2 py-1 rounded-lg">
          <TrendingUp size={14} />
          {trend}
        </div>
      )}
    </div>
    <div>
      <p className="text-sm text-slate-500 font-medium uppercase tracking-wider">{title}</p>
      <p className="text-3xl font-bold text-slate-900 mt-1">{value}</p>
    </div>
  </motion.div>
);

export default function Dashboard() {
  const [stats, setStats] = useState<SystemStats>({
    activeNodes:    0,
    currentRound:   '— / —',
    globalAccuracy: '—',
    dataPoints:     '—',
    roundHistory:   [],
  });
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      // Fetch queue state for active participants count
      const [queueRes, trainingRes, historyRes] = await Promise.allSettled([
        apiClient.get('/api/queue'),
        apiClient.get('/api/training/status'),
        apiClient.get('/api/training/history'),
      ]);

      const queue    = queueRes.status    === 'fulfilled' ? queueRes.value.data    : null;
      const training = trainingRes.status === 'fulfilled' ? trainingRes.value.data : null;
      const history  = historyRes.status  === 'fulfilled' ? historyRes.value.data  : [];

      // Build round history from completed jobs
      const roundHistory = Array.isArray(history)
        ? history.slice(-6).map((job: any, i: number) => ({
            round:    i + 1,
            accuracy: job.finalAccuracy ?? 0,
            loss:     job.finalLoss     ?? 0,
          }))
        : [];

      // Add current round if training is active
      if (training && training.currentRound && roundHistory.length === 0) {
        roundHistory.push({
          round:    training.currentRound,
          accuracy: training.metrics?.latestAccuracy ?? 0,
          loss:     training.metrics?.latestLoss     ?? 0,
        });
      }

      setStats({
        activeNodes:    queue?.count    ?? training?.participants?.length ?? 0,
        currentRound:   training
          ? `${training.currentRound} / ${training.totalRounds}`
          : '—',
        globalAccuracy: training?.metrics?.latestAccuracy != null
          ? `${(training.metrics.latestAccuracy * 100).toFixed(1)}%`
          : '—',
        dataPoints:     queue?.count != null ? `${queue.count * 42}k` : '—',
        roundHistory,
      });
    } catch (err) {
      console.error('Dashboard fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // Refresh every 10 seconds for real-time feel
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <header className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">System Overview</h1>
          <p className="text-slate-500 mt-1">Real-time monitoring of federated learning performance across distributed nodes.</p>
        </div>
        {loading && (
          <div className="text-xs text-slate-400 flex items-center gap-2 mt-2">
            <div className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse"></div>
            Fetching live data...
          </div>
        )}
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="Active Nodes"    value={loading ? '...' : stats.activeNodes}    icon={Users}      color="bg-blue-600"    trend={stats.activeNodes > 0 ? `+${stats.activeNodes}` : undefined} />
        <StatCard title="Current Round"   value={loading ? '...' : stats.currentRound}   icon={Activity}   color="bg-emerald-600" />
        <StatCard title="Global Accuracy" value={loading ? '...' : stats.globalAccuracy} icon={ShieldCheck} color="bg-indigo-600" />
        <StatCard title="Data Points"     value={loading ? '...' : stats.dataPoints}     icon={Database}   color="bg-orange-600"  />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-xl font-bold text-slate-900">Training Progress</h2>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-indigo-600"></div>
              <span className="text-sm text-slate-500 font-medium">Accuracy</span>
            </div>
          </div>
          {stats.roundHistory.length === 0 ? (
            <div className="h-80 flex items-center justify-center text-slate-400">
              <div className="text-center">
                <Activity size={40} className="mx-auto mb-3 opacity-30" />
                <p>No training data yet</p>
                <p className="text-xs mt-1">Start a training session to see progress</p>
              </div>
            </div>
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={stats.roundHistory}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="round" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dx={-10} />
                  <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                  <Line type="monotone" dataKey="accuracy" stroke="#4f46e5" strokeWidth={4}
                    dot={{ r: 6, fill: '#4f46e5', strokeWidth: 2, stroke: '#fff' }}
                    activeDot={{ r: 8, strokeWidth: 0 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-xl font-bold text-slate-900">Loss Reduction</h2>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-rose-500"></div>
              <span className="text-sm text-slate-500 font-medium">Loss</span>
            </div>
          </div>
          {stats.roundHistory.length === 0 ? (
            <div className="h-80 flex items-center justify-center text-slate-400">
              <div className="text-center">
                <TrendingUp size={40} className="mx-auto mb-3 opacity-30" />
                <p>No loss data yet</p>
                <p className="text-xs mt-1">Loss will appear after training starts</p>
              </div>
            </div>
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={stats.roundHistory}>
                  <defs>
                    <linearGradient id="colorLoss" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#f43f5e" stopOpacity={0.1} />
                      <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}   />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="round" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dx={-10} />
                  <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                  <Area type="monotone" dataKey="loss" stroke="#f43f5e" fillOpacity={1} fill="url(#colorLoss)" strokeWidth={3} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
