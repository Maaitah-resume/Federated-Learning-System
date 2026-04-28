import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Mail, ArrowRight, ShieldCheck, Building2 } from 'lucide-react';
import { motion } from 'motion/react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const { login, isLoading, error } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // Backend login(email, password) - we send email as identifier
      // companyId is also accepted as email field by backend
      await login(email || company, 'demo');
      navigate('/');
    } catch (err) {
      // Error shown via AuthContext error state
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
          <div className="flex flex-col items-center mb-10">
            <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-xl shadow-indigo-500/20 mb-6">
              <ShieldCheck className="text-white" size={32} />
            </div>
            <h2 className="text-3xl font-bold text-white tracking-tight">Welcome Back</h2>
            <p className="text-slate-400 mt-2 text-center">Access the Federated Learning Control Center</p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Company Name</label>
              <div className="relative">
                <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={20} />
                <input
                  type="text"
                  placeholder="e.g. TechCorp AI"
                  className="w-full pl-12 pr-4 py-4 bg-slate-800/50 border border-slate-700 rounded-2xl text-white placeholder:text-slate-600 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  disabled={isLoading}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={20} />
                <input
                  type="text"
                  placeholder="name@company.com  or just type anything"
                  className="w-full pl-12 pr-4 py-4 bg-slate-800/50 border border-slate-700 rounded-2xl text-white placeholder:text-slate-600 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                />
              </div>
              <p className="text-xs text-slate-500 ml-1">Enter your email OR company name — either works!</p>
            </div>

            <button
              type="submit"
              disabled={isLoading || (!email && !company)}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 disabled:cursor-not-allowed text-white py-4 rounded-2xl font-bold text-lg transition-all flex items-center justify-center gap-2 group shadow-xl shadow-indigo-500/20"
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
              {!isLoading && <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />}
            </button>
          </form>

          <div className="mt-6 text-center text-xs text-slate-500 space-y-1">
            <p>Demo: enter <span className="text-indigo-400">alpha@demo.com</span> to sign in as Alpha Corp</p>
            <p>Or enter any email — account is created automatically</p>
          </div>

          <div className="mt-8 pt-8 border-t border-slate-800 flex justify-center gap-6">
            {[['128k','Nodes'],['99.9%','Uptime'],['AES','Secure']].map(([val, label]) => (
              <div key={label} className="flex flex-col items-center">
                <span className="text-white font-bold">{val}</span>
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
