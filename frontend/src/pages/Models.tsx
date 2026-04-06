import React from 'react';
import { Download, Database, Calendar, HardDrive, Search, Filter, ChevronRight, Activity } from 'lucide-react';
import { motion } from 'motion/react';

const models = [
  { id: 1, name: 'Global_Model_v6_Final', date: '2026-04-01', size: '42.4 MB', accuracy: '91.2%', rounds: 10, type: 'PyTorch' },
  { id: 2, name: 'Global_Model_v5_Stable', date: '2026-03-28', size: '41.8 MB', accuracy: '88.5%', rounds: 10, type: 'TensorFlow' },
  { id: 3, name: 'Global_Model_v4_Base', date: '2026-03-25', size: '41.2 MB', accuracy: '84.1%', rounds: 8, type: 'PyTorch' },
  { id: 4, name: 'Global_Model_v3_Initial', date: '2026-03-20', size: '38.9 MB', accuracy: '76.4%', rounds: 5, type: 'PyTorch' },
];

export default function Models() {
  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <header className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Model Repository</h1>
          <p className="text-slate-500 mt-1">Access and download previously aggregated global models.</p>
        </div>
        <div className="flex gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input 
              type="text" 
              placeholder="Search models..."
              className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none w-64"
            />
          </div>
          <button className="p-2 bg-white border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50">
            <Filter size={20} />
          </button>
        </div>
      </header>

      <div className="grid gap-4">
        {models.map((m, i) => (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            key={m.id} 
            className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 flex flex-col md:flex-row md:items-center justify-between hover:border-indigo-200 transition-all group"
          >
            <div className="flex items-center gap-6">
              <div className="bg-indigo-50 p-4 rounded-2xl text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                <Database size={28} />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-slate-900 text-lg">{m.name}</h3>
                  <span className="px-2 py-0.5 bg-slate-100 text-slate-500 text-[10px] font-bold uppercase rounded-md tracking-wider">{m.type}</span>
                </div>
                <div className="flex items-center gap-4 text-sm text-slate-400 font-medium">
                  <div className="flex items-center gap-1">
                    <Calendar size={14} />
                    {m.date}
                  </div>
                  <div className="flex items-center gap-1">
                    <HardDrive size={14} />
                    {m.size}
                  </div>
                  <div className="flex items-center gap-1 text-emerald-600">
                    <Activity size={14} />
                    {m.accuracy} Accuracy
                  </div>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-4 mt-6 md:mt-0">
              <div className="text-right hidden lg:block mr-4">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Rounds</p>
                <p className="font-bold text-slate-700">{m.rounds}</p>
              </div>
              <button className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-slate-900 text-white px-6 py-3 rounded-2xl font-bold hover:bg-slate-800 transition-colors">
                <Download size={18} />
                <span>Download</span>
              </button>
              <button className="p-3 text-slate-400 hover:text-indigo-600 transition-colors">
                <ChevronRight size={20} />
              </button>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="bg-indigo-50 p-8 rounded-[2.5rem] border border-indigo-100 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-indigo-200">
            <Database size={24} />
          </div>
          <div>
            <h4 className="font-bold text-indigo-900">Automated Backups</h4>
            <p className="text-sm text-indigo-700">Global models are automatically versioned and backed up after every 10 rounds.</p>
          </div>
        </div>
        <button className="text-indigo-600 font-bold text-sm hover:underline">Configure Backup Policy</button>
      </div>
    </div>
  );
}
