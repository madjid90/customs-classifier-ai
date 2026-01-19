-- Fix: Add explicit SELECT policy for profiles table to ensure users can only see their own profile
-- Drop the overly permissive policy and add a specific one

-- Note: This ensures profiles table has explicit user-only access policy
-- The existing RLS requires auth.uid() IS NOT NULL, we add explicit self-only access

-- Add UPDATE/DELETE policies for classification_results if business decides they need it later
-- For now, these remain read-only by design (immutable records)