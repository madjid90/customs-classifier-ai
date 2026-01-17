import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { sendOtp, verifyOtp } from "@/lib/api-client";

type UserRole = "admin" | "agent" | "manager";

interface AuthUser {
  id: string;
  company_id: string;
  role: UserRole;
  phone: string;
}

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  sendOtpCode: (phone: string) => Promise<{ error: Error | null; expiresIn?: number }>;
  verifyOtpCode: (phone: string, otp: string) => Promise<{ error: Error | null }>;
  logout: () => void;
  hasRole: (roles: UserRole | UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AUTH_TOKEN_KEY = "auth_token";
const AUTH_USER_KEY = "auth_user";
const AUTH_EXPIRES_KEY = "auth_expires";

function getStoredAuth(): { token: string | null; user: AuthUser | null; expires: string | null } {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  const userStr = localStorage.getItem(AUTH_USER_KEY);
  const expires = localStorage.getItem(AUTH_EXPIRES_KEY);
  
  let user: AuthUser | null = null;
  if (userStr) {
    try {
      user = JSON.parse(userStr);
    } catch {
      user = null;
    }
  }
  
  return { token, user, expires };
}

function isTokenExpired(expires: string | null): boolean {
  if (!expires) return true;
  return new Date(expires) <= new Date();
}

function clearAuth() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
  localStorage.removeItem(AUTH_EXPIRES_KEY);
}

function storeAuth(token: string, user: AuthUser, expiresAt: string) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  localStorage.setItem(AUTH_EXPIRES_KEY, expiresAt);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check for existing valid session
    const { token, user: storedUser, expires } = getStoredAuth();
    
    if (token && storedUser && !isTokenExpired(expires)) {
      setUser(storedUser);
    } else if (token) {
      // Token expired, clear it
      clearAuth();
    }
    
    setIsLoading(false);
  }, []);

  const sendOtpCode = useCallback(async (phone: string) => {
    try {
      const response = await sendOtp(phone);
      return { error: null, expiresIn: response.data.expires_in };
    } catch (error) {
      return { error: error as Error };
    }
  }, []);

  const verifyOtpCode = useCallback(async (phone: string, otp: string) => {
    try {
      const response = await verifyOtp(phone, otp);
      const { token, expires_at, user: userData } = response.data;
      
      const authUser: AuthUser = {
        id: userData.id,
        company_id: userData.company_id,
        role: userData.role as UserRole,
        phone: userData.phone,
      };
      
      storeAuth(token, authUser, expires_at);
      setUser(authUser);
      
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  }, []);

  const logout = useCallback(() => {
    clearAuth();
    setUser(null);
  }, []);

  const hasRole = useCallback((roles: UserRole | UserRole[]) => {
    if (!user) return false;
    const roleArray = Array.isArray(roles) ? roles : [roles];
    return roleArray.includes(user.role);
  }, [user]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        sendOtpCode,
        verifyOtpCode,
        logout,
        hasRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
