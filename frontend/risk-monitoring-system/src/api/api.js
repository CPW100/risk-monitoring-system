import axios from 'axios';

// Use the environment variable for the API base URL, with a fallback for local dev
const VITE_API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

const api = axios.create({
  baseURL: VITE_API_BASE_URL,
  withCredentials: true, // if using cookies/sessions
});
export default api;
