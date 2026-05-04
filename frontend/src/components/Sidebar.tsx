import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Users, Database, LogOut, Activity } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useQueue } from '../context/QueueContext';
import { cn } from '../lib/utils';

const navItems = [
  { icon: LayoutDashboard, label: 'Overview',         path: '/'       },
  { icon: Users,           label: 'Node Queue',       path: '/queue'  },
  { icon: Database,        label: 'Model Repository', path: '/models' },
];

export default function Sidebar() {
  const { user, logout } = useAuth();
  const { inQueue, queue } = useQueue();

  return (
    <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col h-screen sticky top-0 border-r border-slate-800">
      <div className="p-6">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center">
            <Activity className="text-white" size={24} />
          </div>
          <div>
            <h1 className="text-white font-bold text-lg leading-tight">FL System</h1>
            <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Federated Learning</p>
          </div>
        </div>
        <nav className="space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) => cn(
                'flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 group',
                isActive
                  ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-600/20'
                  : 'hover:bg-slate-800 hover:text-white'
              )}
            >
              <item.icon size={20} className="transition-colors group-hover:text-indigo-400" />
              <span className="font-medium flex-1">{item.label}</span>
              {item.path === '/queue' && inQueue && (
                <span className="text-xs bg-emerald-500 text-white px-2 py-0.5 rounded-full font-bold animate-pulse">
                  {queue.count}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="mt-auto p-6 border-t border-slate-800">
        {inQueue && (
          <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
            <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold mb-1">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
              IN QUEUE
            </div>
            <p className="text-xs text-slate-400">Waiting for {queue.count} / 3 participants</p>
          </div>
        )}

        <div className="flex items-center gap-3 mb-6 px-2">
          <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-white">
            {user?.company?.[0] || 'U'}
          </div>
          <div className="overflow-hidden">
            <p className="text-sm font-medium text-white truncate">{user?.company}</p>
            <p className="text-xs text-slate-500 truncate">{user?.email}</p>
          </div>
        </div>
        <button
          onClick={logout}
          className="flex items-center gap-3 w-full px-4 py-3 rounded-lg hover:bg-red-500/10 hover:text-red-400 transition-colors text-slate-400"
        >
          <LogOut size={20} />
          <span className="font-medium">Logout</span>
        </button>
      </div>
    </aside>
  );
}
