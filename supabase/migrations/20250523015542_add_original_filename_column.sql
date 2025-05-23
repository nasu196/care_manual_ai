-- manualsテーブルにoriginal_file_nameカラムを追加
-- 日本語ファイル名対応のため、元のファイル名を保存するカラム

ALTER TABLE IF EXISTS manuals 
ADD COLUMN IF NOT EXISTS original_file_name TEXT;

-- 既存レコードについては、file_nameの値をoriginal_file_nameにコピー
UPDATE manuals 
SET original_file_name = file_name 
WHERE original_file_name IS NULL;
