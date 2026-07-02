import axios from 'axios';

// Default to relative /api for client-side routing through Nginx
const baseURL = process.env.NEXT_PUBLIC_API_URL || '/api';

const api = axios.create({
  baseURL,
  withCredentials: true, // Important for sending/receiving cookies across domains/ports
});

export const fetcher = (url: string) => api.get(url).then(res => res.data);

export default api;
