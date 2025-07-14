-- share_configsテーブルをrecordIdベースに変更するマイグレーション

-- 新しいカラムを追加
ALTER TABLE share_configs 
ADD COLUMN selected_record_ids JSONB DEFAULT '[]'::jsonb;

-- 既存のデータを変換（selected_source_namesからselected_record_idsへ）
-- 注意：このマイグレーションは既存の共有設定を無効化します
UPDATE share_configs 
SET is_active = false
WHERE selected_source_names IS NOT NULL AND selected_source_names != '[]'::jsonb;

-- 古いカラムを削除
ALTER TABLE share_configs 
DROP COLUMN selected_source_names;

-- インデックスを追加
CREATE INDEX idx_share_configs_record_ids ON share_configs USING GIN (selected_record_ids);

-- コメントを追加
COMMENT ON COLUMN share_configs.selected_record_ids IS '共有対象のマニュアルレコードID配列';

-- 期限切れ設定の自動削除関数を更新（変更なし）
CREATE OR REPLACE FUNCTION cleanup_expired_share_configs()
RETURNS void AS $$
BEGIN
    DELETE FROM share_configs 
    WHERE is_active = FALSE;
END;
$$ LANGUAGE plpgsql; 