import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CustomUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [role, setRole] = useState<UserRole>("agent");
  const [isLoading, setIsLoading] = useState(true);

  // Load auth state from localStorage on mount
  useEffect(() => {
    const storedToken = localStorage.getItem(AUTH_STORAGE_KEY);
    const storedUser = localStorage.getItem(USER_STORAGE_KEY);

    if (storedToken && storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser) as CustomUser;
        setToken(storedToken);
        setUser(parsedUser);
        setRole(parsedUser.role || "agent");
        
        // Fetch fresh profile data
        fetchUserProfile(parsedUser.id);
      } catch (e) {
        console.error("Failed to parse stored user:", e);
        localStorage.removeItem(AUTH_STORAGE_KEY);
        localStorage.removeItem(USER_STORAGE_KEY);
      }
    }
    setIsLoading(false);
  }, []);

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

  // Get Supabase functions URL
  const getFunctionsUrl = () => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    return `${supabaseUrl}/functions/v1`;
  };

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
      const { token: authToken, user: userData } = data;
      
      localStorage.setItem(AUTH_STORAGE_KEY, authToken);
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(userData));

      setToken(authToken);
      setUser(userData as CustomUser);
      setRole(userData.role as UserRole);

      // Fetch profile
      await fetchUserProfile(userData.id);

      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  }, []);

  const logout = useCallback(async () => {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(USER_STORAGE_KEY);
    setUser(null);
    setToken(null);
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
