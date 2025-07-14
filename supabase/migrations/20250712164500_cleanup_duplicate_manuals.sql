-- クリーンアップ: 重複するmanualsレコードを整理
-- リネーム名を継承し、データの整合性を保つため、chunksが紐づいているレコードを残す

-- 1. リネーム名を継承（MDAxMTQ5ODcw.pdf）
-- chunksが紐づいている最新のレコードにリネーム名を継承
UPDATE manuals 
SET original_file_name = '感染症対策の手引きです.pdf' 
WHERE id = '5087cb57-be1e-4a08-b0a2-d765027bcfd8';

-- 2. リネーム名を継承（MGYyZjc0MmYzZjA0NTlmY2IwYWNiZTI1MDMwZmMwNjg.pdf）
-- chunksが紐づいている最新のレコードにリネーム名を継承
UPDATE manuals 
SET original_file_name = '褥瘡管理マニュアル.pdf' 
WHERE id = 'b15dedf7-c30c-4398-b32b-93bd062bee87';

-- 3. 古いレコードに紐づくchunksを削除（外部キー制約対応）
DELETE FROM manual_chunks WHERE manual_id IN (
  '3b5674c3-92c1-40f0-b1b7-f72df2bc4688',  -- dGVzdC1tYW51YWw.txt (古い)
  'a7a7859a-5c59-41de-9af9-21b9e8399838',  -- dGVzdC1tYW51YWw.txt (古い)
  'ed1d165c-2210-42a3-ae08-4a867deff27a',  -- MDAxMTQ5ODcw.pdf (古い)
  'c5528414-c008-45b2-b742-9ddff7f0758a',  -- MDAxMTQ5ODcw.pdf (古い、リネーム元)
  '202a8e3e-849e-4396-a330-a3b18c1f5ea3',  -- MGYyZjc0MmYzZjA0NTlmY2IwYWNiZTI1MDMwZmMwNjg.pdf (古い)
  '777c83a7-76f0-4d54-a847-122431e0cc62'   -- MGYyZjc0MmYzZjA0NTlmY2IwYWNiZTI1MDMwZmMwNjg.pdf (古い、リネーム元)
);

-- 4. 古い重複レコードを削除
DELETE FROM manuals WHERE id IN (
  '3b5674c3-92c1-40f0-b1b7-f72df2bc4688',  -- dGVzdC1tYW51YWw.txt (古い)
  'a7a7859a-5c59-41de-9af9-21b9e8399838',  -- dGVzdC1tYW51YWw.txt (古い)
  'ed1d165c-2210-42a3-ae08-4a867deff27a',  -- MDAxMTQ5ODcw.pdf (古い)
  'c5528414-c008-45b2-b742-9ddff7f0758a',  -- MDAxMTQ5ODcw.pdf (古い、リネーム元)
  '202a8e3e-849e-4396-a330-a3b18c1f5ea3',  -- MGYyZjc0MmYzZjA0NTlmY2IwYWNiZTI1MDMwZmMwNjg.pdf (古い)
  '777c83a7-76f0-4d54-a847-122431e0cc62'   -- MGYyZjc0MmYzZjA0NTlmY2IwYWNiZTI1MDMwZmMwNjg.pdf (古い、リネーム元)
);

-- 5. 結果確認用のクエリ（コメント）
-- SELECT file_name, COUNT(*) as count FROM manuals GROUP BY file_name HAVING COUNT(*) > 1; 