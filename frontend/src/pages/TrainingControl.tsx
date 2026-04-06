import React, { useState } from 'react';
import { Play, Square, Settings, Sliders, Server, Zap } from 'lucide-react';
import { motion } from 'motion/react';

export default function TrainingControl() {
  const [config, setConfig] = useState({
    rounds: 10,
    learningRate: 0.01,
    batchSize: 32,
    clientFraction: 1.0,
    aggregationStrategy: 'FedAvg',
    minClients: 5
  });

  const [isTraining, setIsTraining] = useState(false);

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <header className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Training Configuration</h1>
          <p className="text-slate-500 mt-1">Define hyperparameters and system constraints for the next federated session.</p>
        </div>
        <div className="flex gap-4">
          <button 
            onClick={() => setIsTraining(!isTraining)}
            className={`px-6 py-3 rounded-xl flex items-center gap-2 font-bold transition-all shadow-lg ${
              isTraining 
                ? 'bg-rose-500 text-white hover:bg-rose-600 shadow-rose-200' 
                : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-200'
            }`}
          >
            {isTraining ? <Square size={18} /> : <Play size={18} />}
            {isTraining ? 'Stop Training' : 'Start Session'}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <section className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
            <div className="flex items-center gap-3 mb-8">
              <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                <Sliders size={20} />
              </div>
              <h2 className="text-xl font-bold text-slate-900">Hyperparameters</h2>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700 uppercase tracking-wider">Federated Rounds</label>
                <input 
                  type="number" 
                  className="w-full p-4 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-indigo-500 transition-all font-medium"
                  value={isNaN(config.rounds) ? '' : config.rounds}
                  onChange={(e) => setConfig({...config, rounds: e.target.value === '' ? NaN : parseInt(e.target.value)})}
                />
                <p className="text-xs text-slate-400">Total number of global aggregation cycles.</p>
              </div>
              
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700 uppercase tracking-wider">Learning Rate</label>
                <input 
                  type="number" step="0.001"
                  className="w-full p-4 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-indigo-500 transition-all font-medium"
                  value={isNaN(config.learningRate) ? '' : config.learningRate}
                  onChange={(e) => setConfig({...config, learningRate: e.target.value === '' ? NaN : parseFloat(e.target.value)})}
                />
                <p className="text-xs text-slate-400">Step size for local stochastic gradient descent.</p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700 uppercase tracking-wider">Batch Size</label>
                <input 
                  type="number" 
                  className="w-full p-4 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-indigo-500 transition-all font-medium"
                  value={isNaN(config.batchSize) ? '' : config.batchSize}
                  onChange={(e) => setConfig({...config, batchSize: e.target.value === '' ? NaN : parseInt(e.target.value)})}
                />
                <p className="text-xs text-slate-400">Number of samples per local update.</p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700 uppercase tracking-wider">Aggregation Strategy</label>
                <select 
                  className="w-full p-4 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-indigo-500 transition-all font-medium appearance-none"
                  value={config.aggregationStrategy}
                  onChange={(e) => setConfig({...config, aggregationStrategy: e.target.value})}
                >
                  <option value="FedAvg">Federated Averaging (FedAvg)</option>
                  <option value="FedProx">FedProx (Proximal Term)</option>
                  <option value="FedAdam">FedAdam (Adaptive)</option>
                </select>
              </div>
            </div>
          </section>

          <section className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
            <div className="flex items-center gap-3 mb-8">
              <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                <Server size={20} />
              </div>
              <h2 className="text-xl font-bold text-slate-900">Node Constraints</h2>
            </div>

            <div className="space-y-8">
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-bold text-slate-700 uppercase tracking-wider">Client Selection Fraction</label>
                  <span className="text-indigo-600 font-bold bg-indigo-50 px-3 py-1 rounded-lg">{(config.clientFraction * 100).toFixed(0)}%</span>
                </div>
                <input 
                  type="range" min="0.1" max="1" step="0.1"
                  className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                  value={isNaN(config.clientFraction) ? 0.1 : config.clientFraction}
                  onChange={(e) => setConfig({...config, clientFraction: parseFloat(e.target.value)})}
                />
                <p className="text-xs text-slate-400">Percentage of available nodes to select for each round.</p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700 uppercase tracking-wider">Minimum Required Clients</label>
                <input 
                  type="number" 
                  className="w-full p-4 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-indigo-500 transition-all font-medium"
                  value={isNaN(config.minClients) ? '' : config.minClients}
                  onChange={(e) => setConfig({...config, minClients: e.target.value === '' ? NaN : parseInt(e.target.value)})}
                />
                <p className="text-xs text-slate-400">Training will not start until this many nodes are in the queue.</p>
              </div>
            </div>
          </section>
        </div>

        <div className="space-y-8">
          <div className="bg-indigo-600 p-8 rounded-3xl text-white shadow-xl shadow-indigo-200">
            <Zap className="mb-4 opacity-80" size={32} />
            <h3 className="text-xl font-bold mb-2">Quick Summary</h3>
            <p className="text-indigo-100 text-sm leading-relaxed mb-6">
              You are about to start a session with <strong>{config.rounds} rounds</strong> using the <strong>{config.aggregationStrategy}</strong> strategy. 
              Approximate training time: <strong>14 minutes</strong>.
            </p>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="opacity-70">Estimated Accuracy</span>
                <span className="font-bold">~92%</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="opacity-70">Network Load</span>
                <span className="font-bold">Medium</span>
              </div>
            </div>
          </div>

          <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
            <h3 className="font-bold text-slate-900 mb-4">System Health</h3>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                <span className="text-sm text-slate-600">Aggregator Server: Online</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                <span className="text-sm text-slate-600">Storage Bucket: Connected</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                <span className="text-sm text-slate-600">Queue Status: 14 nodes waiting</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
