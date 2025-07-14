-- Fix RLS policy for share_configs to support Clerk integration
DROP POLICY IF EXISTS "Users can manage their own share configs" ON share_configs;

CREATE POLICY "Users can manage their own share configs" ON share_configs
  FOR ALL
  USING (user_id = COALESCE((auth.jwt() -> 'user_metadata' ->> 'user_id'), (auth.jwt() ->> 'sub'))); 