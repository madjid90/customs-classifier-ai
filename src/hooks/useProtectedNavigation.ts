import { useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

const REDIRECT_KEY = "auth_redirect_path";

interface UseProtectedNavigationReturn {
  /** Navigate to a path, storing it for post-login redirect if not authenticated */
  navigateTo: (path: string) => void;
  /** Get the stored redirect path (used after login) */
  getRedirectPath: () => string;
  /** Clear the stored redirect path */
  clearRedirectPath: () => void;
  /** Redirect to stored path or default, then clear storage */
  redirectAfterLogin: (defaultPath?: string) => void;
  /** Store current path for later redirect (used before redirecting to login) */
  storeCurrentPath: () => void;
  /** The path that was stored in location state (from Navigate) */
  locationStatePath: string | null;
}

/**
 * Hook for centralized navigation with authentication awareness.
 * Handles storing and retrieving redirect paths for post-login navigation.
 */
export function useProtectedNavigation(): UseProtectedNavigationReturn {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated } = useAuth();

  // Get path from location state (set by ProtectedRoute's Navigate)
  const locationStatePath = (location.state as { from?: { pathname: string } })?.from?.pathname ?? null;

  const storeRedirectPath = useCallback((path: string) => {
    sessionStorage.setItem(REDIRECT_KEY, path);
  }, []);

  const getRedirectPath = useCallback((): string => {
    return sessionStorage.getItem(REDIRECT_KEY) || "/dashboard";
  }, []);

  const clearRedirectPath = useCallback(() => {
    sessionStorage.removeItem(REDIRECT_KEY);
  }, []);

  const storeCurrentPath = useCallback(() => {
    if (location.pathname !== "/login") {
      storeRedirectPath(location.pathname);
    }
  }, [location.pathname, storeRedirectPath]);

  const navigateTo = useCallback((path: string) => {
    if (isAuthenticated) {
      navigate(path);
    } else {
      storeRedirectPath(path);
      navigate("/login", { state: { from: { pathname: path } } });
    }
  }, [isAuthenticated, navigate, storeRedirectPath]);

  const redirectAfterLogin = useCallback((defaultPath: string = "/dashboard") => {
    // Priority: location state > sessionStorage > default
    const targetPath = locationStatePath || getRedirectPath() || defaultPath;
    clearRedirectPath();
    navigate(targetPath, { replace: true });
  }, [locationStatePath, getRedirectPath, clearRedirectPath, navigate]);

  return {
    navigateTo,
    getRedirectPath,
    clearRedirectPath,
    redirectAfterLogin,
    storeCurrentPath,
    locationStatePath,
  };
}
