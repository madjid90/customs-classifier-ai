import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

type UserRole = "admin" | "agent" | "manager";

interface UserProfile {
  id: string;
  user_id: string;
  company_id: string;
  phone: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  role: UserRole;
  isAuthenticated: boolean;
  isLoading: boolean;
  sendOtpCode: (phone: string) => Promise<{ error: Error | null }>;
  verifyOtpCode: (phone: string, otp: string) => Promise<{ error: Error | null }>;
  logout: () => Promise<void>;
  hasRole: (roles: UserRole | UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [role, setRole] = useState<UserRole>("agent");
  const [isLoading, setIsLoading] = useState(true);

  // Fetch user profile and role
  const fetchUserData = useCallback(async (userId: string) => {
    try {
      // Fetch profile
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
      } else {
        setRole("agent");
      }
    } catch (error) {
      console.error("Error fetching user data:", error);
    }
  }, []);

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        setSession(newSession);
        setUser(newSession?.user ?? null);

        // Defer Supabase calls with setTimeout to prevent deadlock
        if (newSession?.user) {
          setTimeout(() => {
            fetchUserData(newSession.user.id);
          }, 0);
        } else {
          setProfile(null);
          setRole("agent");
        }
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session: existingSession } }) => {
      setSession(existingSession);
      setUser(existingSession?.user ?? null);
      
      if (existingSession?.user) {
        fetchUserData(existingSession.user.id);
      }
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [fetchUserData]);

  // Send OTP via Supabase Auth
  const sendOtpCode = useCallback(async (phone: string) => {
    try {
      // Normalize phone number
      const normalizedPhone = phone.replace(/\s/g, "");
      
      const { error } = await supabase.auth.signInWithOtp({
        phone: normalizedPhone,
      });

      if (error) {
        return { error: new Error(error.message) };
      }

      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  }, []);

  // Verify OTP via Supabase Auth
  const verifyOtpCode = useCallback(async (phone: string, otp: string) => {
    try {
      const normalizedPhone = phone.replace(/\s/g, "");

      const { data, error } = await supabase.auth.verifyOtp({
        phone: normalizedPhone,
        token: otp,
        type: "sms",
      });

      if (error) {
        return { error: new Error(error.message) };
      }

      // Session is automatically set by Supabase Auth
      if (data.session) {
        setSession(data.session);
        setUser(data.user);
        
        // Fetch profile and role
        if (data.user) {
          await fetchUserData(data.user.id);
        }
      }

      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  }, [fetchUserData]);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setRole("agent");
  }, []);

  const hasRole = useCallback((roles: UserRole | UserRole[]) => {
    if (!user) return false;
    const roleArray = Array.isArray(roles) ? roles : [roles];
    return roleArray.includes(role);
  }, [user, role]);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        role,
        isAuthenticated: !!user && !!session,
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
