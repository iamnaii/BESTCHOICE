/// <reference types="vite/client" />
import axios from 'axios';

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

// Same-origin in both dev and prod.
// Dev: Vite proxy rewrites /api → http://localhost:3000 (see vite.config).
// Prod: Firebase Hosting on shop.bestchoicephone.app rewrites /api/** to the
// bestchoice-api Cloud Run service (see root firebase.json `shop` target).
export const api = axios.create({
  baseURL: '',
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
