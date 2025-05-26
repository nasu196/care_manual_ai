-- RLSポリシーのUUID型不一致を修正
-- auth.jwt()->'user_metadata'->>'user_id'は文字列なので、UUIDにキャストする必要がある

-- 既存のポリシーを削除
DROP POLICY IF EXISTS "Users can only see their own manuals" ON manuals;
DROP POLICY IF EXISTS "Users can only see their own manual chunks" ON manual_chunks;

-- 修正されたポリシーを作成（Clerk JWTテンプレートに合わせて user_metadata.user_id を使用）
CREATE POLICY "Users can only see their own manuals" ON manuals
  FOR ALL USING ((auth.jwt()->'user_metadata'->>'user_id')::uuid = user_id);

CREATE POLICY "Users can only see their own manual chunks" ON manual_chunks
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM manuals 
      WHERE manuals.id = manual_chunks.manual_id 
      AND (auth.jwt()->'user_metadata'->>'user_id')::uuid = manuals.user_id
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
      AND (auth.jwt()->'user_metadata'->>'user_id')::uuid = manuals.user_id
    )
  );

CREATE POLICY "Users can upload their own files" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'manuals' AND 
    (auth.jwt()->'user_metadata'->>'user_id') IS NOT NULL
  );

CREATE POLICY "Users can delete their own files" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'manuals' AND 
    EXISTS (
      SELECT 1 FROM manuals 
      WHERE manuals.file_name = name 
      AND (auth.jwt()->'user_metadata'->>'user_id')::uuid = manuals.user_id
    )
  );

-- memosテーブルのRLSポリシーも追加
-- まずRLSを有効化
ALTER TABLE memos ENABLE ROW LEVEL SECURITY;

-- memosテーブルのポリシー: ユーザーは自分のメモのみアクセス可能
CREATE POLICY "Users can only access their own memos" ON memos
  FOR ALL USING ((auth.jwt()->'user_metadata'->>'user_id')::uuid = created_by); 