import React, { useEffect, useState } from 'react';
import {
  Download, Database, Calendar, HardDrive,
  Search, Activity, Loader2, Lock, Users, RefreshCw,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { apiClient } from '../config/api';
import { useAuth } from '../context/AuthContext';

interface ModelMetrics {
  finalAccuracy?:     number | null;
  finalLoss?:         number | null;
  roundsCompleted?:   number | null;
  totalParticipants?: number | null;
}

interface Model {
  modelId:      string;
  jobId:        string;
  version:      string;
  status:       string;
  architecture: string;
  sizeBytes:    number;
  participants: string[];
  metrics:      ModelMetrics;
  createdAt:    string;
}

function formatBytes(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

export default function Models() {
  const { user }  = useAuth();
  const [models,   setModels]   = useState<Model[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');
  const [downloading, setDownloading] = useState<string | null>(null);

  const fetchModels = async () => {
    try {
      const res = await apiClient.get('/api/models');
      setModels(res.data || []);
    } catch (err) {
      console.error('Failed to fetch models:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchModels();
    const interval = setInterval(fetchModels, 10000); // refresh every 10s
    return () => clearInterval(interval);
  }, []);

  const handleDownload = async (model: Model) => {
    setDownloading(model.modelId);
    try {
      const res = await apiClient.get(`/api/models/${model.modelId}/download`, {
        responseType: 'blob',
      });
      const url      = window.URL.createObjectURL(new Blob([res.data]));
      const link     = document.createElement('a');
      link.href      = url;
      link.download  = `${model.modelId}_v${model.version}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download failed:', err);
      alert('Download failed. Please try again.');
    } finally {
      setDownloading(null);
    }
  };

  const filtered = models.filter((m) =>
    m.modelId.toLowerCase().includes(search.toLowerCase()) ||
    m.jobId.toLowerCase().includes(search.toLowerCase()) ||
    m.architecture.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <header className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Model Repository</h1>
          <p className="text-slate-500 mt-1">
            Your trained federated models — available only to <span className="font-semibold">{user?.company}</span> and fellow participants.
          </p>
        </div>
        <div className="flex gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              placeholder="Search models..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none w-64"
            />
          </div>
          <button
            onClick={fetchModels}
            className="p-2 bg-white border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={20} />
          </button>
        </div>
      </header>

      {/* Privacy notice */}
      <div className="flex items-center gap-3 px-5 py-3 bg-violet-50 border border-violet-200 rounded-2xl text-sm text-violet-700">
        <Lock size={16} className="shrink-0" />
        <span>Only models from training sessions you participated in are shown here.</span>
      </div>

      {/* Model list */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <Loader2 className="animate-spin mr-3" size={24} />
          Loading models...
        </div>
      ) : filtered.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="text-center py-20 bg-white rounded-3xl border border-slate-100"
        >
          <Database size={48} className="mx-auto mb-4 text-slate-200" />
          <h3 className="text-lg font-bold text-slate-700 mb-1">
            {search ? 'No models match your search' : 'No models yet'}
          </h3>
          <p className="text-slate-400 text-sm">
            {search
              ? 'Try a different search term'
              : 'Complete a federated training session to see your model here'}
          </p>
        </motion.div>
      ) : (
        <div className="grid gap-4">
          <AnimatePresence>
            {filtered.map((m, i) => {
              const accuracy    = m.metrics.finalAccuracy;
              const rounds      = m.metrics.roundsCompleted;
              const isDownloading = downloading === m.modelId;

              return (
                <motion.div
                  key={m.modelId}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ delay: i * 0.05 }}
                  className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 hover:border-indigo-200 transition-all group"
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    {/* Left: icon + info */}
                    <div className="flex items-center gap-5">
                      <div className="bg-indigo-50 p-4 rounded-2xl text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors shrink-0">
                        <Database size={28} />
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-bold text-slate-900 text-lg">
                            {m.modelId.replace('model-', 'Model_')}
                          </h3>
                          <span className="px-2 py-0.5 bg-indigo-50 text-indigo-600 text-[10px] font-bold uppercase rounded-md tracking-wider">
                            PyTorch
                          </span>
                          <span className="px-2 py-0.5 bg-slate-100 text-slate-500 text-[10px] font-bold uppercase rounded-md tracking-wider">
                            {m.architecture}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-slate-400 font-medium flex-wrap">
                          <div className="flex items-center gap-1">
                            <Calendar size={14} />
                            {formatDate(m.createdAt)}
                          </div>
                          <div className="flex items-center gap-1">
                            <HardDrive size={14} />
                            {formatBytes(m.sizeBytes)}
                          </div>
                          {accuracy != null && (
                            <div className="flex items-center gap-1 text-emerald-600 font-semibold">
                              <Activity size={14} />
                              {(accuracy * 100).toFixed(1)}% Accuracy
                            </div>
                          )}
                          <div className="flex items-center gap-1 text-slate-400">
                            <Users size={14} />
                            {m.participants.length} participants
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Right: rounds + download */}
                    <div className="flex items-center gap-4 shrink-0">
                      {rounds != null && (
                        <div className="text-right hidden lg:block mr-2">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Rounds</p>
                          <p className="font-bold text-slate-700 text-lg">{rounds}</p>
                        </div>
                      )}
                      {m.metrics.finalLoss != null && (
                        <div className="text-right hidden lg:block mr-2">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Loss</p>
                          <p className="font-bold text-slate-700 text-lg">{m.metrics.finalLoss.toFixed(4)}</p>
                        </div>
                      )}
                      <button
                        onClick={() => handleDownload(m)}
                        disabled={isDownloading}
                        className="flex items-center justify-center gap-2 bg-slate-900 text-white px-6 py-3 rounded-2xl font-bold hover:bg-slate-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed min-w-[140px]"
                      >
                        {isDownloading ? (
                          <><Loader2 className="animate-spin" size={18} /> Downloading...</>
                        ) : (
                          <><Download size={18} /> Download</>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Participants row */}
                  <div className="mt-4 pt-4 border-t border-slate-50 flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-slate-400 font-medium">Participants:</span>
                    {m.participants.map((p) => (
                      <span key={p} className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded-lg font-medium">
                        {p}
                      </span>
                    ))}
                    <span className="ml-auto text-xs text-slate-400">v{m.version}</span>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Info footer */}
      <div className="bg-indigo-50 p-8 rounded-[2.5rem] border border-indigo-100 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-indigo-200">
            <Lock size={24} />
          </div>
          <div>
            <h4 className="font-bold text-indigo-900">Federated Privacy Guarantee</h4>
            <p className="text-sm text-indigo-700">
              Global models are produced using secure aggregation — your raw data never left your device.
            </p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-indigo-500 font-bold uppercase tracking-widest">Total Models</p>
          <p className="text-3xl font-black text-indigo-700">{models.length}</p>
        </div>
      </div>
    </div>
  );
}
