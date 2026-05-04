import React, { useState } from 'react';
import { ShieldCheck, ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';

// The 3 fixed participant IDs for your capstone project
const PARTICIPANTS = [
  {
    id:    'alpha',
    name:  'Participant Alpha',
    color: 'border-indigo-500 bg-indigo-50 hover:bg-indigo-100',
    badge: 'bg-indigo-600',
    ring:  'ring-indigo-500',
  },
  {
    id:    'beta',
    name:  'Participant Beta',
    color: 'border-emerald-500 bg-emerald-50 hover:bg-emerald-100',
    badge: 'bg-emerald-600',
    ring:  'ring-emerald-500',
  },
  {
    id:    'gamma',
    name:  'Participant Gamma',
    color: 'border-purple-500 bg-purple-50 hover:bg-purple-100',
    badge: 'bg-purple-600',
    ring:  'ring-purple-500',
  },
];

interface Props {
  onSelect: (participantId: string) => void;
}

export default function ParticipantPicker({ onSelect }: Props) {
  const [selected, setSelected] = useState<string | null>(null);

  const confirm = () => {
    if (selected) onSelect(selected);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600/20 rounded-full blur-[120px] -z-10"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-600/20 rounded-full blur-[120px] -z-10"></div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md"
      >
        <div className="bg-slate-900 border border-slate-800 p-10 rounded-[2.5rem] shadow-2xl">
          {/* Header */}
          <div className="flex flex-col items-center mb-10">
            <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-xl shadow-indigo-500/20 mb-6">
              <ShieldCheck className="text-white" size={32} />
            </div>
            <h2 className="text-2xl font-bold text-white tracking-tight text-center">
              FL-IDS Control Center
            </h2>
            <p className="text-slate-400 mt-2 text-center text-sm">
              Select your participant ID to continue.<br />
              <span className="text-slate-500 text-xs">This is saved on your device — you only pick once.</span>
            </p>
          </div>

          {/* Participant cards */}
          <div className="space-y-3 mb-8">
            {PARTICIPANTS.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelected(p.id)}
                className={`
                  w-full p-5 rounded-2xl border-2 transition-all text-left flex items-center gap-4
                  ${selected === p.id
                    ? `${p.color} ${p.ring} ring-2`
                    : 'border-slate-700 bg-slate-800/50 hover:bg-slate-800'}
                `}
              >
                <div className={`w-10 h-10 ${p.badge} rounded-xl flex items-center justify-center text-white font-bold text-lg`}>
                  {p.id[0].toUpperCase()}
                </div>
                <div>
                  <p className={`font-bold ${selected === p.id ? 'text-slate-900' : 'text-white'}`}>
                    {p.name}
                  </p>
                  <p className={`text-xs ${selected === p.id ? 'text-slate-600' : 'text-slate-500'}`}>
                    ID: {p.id}
                  </p>
                </div>
                {selected === p.id && (
                  <div className="ml-auto w-5 h-5 rounded-full bg-white border-2 border-indigo-500 flex items-center justify-center">
                    <div className="w-2.5 h-2.5 rounded-full bg-indigo-600"></div>
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* Confirm button */}
          <button
            onClick={confirm}
            disabled={!selected}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white py-4 rounded-2xl font-bold text-lg transition-all flex items-center justify-center gap-2 group"
          >
            Enter as {selected ? PARTICIPANTS.find(p => p.id === selected)?.name : '...'}
            <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
          </button>

          <p className="mt-4 text-center text-xs text-slate-600">
            Your ID is stored locally. Clear browser data to reset.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
