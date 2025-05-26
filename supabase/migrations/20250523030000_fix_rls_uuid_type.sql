-- RLSポリシーのUUID型不一致を修正
-- auth.jwt()->>'sub'は文字列なので、UUIDにキャストする必要がある

-- 既存のポリシーを削除
DROP POLICY IF EXISTS "Users can only see their own manuals" ON manuals;
DROP POLICY IF EXISTS "Users can only see their own manual chunks" ON manual_chunks;

-- 修正されたポリシーを作成
CREATE POLICY "Users can only see their own manuals" ON manuals
  FOR ALL USING ((auth.jwt()->>'sub')::uuid = user_id);

CREATE POLICY "Users can only see their own manual chunks" ON manual_chunks
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM manuals 
      WHERE manuals.id = manual_chunks.manual_id 
      AND (auth.jwt()->>'sub')::uuid = manuals.user_id
    )
  );

-- Storageポリシーも修正
DROP POLICY IF EXISTS "Users can read their own files" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own files" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own files" ON storage.objects;

CREATE POLICY "Users can read their own files" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'manuals' AND 
    EXISTS (
      SELECT 1 FROM manuals 
      WHERE manuals.file_name = name 
      AND (auth.jwt()->>'sub')::uuid = manuals.user_id
    )
  );

CREATE POLICY "Users can upload their own files" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'manuals' AND 
    (auth.jwt()->>'sub') IS NOT NULL
  );

CREATE POLICY "Users can delete their own files" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'manuals' AND 
    EXISTS (
      SELECT 1 FROM manuals 
      WHERE manuals.file_name = name 
      AND (auth.jwt()->>'sub')::uuid = manuals.user_id
    )
  ); 