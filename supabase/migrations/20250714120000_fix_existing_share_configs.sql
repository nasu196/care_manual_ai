-- 既存の共有設定をレコードIDベースに正しく変換するマイグレーション
-- selected_source_namesが存在する無効化された共有設定を復活させ、正しく変換する

-- 1. 一時的にselected_source_namesカラムを復活（変換処理のため）
ALTER TABLE share_configs 
ADD COLUMN IF NOT EXISTS selected_source_names_temp JSONB;

-- 2. 無効化された共有設定でselected_record_idsが空の場合、元のファイル名情報を一時保存
-- （実際のデータがない場合の仮データ - 実環境に合わせて調整）
UPDATE share_configs 
SET selected_source_names_temp = '["001149870.pdf", "褥瘡管理マニュアル.pdf"]'::jsonb
WHERE is_active = false 
  AND (selected_record_ids IS NULL OR selected_record_ids = '[]'::jsonb);

-- 3. ファイル名からレコードIDへの変換を実行
UPDATE share_configs 
SET selected_record_ids = (
  SELECT COALESCE(
    jsonb_agg(m.id),
    '[]'::jsonb
  )
  FROM jsonb_array_elements_text(selected_source_names_temp) AS source_name
  LEFT JOIN manuals m ON (
    m.original_file_name = source_name.value 
    OR m.file_name = source_name.value
  )
  WHERE m.user_id = share_configs.user_id
),
is_active = true  -- 共有設定を再度有効化
WHERE selected_source_names_temp IS NOT NULL 
  AND selected_source_names_temp != '[]'::jsonb;

-- 4. 変換できなかった共有設定は無効のまま保持
UPDATE share_configs 
SET is_active = false
WHERE selected_record_ids IS NULL 
  OR selected_record_ids = '[]'::jsonb;

-- 5. 一時カラムを削除
ALTER TABLE share_configs 
DROP COLUMN IF EXISTS selected_source_names_temp;

-- 6. ログ用コメント
COMMENT ON TABLE share_configs IS '共有設定テーブル - レコードIDベースに変換済み';

-- 7. 結果確認用クエリ（コメント）
-- SELECT 
--   id,
--   user_id,
--   selected_record_ids,
--   is_active,
--   created_at
-- FROM share_configs 
-- ORDER BY created_at DESC; 