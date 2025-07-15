-- Vercel Blob実装を元に戻すためのマイグレーション

-- blob_urlカラムのインデックスを削除
DROP INDEX IF EXISTS idx_manuals_blob_url;

-- blob_urlカラムを削除
ALTER TABLE manuals 
DROP COLUMN IF EXISTS blob_url; 