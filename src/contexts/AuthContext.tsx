import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

type UserRole = "admin" | "agent" | "manager";

interface UserProfile {
  id: string;
  user_id: string;
  company_id: string;
  phone: string;
}

interface CustomUser {
  id: string;
  phone: string;
  company_id: string;
  role: UserRole;
}

interface AuthContextType {
  user: CustomUser | null;
  profile: UserProfile | null;
  role: UserRole;
  token: string | null;
  tokenExpiresAt: Date | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  sendOtpCode: (phone: string) => Promise<{ error: Error | null }>;
  verifyOtpCode: (phone: string, otp: string) => Promise<{ error: Error | null }>;
  logout: () => Promise<void>;
  hasRole: (roles: UserRole | UserRole[]) => boolean;
  getAuthHeaders: () => Record<string, string>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AUTH_STORAGE_KEY = "custom_auth_token";
const USER_STORAGE_KEY = "custom_auth_user";
const EXPIRES_STORAGE_KEY = "custom_auth_expires";

// Refresh token 10 minutes before expiration
const REFRESH_THRESHOLD_MS = 10 * 60 * 1000;
// Check token validity every minute
const CHECK_INTERVAL_MS = 60 * 1000;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CustomUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [tokenExpiresAt, setTokenExpiresAt] = useState<Date | null>(null);
  const [role, setRole] = useState<UserRole>("agent");
  const [isLoading, setIsLoading] = useState(true);
  const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isRefreshingRef = useRef(false);

  // Get Supabase functions URL
  const getFunctionsUrl = useCallback(() => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    return `${supabaseUrl}/functions/v1`;
  }, []);

  // Refresh token function
  const refreshToken = useCallback(async () => {
    if (isRefreshingRef.current) return;
    
    const currentToken = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!currentToken) return;

    isRefreshingRef.current = true;
    console.log("[Auth] Refreshing token...");

    try {
      const response = await fetch(`${getFunctionsUrl()}/refresh-token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${currentToken}`,
        },
      });

      if (!response.ok) {
        // Token is invalid or expired, logout
        console.warn("[Auth] Token refresh failed, logging out");
        localStorage.removeItem(AUTH_STORAGE_KEY);
        localStorage.removeItem(USER_STORAGE_KEY);
        localStorage.removeItem(EXPIRES_STORAGE_KEY);
        setUser(null);
        setToken(null);
        setTokenExpiresAt(null);
        setProfile(null);
        setRole("agent");
        return;
      }

      const data = await response.json();
      const { token: newToken, expires_at, user: userData } = data;

      // Store new token
      localStorage.setItem(AUTH_STORAGE_KEY, newToken);
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(userData));
      localStorage.setItem(EXPIRES_STORAGE_KEY, expires_at);

      setToken(newToken);
      setTokenExpiresAt(new Date(expires_at));
      setUser(userData as CustomUser);
      setRole(userData.role as UserRole);

      console.log("[Auth] Token refreshed successfully, expires at:", expires_at);
    } catch (error) {
      console.error("[Auth] Error refreshing token:", error);
    } finally {
      isRefreshingRef.current = false;
    }
  }, [getFunctionsUrl]);

  // Schedule token refresh
  const scheduleRefresh = useCallback((expiresAt: Date) => {
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }

    const now = Date.now();
    const expiresTime = expiresAt.getTime();
    const timeUntilRefresh = expiresTime - now - REFRESH_THRESHOLD_MS;

    if (timeUntilRefresh <= 0) {
      // Token is about to expire or already expired, refresh now
      refreshToken();
    } else {
      console.log(`[Auth] Token refresh scheduled in ${Math.round(timeUntilRefresh / 60000)} minutes`);
      refreshTimeoutRef.current = setTimeout(() => {
        refreshToken();
      }, timeUntilRefresh);
    }
  }, [refreshToken]);

  // Check token validity periodically
  useEffect(() => {
    const checkTokenValidity = () => {
      const storedExpires = localStorage.getItem(EXPIRES_STORAGE_KEY);
      if (!storedExpires || !token) return;

      const expiresAt = new Date(storedExpires);
      const now = Date.now();
      const timeUntilExpiry = expiresAt.getTime() - now;

      if (timeUntilExpiry <= REFRESH_THRESHOLD_MS && timeUntilExpiry > 0) {
        // Token is about to expire, refresh it
        refreshToken();
      } else if (timeUntilExpiry <= 0) {
        // Token has expired
        console.warn("[Auth] Token has expired");
        localStorage.removeItem(AUTH_STORAGE_KEY);
        localStorage.removeItem(USER_STORAGE_KEY);
        localStorage.removeItem(EXPIRES_STORAGE_KEY);
        setUser(null);
        setToken(null);
        setTokenExpiresAt(null);
        setProfile(null);
        setRole("agent");
      }
    };

    const intervalId = setInterval(checkTokenValidity, CHECK_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [token, refreshToken]);

  // Load auth state from localStorage on mount
  useEffect(() => {
    const storedToken = localStorage.getItem(AUTH_STORAGE_KEY);
    const storedUser = localStorage.getItem(USER_STORAGE_KEY);
    const storedExpires = localStorage.getItem(EXPIRES_STORAGE_KEY);

    if (storedToken && storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser) as CustomUser;
        const expiresAt = storedExpires ? new Date(storedExpires) : null;

        // Check if token is still valid
        if (expiresAt && expiresAt.getTime() > Date.now()) {
          setToken(storedToken);
          setUser(parsedUser);
          setRole(parsedUser.role || "agent");
          setTokenExpiresAt(expiresAt);
          
          // Schedule refresh
          scheduleRefresh(expiresAt);
          
          // Fetch fresh profile data
          fetchUserProfile(parsedUser.id);
        } else {
          // Token expired, clear storage
          console.warn("[Auth] Stored token has expired");
          localStorage.removeItem(AUTH_STORAGE_KEY);
          localStorage.removeItem(USER_STORAGE_KEY);
          localStorage.removeItem(EXPIRES_STORAGE_KEY);
        }
      } catch (e) {
        console.error("Failed to parse stored user:", e);
        localStorage.removeItem(AUTH_STORAGE_KEY);
        localStorage.removeItem(USER_STORAGE_KEY);
        localStorage.removeItem(EXPIRES_STORAGE_KEY);
      }
    }
    setIsLoading(false);
  }, [scheduleRefresh]);

  // Fetch user profile from DB
  const fetchUserProfile = async (userId: string) => {
    try {
      const { data: profileData } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", userId)
        .single();

      if (profileData) {
        setProfile(profileData as UserProfile);
      }

      // Fetch role
      const { data: roleData } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .single();

      if (roleData?.role) {
        setRole(roleData.role as UserRole);
      }
    } catch (error) {
      console.error("Error fetching user profile:", error);
    }
  };

  // Note: getFunctionsUrl is defined above as useCallback

  // Send OTP via custom edge function
  const sendOtpCode = useCallback(async (phone: string) => {
    try {
      const normalizedPhone = phone.replace(/\s/g, "");
      
      const response = await fetch(`${getFunctionsUrl()}/send-otp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ phone: normalizedPhone }),
      });

      const data = await response.json();

      if (!response.ok) {
        return { error: new Error(data.error || data.message || "Erreur d'envoi du code") };
      }

      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  }, []);

  // Verify OTP via custom edge function
  const verifyOtpCode = useCallback(async (phone: string, otp: string) => {
    try {
      const normalizedPhone = phone.replace(/\s/g, "");

      const response = await fetch(`${getFunctionsUrl()}/verify-otp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ phone: normalizedPhone, otp }),
      });

      const data = await response.json();

      if (!response.ok) {
        return { error: new Error(data.error || data.message || "Code invalide") };
      }

      // Store token and user
      const { token: authToken, expires_at, user: userData } = data;
      const expiresAt = new Date(expires_at);
      
      localStorage.setItem(AUTH_STORAGE_KEY, authToken);
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(userData));
      localStorage.setItem(EXPIRES_STORAGE_KEY, expires_at);

      setToken(authToken);
      setTokenExpiresAt(expiresAt);
      setUser(userData as CustomUser);
      setRole(userData.role as UserRole);

      // Schedule token refresh
      scheduleRefresh(expiresAt);

      // Fetch profile
      await fetchUserProfile(userData.id);

      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  }, []);

  const logout = useCallback(async () => {
    // Clear refresh timeout
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(USER_STORAGE_KEY);
    localStorage.removeItem(EXPIRES_STORAGE_KEY);
    setUser(null);
    setToken(null);
    setTokenExpiresAt(null);
    setProfile(null);
    setRole("agent");
  }, []);

  const hasRole = useCallback((roles: UserRole | UserRole[]) => {
    if (!user) return false;
    const roleArray = Array.isArray(roles) ? roles : [roles];
    return roleArray.includes(role);
  }, [user, role]);

  // Get authorization headers for API calls
  const getAuthHeaders = useCallback(() => {
    if (!token) return {};
    return {
      Authorization: `Bearer ${token}`,
    };
  }, [token]);

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        role,
        token,
        tokenExpiresAt,
        isAuthenticated: !!user && !!token,
        isLoading,
        sendOtpCode,
        verifyOtpCode,
        logout,
        hasRole,
        getAuthHeaders,
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
