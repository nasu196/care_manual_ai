-- 共有設定の有効期限を削除するマイグレーション

-- expires_atカラムをオプショナルにし、既存のNOT NULL制約を削除
ALTER TABLE share_configs ALTER COLUMN expires_at DROP NOT NULL;

-- 既存のレコードのexpires_atをNULLに設定（永続化）
UPDATE share_configs SET expires_at = NULL;

-- 期限切れチェックのインデックスを削除
DROP INDEX IF EXISTS idx_share_configs_expires_at;

-- 期限切れ設定の自動削除関数を更新（is_activeのみチェック）
CREATE OR REPLACE FUNCTION cleanup_expired_share_configs()
RETURNS void AS $$
BEGIN
    DELETE FROM share_configs 
    WHERE is_active = FALSE;
END;
$$ LANGUAGE plpgsql;

-- コメント追加
COMMENT ON COLUMN share_configs.expires_at IS '有効期限（NULLの場合は永続的に有効）'; 