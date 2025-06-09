import axios from 'axios';

const api = axios.create({
  baseURL: 'http://192.168.1.83:5000/api',
  withCredentials: true, // if using cookies/sessions
});

export default api;
