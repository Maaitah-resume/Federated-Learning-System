import axios from 'axios';

const API_BASE_URL =
  import.meta.env.VITE_API_URL ||
  'https://earnest-heart-production.up.railway.app';

console.log('🔧 API Base URL:', API_BASE_URL);

// All valid demo participant IDs
const DEMO_IDS = ['mohammad', 'amer', 'ammar', 'admin'];

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

apiClient.interceptors.request.use(
  (config) => {
    console.log('📤 API Request:', config.method?.toUpperCase(), config.baseURL + config.url);
    const saved = localStorage.getItem('fl_participant');
    if (saved) {
      try {
        const id = JSON.parse(saved);
        config.headers.Authorization = `Bearer demo-token-${id}`;
      } catch (error) {
        console.error('Error parsing participant data:', error);
      }
    }
    return config;
  },
  (error) => Promise.reject(error)
);

apiClient.interceptors.response.use(
  (response) => {
    console.log('📥 API Response:', response.status, response.config.url);
    return response;
  },
  (error) => {
    console.error('❌ API Error:', error.message, error.config?.url);
    if (error.response?.status === 401) {
      const saved      = localStorage.getItem('fl_participant');
      const isDemoUser = saved && DEMO_IDS.includes(JSON.parse(saved));
      // Only force logout for real users with invalid tokens
      if (!isDemoUser) {
        localStorage.removeItem('fl_participant');
        window.location.href = '/';
      }
    }
    return Promise.reject(error);
  }
);

export const api = {
  auth: {
    login:    (data: { email: string; password: string }) => apiClient.post('/api/auth/login', data),
    register: (data: { email: string; password: string }) => apiClient.post('/api/auth/register', data),
    logout:   () => apiClient.post('/api/auth/logout'),
  },
  queue: {
    getQueue:   () => apiClient.get('/api/queue'),
    joinQueue:  (data: any) => apiClient.post('/api/queue/join', data),
    leaveQueue: (companyId: string) => apiClient.delete(`/api/queue/${companyId}`),
  },
  training: {
    getJobs:       () => apiClient.get('/api/training/jobs'),
    getJobDetails: (jobId: string) => apiClient.get(`/api/training/jobs/${jobId}`),
    startTraining: (data: any) => apiClient.post('/api/training/start', data),
    stopTraining:  (jobId: string) => apiClient.post(`/api/training/${jobId}/stop`),
  },
  models: {
    getModels:      () => apiClient.get('/api/models'),
    getModelDetails:(modelId: string) => apiClient.get(`/api/models/${modelId}`),
    downloadModel:  (modelId: string) => apiClient.get(`/api/models/${modelId}/download`, { responseType: 'blob' }),
  },
  admin: {
    getStats:   () => apiClient.get('/api/admin/stats'),
    getConfig:  () => apiClient.get('/api/admin/config'),
    saveConfig: (data: any) => apiClient.put('/api/admin/config', data),
    getUsers:   () => apiClient.get('/api/admin/users'),
    addUser:    (data: any) => apiClient.post('/api/admin/users', data),
    deleteUser: (companyId: string) => apiClient.delete(`/api/admin/users/${companyId}`),
  },
};

export default api;
