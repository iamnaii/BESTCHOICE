/// <reference types="vite/client" />
import axios from 'axios';

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export const api = axios.create({
  baseURL: import.meta.env.PROD ? 'https://bestchoicephone.app' : '',
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      setAccessToken(null);
    }
    return Promise.reject(err);
  }
);
