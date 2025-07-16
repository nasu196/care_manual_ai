-- Fix RLS policies for security and performance issues
-- Issue #1: Remove user_metadata reference from share_configs (security risk)
-- Issue #2: Optimize auth function calls to avoid re-evaluation per row

-- Drop existing policies first
DROP POLICY IF EXISTS "Users can manage their own share configs" ON share_configs;
DROP POLICY IF EXISTS "Users can only access their own manuals" ON manuals;
DROP POLICY IF EXISTS "Users can only access their own memos" ON memos;
DROP POLICY IF EXISTS "Users can only access their own manual chunks" ON manual_chunks;
DROP POLICY IF EXISTS "Users can manage own processing jobs" ON processing_jobs;

-- Recreate policies with security and performance fixes

-- 1. share_configs: Use only 'sub' (no user_metadata) and optimize performance
CREATE POLICY "Users can manage their own share configs" ON share_configs
FOR ALL USING (
    user_id = (SELECT auth.jwt() ->> 'sub')
);

-- 2. manuals: Optimize auth.jwt() call
CREATE POLICY "Users can only access their own manuals" ON manuals
FOR ALL USING (
    user_id = (SELECT auth.jwt() ->> 'sub')
);

-- 3. memos: Optimize auth.jwt() call
CREATE POLICY "Users can only access their own memos" ON memos
FOR ALL USING (
    user_id = (SELECT auth.jwt() ->> 'sub')
);

-- 4. manual_chunks: Optimize auth.jwt() call in EXISTS subquery
CREATE POLICY "Users can only access their own manual chunks" ON manual_chunks
FOR ALL USING (
    EXISTS (
        SELECT 1 
        FROM manuals 
        WHERE manuals.id = manual_chunks.manual_id 
        AND manuals.user_id = (SELECT auth.jwt() ->> 'sub')
    )
);

-- 5. processing_jobs: Optimize both auth.jwt() and auth.role() calls
CREATE POLICY "Users can manage own processing jobs" ON processing_jobs
FOR ALL 
USING (
    (user_id = (SELECT auth.jwt() ->> 'sub')) 
    OR ((SELECT auth.role()) = 'service_role')
)
WITH CHECK (
    (user_id = (SELECT auth.jwt() ->> 'sub')) 
    OR ((SELECT auth.role()) = 'service_role')
);

-- Fix function search_path issue for cleanup_expired_share_configs
-- First check if function exists and alter it
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'cleanup_expired_share_configs') THEN
        ALTER FUNCTION cleanup_expired_share_configs() SET search_path = '';
    END IF;
END
$$; 