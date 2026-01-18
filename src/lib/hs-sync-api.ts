// API functions for HS codes synchronization from finance laws
import axios from "axios";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

const getHeaders = () => {
  const token = localStorage.getItem("auth_token");
  return {
    "Content-Type": "application/json",
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": token ? `Bearer ${token}` : "",
  };
};

export interface HSUpdate {
  code_10: string;
  field: "taxes" | "label_fr" | "unit" | "active";
  old_value: string | null;
  new_value: string;
  source_ref: string;
  effective_date?: string;
}

export interface SyncResult {
  success: boolean;
  laws_analyzed: number;
  updates_found: number;
  updates_applied: number;
  errors: string[];
  updates: HSUpdate[];
  message?: string;
}

export interface SyncOptions {
  version_label?: string;
  dry_run?: boolean;
  limit?: number;
}

export interface SyncHistoryEntry {
  id: string;
  version_label: string;
  laws_analyzed: number;
  updates_found: number;
  updates_applied: number;
  details: {
    updates?: HSUpdate[];
    errors?: string[];
  };
  created_at: string;
}

/**
 * Synchronize HS codes from imported finance laws
 * Analyzes law documents and extracts HS code modifications
 */
export async function syncHSFromLaws(options: SyncOptions = {}): Promise<SyncResult> {
  const response = await axios.post(
    `${FUNCTIONS_URL}/sync-hs-from-laws`,
    options,
    { 
      headers: getHeaders(),
      timeout: 120000 // 2 minutes for AI processing
    }
  );
  return response.data;
}

/**
 * Preview changes without applying them (dry run)
 */
export async function previewHSSync(versionLabel?: string): Promise<SyncResult> {
  return syncHSFromLaws({
    version_label: versionLabel,
    dry_run: true,
    limit: 100,
  });
}

/**
 * Get sync history
 */
export async function getSyncHistory(limit = 20): Promise<SyncHistoryEntry[]> {
  const { supabase } = await import("@/integrations/supabase/client");
  
  const { data, error } = await supabase
    .from("hs_sync_history")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  
  if (error) {
    console.error("[hs-sync] Failed to fetch history:", error);
    return [];
  }
  
  return data as SyncHistoryEntry[];
}
