-- 共有設定テーブルの作成
CREATE TABLE share_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    selected_source_names JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE
);

-- インデックスの作成
CREATE INDEX idx_share_configs_user_id ON share_configs(user_id);
CREATE INDEX idx_share_configs_expires_at ON share_configs(expires_at);
CREATE INDEX idx_share_configs_active ON share_configs(is_active) WHERE is_active = TRUE;

-- RLSを有効化
ALTER TABLE share_configs ENABLE ROW LEVEL SECURITY;

-- RLSポリシー: ユーザーは自分の共有設定のみアクセス可能
CREATE POLICY "Users can manage their own share configs" ON share_configs
    FOR ALL USING ((auth.jwt()->'user_metadata'->>'user_id')::uuid = user_id);

-- 期限切れの共有設定を自動削除する関数（オプション）
CREATE OR REPLACE FUNCTION cleanup_expired_share_configs()
RETURNS void AS $$
BEGIN
    DELETE FROM share_configs 
    WHERE expires_at < NOW() OR is_active = FALSE;
END;
$$ LANGUAGE plpgsql;

-- 期限切れ設定の定期削除（1日1回実行）
-- 注意: pg_cronが有効な場合のみ動作します
-- SELECT cron.schedule('cleanup-expired-shares', '0 2 * * *', 'SELECT cleanup_expired_share_configs();'); 