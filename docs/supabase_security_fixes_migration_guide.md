# Supabaseセキュリティ修正マイグレーションガイド

## 概要
開発環境で実行したセキュリティアドバイザーの問題修正を本番環境に適用するためのガイドです。

## 修正対象
- **ERRORレベル**: RLS references user metadata (7件)
- **WARNINGレベル**: Function Search Path Mutable (2件)  
- **WARNINGレベル**: Extension in Public (1件)

## 事前確認事項

### 1. 現在の問題確認
```bash
# MCPツールまたはSupabase Dashboard で以下を確認
# mcp_supabase_get_advisors で security タイプの警告を確認
```

### 2. 現在のuser_id形式確認
```sql
-- 現在保存されているuser_idの形式を確認
SELECT 'manuals' as table_name, user_id, length(user_id) as id_length
FROM manuals 
WHERE user_id IS NOT NULL
LIMIT 3;

SELECT 'memos' as table_name, user_id, length(user_id) as id_length
FROM memos 
WHERE user_id IS NOT NULL
LIMIT 3;
```

## マイグレーション手順

### マイグレーション1: RLSセキュリティ脆弱性修正

**マイグレーション名**: `fix_rls_security_vulnerabilities`

```sql
-- Fix RLS security vulnerabilities by removing user_metadata references
-- Replace with secure auth.jwt() ->> 'sub' references

-- 1. Fix manuals table RLS policy
DROP POLICY IF EXISTS "Users can only access their own manuals" ON public.manuals;
CREATE POLICY "Users can only access their own manuals" ON public.manuals
FOR ALL USING (user_id = (auth.jwt() ->> 'sub'));

-- 2. Fix manual_chunks table RLS policy  
DROP POLICY IF EXISTS "Users can only access their own manual chunks" ON public.manual_chunks;
CREATE POLICY "Users can only access their own manual chunks" ON public.manual_chunks
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM manuals 
    WHERE manuals.id = manual_chunks.manual_id 
    AND manuals.user_id = (auth.jwt() ->> 'sub')
  )
);

-- 3. Fix memos table RLS policy
DROP POLICY IF EXISTS "Users can only access their own memos" ON public.memos;
CREATE POLICY "Users can only access their own memos" ON public.memos
FOR ALL USING (user_id = (auth.jwt() ->> 'sub'));

-- 4. Fix share_configs table RLS policy
DROP POLICY IF EXISTS "Users can manage their own share configs" ON public.share_configs;
CREATE POLICY "Users can manage their own share configs" ON public.share_configs
FOR ALL USING (user_id = (auth.jwt() ->> 'sub'));

-- 5. Fix processing_jobs table RLS policies
DROP POLICY IF EXISTS "Users can view own processing jobs" ON public.processing_jobs;
CREATE POLICY "Users can view own processing jobs" ON public.processing_jobs
FOR SELECT USING (user_id = (auth.jwt() ->> 'sub'));

DROP POLICY IF EXISTS "Users can update own processing jobs" ON public.processing_jobs;
CREATE POLICY "Users can update own processing jobs" ON public.processing_jobs
FOR UPDATE USING (user_id = (auth.jwt() ->> 'sub'));

DROP POLICY IF EXISTS "Users can delete own processing jobs" ON public.processing_jobs;
CREATE POLICY "Users can delete own processing jobs" ON public.processing_jobs
FOR DELETE USING (user_id = (auth.jwt() ->> 'sub'));

-- Keep the existing create policy for processing_jobs as it already uses auth.uid()
-- DROP POLICY IF EXISTS "Users can create own processing jobs" ON public.processing_jobs;
-- CREATE POLICY "Users can create own processing jobs" ON public.processing_jobs
-- FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = user_id);
```

### マイグレーション2: 関数のsearch_pathセキュリティ修正

**マイグレーション名**: `fix_function_search_path_security`

```sql
-- Fix function search_path security warnings
-- Set explicit search_path for functions to prevent security issues

-- Fix match_manual_chunks function
CREATE OR REPLACE FUNCTION match_manual_chunks(
  query_embedding vector(1536),
  similarity_threshold float DEFAULT 0.3,
  match_count int DEFAULT 5
)
RETURNS TABLE(
  id uuid,
  manual_id uuid,
  chunk_text text,
  page_number int,
  chunk_order int,
  similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    mc.id,
    mc.manual_id,
    mc.chunk_text,
    mc.page_number,
    mc.chunk_order,
    1 - (mc.embedding <=> query_embedding) AS similarity
  FROM manual_chunks mc
  WHERE 1 - (mc.embedding <=> query_embedding) > similarity_threshold
  ORDER BY mc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Fix update_processing_jobs_updated_at function
CREATE OR REPLACE FUNCTION update_processing_jobs_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;
```

### マイグレーション3: 複数パラメータmatch_manual_chunks関数修正

**マイグレーション名**: `fix_match_manual_chunks_search_path`

```sql
-- Fix the remaining match_manual_chunks function search_path issue

CREATE OR REPLACE FUNCTION public.match_manual_chunks(
  query_embedding vector, 
  match_threshold double precision DEFAULT 0.1, 
  match_count integer DEFAULT 3, 
  p_user_id text DEFAULT NULL::text, 
  p_selected_manual_ids uuid[] DEFAULT NULL::uuid[], 
  p_share_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  id uuid, 
  manual_id uuid, 
  chunk_text text, 
  chunk_order integer, 
  page_number integer, 
  similarity double precision, 
  manual_filename text, 
  original_manual_filename text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        mc.id,
        mc.manual_id,
        mc.chunk_text,
        mc.chunk_order,
        mc.page_number,
        1 - (mc.embedding <=> query_embedding) AS similarity,
        m.file_name AS manual_filename,
        m.original_file_name AS original_manual_filename
    FROM manual_chunks mc
    JOIN manuals m ON mc.manual_id = m.id
    WHERE 
        mc.embedding IS NOT NULL
        AND (1 - (mc.embedding <=> query_embedding)) > match_threshold
        AND (
            p_share_id IS NOT NULL OR 
            (p_user_id IS NOT NULL AND m.user_id = p_user_id)
        )
        AND (
            p_selected_manual_ids IS NULL OR 
            m.id = ANY(p_selected_manual_ids)
        )
    ORDER BY mc.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
```

### マイグレーション4: vectorエクステンションのスキーマ移動（注意：実行推奨しない）

**⚠️ 警告**: このマイグレーションは実行しないことを推奨します。

**理由**: vectorエクステンションを移動すると`public.vector`型が存在しなくなり、以下の問題が発生します：
- manual_chunksテーブルのembeddingカラム（vector型）への挿入エラー
- Edge Function内でのvector型参照エラー
- ファイルアップロード処理の500エラー

**マイグレーション名**: `move_vector_extension_to_extensions_schema` 

```sql
-- ⚠️ 実行非推奨: Move vector extension from public schema to extensions schema
-- This addresses the "Extension in Public" security warning but breaks functionality

-- Move the vector extension to the extensions schema
ALTER EXTENSION vector SET SCHEMA extensions;

-- Grant usage on the extensions schema to public role so existing functions can access vector types
GRANT USAGE ON SCHEMA extensions TO public;
```

**もし実行してしまった場合のロールバック**:
```sql
-- Rollback: Move vector extension back to public schema
ALTER EXTENSION vector SET SCHEMA public;
```

## 実行順序
1. マイグレーション1 (RLSポリシー修正) - **最優先**
2. マイグレーション2 (関数search_path修正)
3. マイグレーション3 (複数パラメータ関数修正)
4. ~~マイグレーション4 (エクステンション移動)~~ - **実行非推奨**

**推奨**: マイグレーション1-3のみを実行してください。

## 検証方法

### 修正前後の確認
```sql
-- RLSポリシーの確認
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check 
FROM pg_policies 
WHERE schemaname = 'public' 
ORDER BY tablename, policyname;

-- 関数のsearch_path確認
SELECT 
  proname,
  pg_get_function_identity_arguments(oid) as arguments,
  proconfig
FROM pg_proc 
WHERE proname IN ('match_manual_chunks', 'update_processing_jobs_updated_at')
ORDER BY oid;

-- vectorエクステンションの場所確認
SELECT 
  extname,
  nspname as schema_name,
  extversion
FROM pg_extension e
JOIN pg_namespace n ON e.extnamespace = n.oid
WHERE extname = 'vector';
```

### セキュリティアドバイザー再確認
```bash
# MCPツールで最終確認
# mcp_supabase_get_advisors でセキュリティ警告が0件になることを確認
```

## 重要な注意事項

### 既存データへの影響
- ✅ **user_id形式は変更なし**: Clerkの`user_xxx`形式は維持
- ✅ **データアクセス継続**: 既存ユーザーは引き続き自分のデータにアクセス可能
- ✅ **機能の継続性**: すべてのアプリケーション機能は正常に動作

### 認証について
- `auth.jwt() ->> 'sub'`がClerkのuser_idに対応
- user_metadataは編集可能でセキュリティリスクがあるため使用禁止
- 修正後はより安全な認証方式に統一

### 期待される結果（推奨マイグレーション1-3実行後）
- **ERRORレベル**: 7件 → 0件 ✅ 
- **WARNINGレベル**: 3件 → 1件 ⚠️ (Extension in Public残存)
- **総セキュリティ警告**: 10件 → 1件

**重要**: ERRORレベルの重大なセキュリティ脆弱性はすべて解決されます。

## トラブルシューティング

### よくある問題
1. **権限エラー**: SECURITY DEFINERが適切に設定されているか確認
2. **関数実行エラー**: search_pathにextensionsスキーマが含まれているか確認
3. **アクセス拒否**: RLSポリシーが適切に`auth.jwt() ->> 'sub'`を使用しているか確認

### ログ確認方法
```bash
# Supabaseダッシュボードまたは以下のMCPツールでログ確認
# mcp_supabase_get_logs で postgres サービスのログを確認
```

## 実行履歴（開発環境）
- 実行日: 2025年1月
- 対象プロジェクト: care-manual-ai-dev (komywhfdmjrmcamlgdnd)
- 結果: ERRORレベル脆弱性すべて解決、機能正常動作

### 実行した内容
✅ マイグレーション1: RLSセキュリティ脆弱性修正  
✅ マイグレーション2: 関数search_pathセキュリティ修正  
✅ マイグレーション3: 複数パラメータ関数修正  
❌ マイグレーション4: vectorエクステンション移動（ロールバック済み）

### 発生した問題と対応
**問題**: vectorエクステンション移動により`public.vector`型エラーが発生
- ファイルアップロード時の500エラー
- manual_chunksテーブルへの挿入失敗

**対応**: vectorエクステンションをpublicスキーマにロールバック
```sql
ALTER EXTENSION vector SET SCHEMA public;
```

**教訓**: vectorエクステンション移動は既存の型参照に影響するため非推奨 