import axios from 'axios';

const API_BASE_URL =
  import.meta.env.VITE_API_URL ||
  'https://earnest-heart-production.up.railway.app';

console.log('🔧 API Base URL:', API_BASE_URL);

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.request.use(
  (config) => {
    console.log('📤 API Request:', config.method?.toUpperCase(), config.baseURL + config.url);
    const saved = localStorage.getItem('fl_participant');
    if (saved) {
      try {
        const id = JSON.parse(saved);
        // Send the demo token the backend actually expects
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
      const saved = localStorage.getItem('fl_participant');
      // Only redirect if NOT a demo participant
      const isDemoUser = saved && ['alpha', 'beta', 'gamma'].includes(JSON.parse(saved));
      if (!isDemoUser) {
        localStorage.removeItem('fl_participant');
        window.location.href = '/login';
      }
      // Demo users: just ignore 401s — backend doesn't accept demo tokens
    }
    return Promise.reject(error);
  }
);

export const api = {
  auth: {
    login: (data: { email: string; password: string }) =>
      apiClient.post('/api/auth/login', data),
    register: (data: { email: string; password: string }) =>
      apiClient.post('/api/auth/register', data),
    logout: () => apiClient.post('/api/auth/logout'),
  },
  queue: {
    getQueue: () => apiClient.get('/api/queue'),
    joinQueue: (data: any) => apiClient.post('/api/queue/join', data),
    leaveQueue: (companyId: string) => apiClient.delete(`/api/queue/${companyId}`),
  },
  training: {
    getJobs: () => apiClient.get('/api/training/jobs'),
    getJobDetails: (jobId: string) => apiClient.get(`/api/training/jobs/${jobId}`),
    startTraining: (data: any) => apiClient.post('/api/training/start', data),
    stopTraining: (jobId: string) => apiClient.post(`/api/training/${jobId}/stop`),
  },
  models: {
    getModels: () => apiClient.get('/api/models'),
    getModelDetails: (modelId: string) => apiClient.get(`/api/models/${modelId}`),
    downloadModel: (modelId: string) =>
      apiClient.get(`/api/models/${modelId}/download`, { responseType: 'blob' }),
  },
};

export default api;
