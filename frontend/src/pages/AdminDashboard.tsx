import React, { useEffect, useState } from 'react';
import {
  Settings, Users, Save, Plus, Trash2,
  Loader2, CheckCircle2, RefreshCw, AlertCircle, Activity,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { apiClient } from '../config/api';

interface Config {
  MIN_CLIENTS:    number;
  DEFAULT_ROUNDS: number;
  LEARNING_RATE:  number;
}

interface UserItem {
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

function StatBox({ label, value, bg }: { label: string; value: string | number; bg: string }) {
  return (
    <div className={`${bg} p-6 rounded-2xl text-white`}>
      <p className="text-xs font-bold uppercase tracking-widest opacity-70 mb-2">{label}</p>
      <p className="text-4xl font-black">{value}</p>
    </div>
  );
}

export default function AdminDashboard() {
  const [stats,       setStats]     = useState<Stats | null>(null);
  const [config,      setConfig]    = useState<Config>({ MIN_CLIENTS: 3, DEFAULT_ROUNDS: 10, LEARNING_RATE: 0.001 });
  const [users,       setUsers]     = useState<UserItem[]>([]);
  const [loading,     setLoading]   = useState(true);
  const [saving,      setSaving]    = useState(false);
  const [saveMsg,     setSaveMsg]   = useState<string | null>(null);
  const [activeTab,   setActiveTab] = useState<'config' | 'users'>('config');
  const [deletingId,  setDeletingId] = useState<string | null>(null);
  const [addingUser,  setAddingUser] = useState(false);
  const [addMsg,      setAddMsg]    = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [newUser,     setNewUser]   = useState({
    companyId: '', companyName: '', email: '', password: '', role: 'client',
  });

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
      setSaveMsg('Settings saved!');
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
      setAddMsg({ type: 'ok', text: `User "${newUser.companyName}" added!` });
      setNewUser({ companyId: '', companyName: '', email: '', password: '', role: 'client' });
      await fetchAll();
    } catch (err: any) {
      setAddMsg({ type: 'err', text: err.response?.data?.error || 'Failed to add user' });
    } finally {
      setAddingUser(false);
    }
  };

  const deleteUser = async (companyId: string) => {
    if (!window.confirm(`Delete user "${companyId}"?`)) return;
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
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-indigo-600" size={32} />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8 p-8">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Admin Dashboard</h1>
          <p className="text-slate-500 mt-1">Manage training parameters and system users.</p>
        </div>
        <button
          onClick={fetchAll}
          className="p-2 bg-white border border-slate-200 rounded-xl hover:bg-slate-50"
        >
          <RefreshCw size={20} className="text-slate-500" />
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatBox label="Client Users"   value={stats?.totalUsers  ?? 0} bg="bg-indigo-600" />
        <StatBox label="Trained Models" value={stats?.totalModels ?? 0} bg="bg-emerald-600" />
        <StatBox label="Training Jobs"  value={stats?.totalJobs   ?? 0} bg="bg-violet-600" />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 bg-slate-100 p-1 rounded-2xl w-fit">
        {(['config', 'users'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-2.5 rounded-xl font-bold text-sm transition-all ${
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

        {/* CONFIG TAB */}
        {activeTab === 'config' && (
          <motion.div
            key="config"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-white rounded-3xl shadow-sm border border-slate-100"
          >
            <div className="p-8 border-b border-slate-50 flex items-center gap-3">
              <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
                <Settings size={20} className="text-indigo-600" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">Training Parameters</h2>
                <p className="text-xs text-slate-400">Changes apply to the next training session</p>
              </div>
            </div>

            <div className="p-8 space-y-8">

              {/* MIN_CLIENTS */}
              <div className="flex flex-col md:flex-row md:items-center gap-4">
                <div className="flex-1">
                  <p className="font-bold text-slate-800 text-sm">Minimum Participants to Start</p>
                  <p className="text-xs text-slate-400 mt-0.5">Training auto-starts when this many users join.</p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setConfig(c => ({ ...c, MIN_CLIENTS: Math.max(2, c.MIN_CLIENTS - 1) }))}
                    className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 font-bold text-lg"
                  >−</button>
                  <div className="w-16 text-center">
                    <p className="text-3xl font-black text-indigo-600">{config.MIN_CLIENTS}</p>
                    <p className="text-[10px] text-slate-400">users</p>
                  </div>
                  <button
                    onClick={() => setConfig(c => ({ ...c, MIN_CLIENTS: Math.min(10, c.MIN_CLIENTS + 1) }))}
                    className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 font-bold text-lg"
                  >+</button>
                </div>
              </div>

              <hr className="border-slate-100" />

              {/* DEFAULT_ROUNDS */}
              <div className="flex flex-col md:flex-row md:items-center gap-4">
                <div className="flex-1">
                  <p className="font-bold text-slate-800 text-sm">Number of Training Rounds</p>
                  <p className="text-xs text-slate-400 mt-0.5">Federated rounds per session (1–50).</p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setConfig(c => ({ ...c, DEFAULT_ROUNDS: Math.max(1, c.DEFAULT_ROUNDS - 1) }))}
                    className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 font-bold text-lg"
                  >−</button>
                  <div className="w-16 text-center">
                    <p className="text-3xl font-black text-emerald-600">{config.DEFAULT_ROUNDS}</p>
                    <p className="text-[10px] text-slate-400">rounds</p>
                  </div>
                  <button
                    onClick={() => setConfig(c => ({ ...c, DEFAULT_ROUNDS: Math.min(50, c.DEFAULT_ROUNDS + 1) }))}
                    className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 font-bold text-lg"
                  >+</button>
                </div>
              </div>

              <hr className="border-slate-100" />

              {/* LEARNING_RATE */}
              <div className="flex flex-col md:flex-row md:items-center gap-4">
                <div className="flex-1">
                  <p className="font-bold text-slate-800 text-sm">Learning Rate</p>
                  <p className="text-xs text-slate-400 mt-0.5">Controls learning speed. Lower = more stable.</p>
                </div>
                <div className="w-full md:w-64">
                  <input
                    type="range" min="0.0001" max="0.01" step="0.0001"
                    value={config.LEARNING_RATE}
                    onChange={(e) => setConfig(c => ({ ...c, LEARNING_RATE: parseFloat(e.target.value) }))}
                    className="w-full accent-violet-600"
                  />
                  <div className="flex justify-between text-xs text-slate-400 mt-1">
                    <span>0.0001</span>
                    <span className="font-bold text-violet-600">{config.LEARNING_RATE}</span>
                    <span>0.01</span>
                  </div>
                </div>
              </div>

              {/* Save */}
              <div className="flex items-center justify-between pt-2">
                {saveMsg && (
                  <span className={`flex items-center gap-2 text-sm font-medium ${
                    saveMsg.includes('saved') ? 'text-emerald-600' : 'text-red-500'
                  }`}>
                    {saveMsg.includes('saved') ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                    {saveMsg}
                  </span>
                )}
                <button
                  onClick={saveConfig}
                  disabled={saving}
                  className="ml-auto flex items-center gap-2 bg-slate-900 text-white px-6 py-3 rounded-2xl font-bold hover:bg-slate-800 disabled:opacity-60"
                >
                  {saving ? <><Loader2 className="animate-spin" size={18} />Saving...</> : <><Save size={18} />Save Settings</>}
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* USERS TAB */}
        {activeTab === 'users' && (
          <motion.div
            key="users"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
          >
            {/* Add User */}
            <div className="bg-white rounded-3xl shadow-sm border border-slate-100">
              <div className="p-6 border-b border-slate-50 flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center">
                  <Plus size={20} className="text-emerald-600" />
                </div>
                <h2 className="text-xl font-bold text-slate-900">Add New User</h2>
              </div>
              <form onSubmit={addUser} className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                {([
                  { label: 'User ID',    key: 'companyId',   ph: 'e.g. khalid',         type: 'text'     },
                  { label: 'Full Name',  key: 'companyName', ph: 'e.g. Khalid HTU',     type: 'text'     },
                  { label: 'Email',      key: 'email',       ph: 'Khalid@htu.edu.jo',   type: 'email'    },
                  { label: 'Password',   key: 'password',    ph: '••••••',              type: 'password' },
                ] as const).map(({ label, key, ph, type }) => (
                  <div key={key}>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 block">{label}</label>
                    <input
                      type={type} placeholder={ph} required
                      value={(newUser as any)[key]}
                      onChange={(e) => setNewUser(u => ({ ...u, [key]: e.target.value }))}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                ))}

                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 block">Role</label>
                  <select
                    value={newUser.role}
                    onChange={(e) => setNewUser(u => ({ ...u, role: e.target.value }))}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none"
                  >
                    <option value="client">Client</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>

                <div className="flex items-end">
                  <button
                    type="submit" disabled={addingUser}
                    className="w-full flex items-center justify-center gap-2 bg-emerald-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {addingUser ? <><Loader2 className="animate-spin" size={18} />Adding...</> : <><Plus size={18} />Add User</>}
                  </button>
                </div>

                {addMsg && (
                  <div className={`md:col-span-2 flex items-center gap-2 text-sm px-4 py-3 rounded-xl font-medium ${
                    addMsg.type === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                  }`}>
                    {addMsg.type === 'ok' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                    {addMsg.text}
                  </div>
                )}
              </form>
            </div>

            {/* Users List */}
            <div className="bg-white rounded-3xl shadow-sm border border-slate-100">
              <div className="p-6 border-b border-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
                    <Users size={20} className="text-indigo-600" />
                  </div>
                  <h2 className="text-xl font-bold text-slate-900">All Users</h2>
                </div>
                <span className="text-xs font-bold text-slate-400 bg-slate-100 px-3 py-1 rounded-full">
                  {users.length} total
                </span>
              </div>
              <div className="divide-y divide-slate-50">
                {users.map((u) => (
                  <div key={u.companyId} className="flex items-center justify-between p-5 hover:bg-slate-50">
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black text-white ${
                        u.role === 'admin' ? 'bg-violet-600' : 'bg-indigo-600'
                      }`}>
                        {u.companyName[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="font-bold text-slate-900 text-sm">
                          {u.companyName}
                          {u.role === 'admin' && (
                            <span className="ml-2 px-1.5 py-0.5 bg-violet-100 text-violet-700 text-[10px] font-bold rounded uppercase">
                              admin
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-slate-400">{u.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${u.isActive ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                      {u.role !== 'admin' && (
                        <button
                          onClick={() => deleteUser(u.companyId)}
                          disabled={deletingId === u.companyId}
                          className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          {deletingId === u.companyId
                            ? <Loader2 className="animate-spin" size={16} />
                            : <Trash2 size={16} />
                          }
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
