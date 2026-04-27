import axios from 'axios';

// Get API URL from environment variable, fallback to localhost for development
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

// Create axios instance with default config
export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add request interceptor to include auth token
apiClient.interceptors.request.use(
  (config) => {
    const userStr = localStorage.getItem('fl_user');
    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        if (user.token) {
          config.headers.Authorization = `Bearer ${user.token}`;
        }
      } catch (error) {
        console.error('Error parsing user data:', error);
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Add response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Unauthorized - clear user data and redirect to login
      localStorage.removeItem('fl_user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// API endpoints
export const api = {
  // Authentication
  auth: {
    login: (data: { username: string; password: string }) =>
      apiClient.post('/api/v1/auth/login', data),
    
    register: (data: { username: string; email: string; password: string }) =>
      apiClient.post('/api/v1/auth/register', data),
    
    logout: () => apiClient.post('/api/auth/logout'),
  },

  // Queue management
  queue: {
    getQueue: () => apiClient.get('/api/queue'),
    joinQueue: (data: any) => apiClient.post('/api/queue/join', data),
    leaveQueue: (companyId: string) => apiClient.delete(`/api/queue/${companyId}`),
  },

  // Training
  training: {
    getJobs: () => apiClient.get('/api/training/jobs'),
    getJobDetails: (jobId: string) => apiClient.get(`/api/training/jobs/${jobId}`),
    startTraining: (data: any) => apiClient.post('/api/training/start', data),
    stopTraining: (jobId: string) => apiClient.post(`/api/training/${jobId}/stop`),
  },

  // Models
  models: {
    getModels: () => apiClient.get('/api/models'),
    getModelDetails: (modelId: string) => apiClient.get(`/api/models/${modelId}`),
    downloadModel: (modelId: string) => apiClient.get(`/api/models/${modelId}/download`, {
      responseType: 'blob',
    }),
  },
};

export default api;
