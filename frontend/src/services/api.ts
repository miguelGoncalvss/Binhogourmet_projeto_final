import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

export type AuthUser = {
  id: number;
  name: string;
  email: string;
};

const TOKEN_KEY = "binho_estrutura_token";
const USER_KEY = "binho_estrutura_user";
const MUST_CHANGE_KEY = "binho_estrutura_must_change_password";

export const authStorage = {
  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  },

  setToken(token: string) {
    localStorage.setItem(TOKEN_KEY, token);
  },

  clearToken() {
    localStorage.removeItem(TOKEN_KEY);
  },

  getUser(): AuthUser | null {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthUser;
    } catch {
      return null;
    }
  },

  setUser(user: AuthUser) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },

  clearUser() {
    localStorage.removeItem(USER_KEY);
  },

  getMustChangePassword(): boolean {
    return localStorage.getItem(MUST_CHANGE_KEY) === "1";
  },

  setMustChangePassword(value: boolean) {
    localStorage.setItem(MUST_CHANGE_KEY, value ? "1" : "0");
  },

  clearMustChangePassword() {
    localStorage.removeItem(MUST_CHANGE_KEY);
  },

  clearSession() {
    this.clearToken();
    this.clearUser();
    this.clearMustChangePassword();
  },
};

const api = axios.create({
  baseURL: API_BASE_URL,
});

api.interceptors.request.use((config) => {
  const token = authStorage.getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      authStorage.clearSession();
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

export default api;