import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, ArrowRight, ShieldCheck, Building2 } from 'lucide-react';
import { motion } from 'motion/react';

const DEMO_ACCOUNTS = [
  { id: 'alpha', name: 'Alpha Corp',     email: 'alpha@demo.com', color: 'bg-indigo-600 hover:bg-indigo-500' },
  { id: 'beta',  name: 'Beta Industries', email: 'beta@demo.com',  color: 'bg-emerald-600 hover:bg-emerald-500' },
  { id: 'gamma', name: 'Gamma Systems',   email: 'gamma@demo.com', color: 'bg-purple-600 hover:bg-purple-500' },
];

export default function Login() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('demo123');
  const { login, isLoading, error } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      // Error displayed via AuthContext error state
    }
  };

  // Quick login - clicks a demo account button
  const quickLogin = async (acc: typeof DEMO_ACCOUNTS[0]) => {
    setEmail(acc.email);
    try {
      await login(acc.email, 'demo123');
      navigate('/');
    } catch (err) {
      // Error displayed via AuthContext error state
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden -z-10">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600/20 rounded-full blur-[120px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-600/20 rounded-full blur-[120px]"></div>
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md"
      >
        <div className="bg-slate-900 border border-slate-800 p-10 rounded-[2.5rem] shadow-2xl">
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-xl shadow-indigo-500/20 mb-6">
              <ShieldCheck className="text-white" size={32} />
            </div>
            <h2 className="text-3xl font-bold text-white tracking-tight">Welcome Back</h2>
            <p className="text-slate-400 mt-2 text-center">Federated Learning Control Center</p>
          </div>

          {/* Quick Login Buttons */}
          <div className="mb-6">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3 text-center">
              Quick Sign In
            </p>
            <div className="space-y-2">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.id}
                  type="button"
                  onClick={() => quickLogin(acc)}
                  disabled={isLoading}
                  className={`w-full ${acc.color} disabled:opacity-50 disabled:cursor-not-allowed text-white py-3 rounded-xl font-medium transition-all flex items-center justify-between px-5 group`}
                >
                  <div className="flex items-center gap-3">
                    <Building2 size={18} />
                    <span>{acc.name}</span>
                  </div>
                  <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                </button>
              ))}
            </div>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 my-6">
            <div className="h-px bg-slate-800 flex-1"></div>
            <span className="text-xs text-slate-600 uppercase tracking-widest">or manually</span>
            <div className="h-px bg-slate-800 flex-1"></div>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Email</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                <input
                  type="text"
                  placeholder="alpha@demo.com or alpha"
                  className="w-full pl-12 pr-4 py-3 bg-slate-800/50 border border-slate-700 rounded-xl text-white placeholder:text-slate-600 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Password</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                <input
                  type="password"
                  placeholder="demo123"
                  className="w-full pl-12 pr-4 py-3 bg-slate-800/50 border border-slate-700 rounded-xl text-white placeholder:text-slate-600 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading || !email || !password}
              className="w-full bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:cursor-not-allowed text-white py-3 rounded-xl font-medium transition-all flex items-center justify-center gap-2"
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-slate-500">
            Demo credentials: any of <span className="text-indigo-400">alpha</span> · <span className="text-emerald-400">beta</span> · <span className="text-purple-400">gamma</span> with password <span className="text-slate-300">demo123</span>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
