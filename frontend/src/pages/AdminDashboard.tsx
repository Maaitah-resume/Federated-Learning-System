import React, { useEffect, useState } from 'react';
import {
  Settings, Users, BarChart2, Save, Plus, Trash2,
  ShieldCheck, Loader2, CheckCircle2, RefreshCw, AlertCircle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { apiClient } from '../config/api';

interface Config {
  MIN_CLIENTS:    number;
  DEFAULT_ROUNDS: number;
  LEARNING_RATE:  number;
}

interface User {
  companyId:   string;
  companyName: string;
  email:       string;
  role:        string;
  isActive:    boolean;
  createdAt:   string;
}

interface Stats {
  totalUsers:  number;
  totalModels: number;
  totalJobs:   number;
  config:      Config;
}

function StatBox({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className={`${color} p-6 rounded-2xl text-white`}>
      <p className="text-xs font-bold uppercase tracking-widest opacity-80 mb-2">{label}</p>
      <p className="text-4xl font-black">{value}</p>
    </div>
  );
}

export default function AdminDashboard() {
  const [stats,       setStats]       = useState<Stats | null>(null);
  const [config,      setConfig]      = useState<Config>({ MIN_CLIENTS: 3, DEFAULT_ROUNDS: 10, LEARNING_RATE: 0.001 });
  const [users,       setUsers]       = useState<User[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [saveMsg,     setSaveMsg]     = useState<string | null>(null);
  const [activeTab,   setActiveTab]   = useState<'config' | 'users'>('config');

  // New user form
  const [newUser, setNewUser] = useState({ companyId: '', companyName: '', email: '', password: '', role: 'client' });
  const [addingUser, setAddingUser] = useState(false);
  const [addMsg,     setAddMsg]     = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchAll = async () => {
    try {
      const [statsRes, usersRes] = await Promise.all([
        apiClient.get('/api/admin/stats'),
        apiClient.get('/api/admin/users'),
      ]);
      setStats(statsRes.data);
      setConfig(statsRes.data.config);
      setUsers(usersRes.data);
    } catch (err) {
      console.error('Admin fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  const saveConfig = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      await apiClient.put('/api/admin/config', config);
      setSaveMsg('Settings saved successfully!');
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (err: any) {
      setSaveMsg(err.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const addUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddingUser(true);
    setAddMsg(null);
    try {
      await apiClient.post('/api/admin/users', newUser);
      setAddMsg({ type: 'ok', text: `User "${newUser.companyName}" added successfully!` });
      setNewUser({ companyId: '', companyName: '', email: '', password: '', role: 'client' });
      await fetchAll();
    } catch (err: any) {
      setAddMsg({ type: 'err', text: err.response?.data?.error || 'Failed to add user' });
    } finally {
      setAddingUser(false);
    }
  };

  const deleteUser = async (companyId: string) => {
    if (!confirm(`Delete user "${companyId}"? This cannot be undone.`)) return;
    setDeletingId(companyId);
    try {
      await apiClient.delete(`/api/admin/users/${companyId}`);
      await fetchAll();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="animate-spin text-indigo-600" size={32} />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8 p-8">

      {/* Header */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Admin Dashboard</h1>
          <p className="text-slate-500 mt-1">Manage system settings, training parameters and users.</p>
        </div>
        <button onClick={fetchAll} className="p-2 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">
          <RefreshCw size={20} className="text-slate-500" />
        </button>
      </header>

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatBox label="Client Users"    value={stats?.totalUsers  ?? 0} color="bg-indigo-600" />
        <StatBox label="Trained Models"  value={stats?.totalModels ?? 0} color="bg-emerald-600" />
        <StatBox label="Training Jobs"   value={stats?.totalJobs   ?? 0} color="bg-violet-600" />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 bg-slate-100 p-1 rounded-2xl w-fit">
        {(['config', 'users'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-2.5 rounded-xl font-bold text-sm transition-all capitalize ${
              activeTab === tab
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab === 'config' ? '⚙️ Training Config' : '👥 Manage Users'}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">

        {/* ── CONFIG TAB ── */}
        {activeTab === 'config' && (
          <motion.div
            key="config"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden"
          >
            <div className="p-8 border-b border-slate-50 flex items-center gap-3">
              <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
                <Settings size={22} className="text-indigo-600" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">Training Parameters</h2>
                <p className="text-xs text-slate-400 mt-0.5">Changes take effect on the next training session</p>
              </div>
            </div>

            <div className="p-8 space-y-8">

              {/* MIN_CLIENTS */}
              <div className="flex flex-col md:flex-row md:items-center gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-bold text-slate-700 mb-1">
                    Minimum Participants to Start Training
                  </label>
                  <p className="text-xs text-slate-400">
                    Training auto-starts when this many users join the waiting room.
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => setConfig(c => ({ ...c, MIN_CLIENTS: Math.max(2, c.MIN_CLIENTS - 1) }))}
                    className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 font-bold text-lg transition-colors"
                  >−</button>
                  <div className="w-20 text-center">
                    <span className="text-3xl font-black text-indigo-600">{config.MIN_CLIENTS}</span>
                    <p className="text-xs text-slate-400">users</p>
                  </div>
                  <button
                    onClick={() => setConfig(c => ({ ...c, MIN_CLIENTS: Math.min(10, c.MIN_CLIENTS + 1) }))}
                    className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 font-bold text-lg transition-colors"
                  >+</button>
                </div>
              </div>

              <hr className="border-slate-100" />

              {/* DEFAULT_ROUNDS */}
              <div className="flex flex-col md:flex-row md:items-center gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-bold text-slate-700 mb-1">
                    Number of Training Rounds
                  </label>
                  <p className="text-xs text-slate-400">
                    How many federated rounds to run per training session (1–50).
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => setConfig(c => ({ ...c, DEFAULT_ROUNDS: Math.max(1, c.DEFAULT_ROUNDS - 1) }))}
                    className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 font-bold text-lg transition-colors"
                  >−</button>
                  <div className="w-20 text-center">
                    <span className="text-3xl font-black text-emerald-600">{config.DEFAULT_ROUNDS}</span>
                    <p className="text-xs text-slate-400">rounds</p>
                  </div>
                  <button
                    onClick={() => setConfig(c => ({ ...c, DEFAULT_ROUNDS: Math.min(50, c.DEFAULT_ROUNDS + 1) }))}
                    className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 font-bold text-lg transition-colors"
                  >+</button>
                </div>
              </div>

              <hr className="border-slate-100" />

              {/* LEARNING_RATE */}
              <div className="flex flex-col md:flex-row md:items-center gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-bold text-slate-700 mb-1">
                    Learning Rate
                  </label>
                  <p className="text-xs text-slate-400">
                    Controls how fast the model learns each round. Lower = more stable.
                  </p>
                </div>
                <div className="shrink-0 w-full md:w-64">
                  <input
                    type="range"
                    min="0.0001"
                    max="0.01"
                    step="0.0001"
                    value={config.LEARNING_RATE}
                    onChange={(e) => setConfig(c => ({ ...c, LEARNING_RATE: parseFloat(e.target.value) }))}
                    className="w-full accent-violet-600"
                  />
                  <div className="flex justify-between text-xs text-slate-400 mt-1">
                    <span>0.0001</span>
                    <span className="font-bold text-violet-600 text-sm">{config.LEARNING_RATE}</span>
                    <span>0.01</span>
                  </div>
                </div>
              </div>

              {/* Save button */}
              <div className="flex items-center justify-between pt-4">
                {saveMsg && (
                  <motion.div
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={`flex items-center gap-2 text-sm font-medium ${
                      saveMsg.includes('success') ? 'text-emerald-600' : 'text-red-500'
                    }`}
                  >
                    {saveMsg.includes('success')
                      ? <CheckCircle2 size={16} />
                      : <AlertCircle size={16} />
                    }
                    {saveMsg}
                  </motion.div>
                )}
                <button
                  onClick={saveConfig}
                  disabled={saving}
                  className="ml-auto flex items-center gap-2 bg-slate-900 text-white px-6 py-3 rounded-2xl font-bold hover:bg-slate-800 transition-colors disabled:opacity-60"
                >
                  {saving
                    ? <><Loader2 className="animate-spin" size={18} /> Saving...</>
                    : <><Save size={18} /> Save Settings</>
                  }
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* ── USERS TAB ── */}
        {activeTab === 'users' && (
          <motion.div
            key="users"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
          >
            {/* Add User Form */}
            <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="p-6 border-b border-slate-50 flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center">
                  <Plus size={22} className="text-emerald-600" />
                </div>
                <h2 className="text-xl font-bold text-slate-900">Add New User</h2>
              </div>

              <form onSubmit={addUser} className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  { label: 'User ID', key: 'companyId',   placeholder: 'e.g. khalid', type: 'text' },
                  { label: 'Full Name', key: 'companyName', placeholder: 'e.g. Khalid HTU', type: 'text' },
                  { label: 'Email',    key: 'email',       placeholder: 'Khalid@htu.edu.jo', type: 'email' },
                  { label: 'Password', key: 'password',    placeholder: '••••••', type: 'password' },
                ].map(({ label, key, placeholder, type }) => (
                  <div key={key}>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 block">{label}</label>
                    <input
                      type={type}
                      placeholder={placeholder}
                      required
                      value={(newUser as any)[key]}
                      onChange={(e) => setNewUser(u => ({ ...u, [key]: e.target.value }))}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    />
                  </div>
                ))}

                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 block">Role</label>
                  <select
                    value={newUser.role}
                    onChange={(e) => setNewUser(u => ({ ...u, role: e.target.value }))}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                  >
                    <option value="client">Client</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>

                <div className="flex items-end">
                  <button
                    type="submit"
                    disabled={addingUser}
                    className="w-full flex items-center justify-center gap-2 bg-emerald-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-emerald-700 transition-colors disabled:opacity-60"
                  >
                    {addingUser
                      ? <><Loader2 className="animate-spin" size={18} /> Adding...</>
                      : <><Plus size={18} /> Add User</>
                    }
                  </button>
                </div>

                {addMsg && (
                  <div className={`md:col-span-2 flex items-center gap-2 text-sm font-medium px-4 py-3 rounded-xl ${
                    addMsg.type === 'ok'
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-red-50 text-red-600'
                  }`}>
                    {addMsg.type === 'ok'
                      ? <CheckCircle2 size={16} />
                      : <AlertCircle size={16} />
                    }
                    {addMsg.text}
                  </div>
                )}
              </form>
            </div>

            {/* Users List */}
            <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="p-6 border-b border-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
                    <Users size={22} className="text-indigo-600" />
                  </div>
                  <h2 className="text-xl font-bold text-slate-900">All Users</h2>
                </div>
                <span className="text-xs font-bold text-slate-400 bg-slate-100 px-3 py-1 rounded-full">
                  {users.length} total
                </span>
              </div>

              <div className="divide-y divide-slate-50">
                {users.map((user) => (
                  <motion.div
                    key={user.companyId}
                    layout
                    className="flex items-center justify-between p-5 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black text-white ${
                        user.role === 'admin' ? 'bg-violet-600' : 'bg-indigo-600'
                      }`}>
                        {user.companyName[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="font-bold text-slate-900 text-sm">
                          {user.companyName}
                          {user.role === 'admin' && (
                            <span className="ml-2 px-1.5 py-0.5 bg-violet-100 text-violet-700 text-[10px] font-bold rounded uppercase">admin</span>
                          )}
                        </p>
                        <p className="text-xs text-slate-400">{user.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`w-2 h-2 rounded-full ${user.isActive ? 'bg-emerald-500' : 'bg-slate-300'}`}></span>
                      <span className="text-xs text-slate-400 hidden sm:block">
                        {new Date(user.createdAt).toLocaleDateString()}
                      </span>
                      {user.role !== 'admin' && (
                        <button
                          onClick={() => deleteUser(user.companyId)}
                          disabled={deletingId === user.companyId}
                          className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40"
                          title="Delete user"
                        >
                          {deletingId === user.companyId
                            ? <Loader2 className="animate-spin" size={16} />
                            : <Trash2 size={16} />
                          }
                        </button>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
