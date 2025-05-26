-- RLSポリシーを有効化してユーザーごとのデータ分離を実現

-- manualsテーブルのRLS有効化
ALTER TABLE manuals ENABLE ROW LEVEL SECURITY;

-- manual_chunksテーブルのRLS有効化
ALTER TABLE manual_chunks ENABLE ROW LEVEL SECURITY;

-- manualsテーブルのポリシー: ユーザーは自分のマニュアルのみアクセス可能
CREATE POLICY "Users can only access their own manuals" ON manuals
    FOR ALL USING (auth.uid()::text = user_id);

-- manual_chunksテーブルのポリシー: ユーザーは自分のマニュアルのチャンクのみアクセス可能
CREATE POLICY "Users can only access chunks of their own manuals" ON manual_chunks
    FOR ALL USING (
        manual_id IN (
            SELECT id FROM manuals WHERE auth.uid()::text = user_id
        )
    );

-- Storageのポリシー: ユーザーは自分のファイルのみアクセス可能
-- manualsバケットのポリシーを設定
INSERT INTO storage.buckets (id, name, public) 
VALUES ('manuals', 'manuals', false)
ON CONFLICT (id) DO NOTHING;

-- Storageのポリシー: 自分のファイルのみ読み取り可能
CREATE POLICY "Users can view their own files" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'manuals' AND 
        auth.uid()::text IN (
            SELECT user_id FROM manuals WHERE file_name = name
        )
    );

-- Storageのポリシー: 自分のファイルのみアップロード可能
CREATE POLICY "Users can upload their own files" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'manuals' AND 
        auth.uid()::text IS NOT NULL
    );

-- Storageのポリシー: 自分のファイルのみ削除可能
CREATE POLICY "Users can delete their own files" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'manuals' AND 
        auth.uid()::text IN (
            SELECT user_id FROM manuals WHERE file_name = name
        )
    ); 