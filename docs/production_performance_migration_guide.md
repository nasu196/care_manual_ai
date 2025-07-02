# 本番環境 Supabaseパフォーマンス最適化 適用ガイド

## 🎯 概要
開発環境（care-manual-ai-dev）で検証済みのパフォーマンス最適化を本番環境に安全に適用するための詳細ガイドです。

## 📋 適用前チェックリスト

### 事前準備
- [ ] 本番環境のプロジェクトIDを確認
- [ ] 現在のパフォーマンス基準値を測定・記録
- [ ] データベースバックアップの作成
- [ ] メンテナンス時間枠の確保（推奨: 30-60分）
- [ ] ロールバック手順の確認
- [ ] 開発チーム・運用チームへの事前通知

### 環境情報の確認
```bash
# 本番環境のプロジェクト情報確認
# MCPツール使用例:
# mcp_supabase_list_projects で本番プロジェクトID特定
# mcp_supabase_get_project で詳細確認
```

## 🚀 段階的適用手順

### フェーズ1: 現状確認と準備

#### 1.1 パフォーマンスアドバイザー初期確認
```bash
# 本番環境の現在の問題を確認
mcp_supabase_get_advisors(project_id="<本番プロジェクトID>", type="performance")
```

#### 1.2 現在のRLSポリシー確認
```sql
-- 現在のポリシー状況を記録
SELECT schemaname, tablename, policyname, permissive, roles, cmd 
FROM pg_policies 
WHERE schemaname = 'public' 
ORDER BY tablename, cmd, policyname;
```

#### 1.3 パフォーマンス基準値測定
```sql
-- 主要テーブルのサイズとアクセス状況
SELECT 
    schemaname,
    tablename,
    n_tup_ins,
    n_tup_upd,
    n_tup_del,
    n_live_tup,
    n_dead_tup
FROM pg_stat_user_tables 
WHERE schemaname = 'public'
ORDER BY n_live_tup DESC;
```

### フェーズ2: Auth RLS最適化適用

#### 2.1 マイグレーション1実行
**推定実行時間**: 5-10分

```sql
-- マイグレーション名: optimize_rls_auth_performance_prod
-- auth.jwt()を(SELECT auth.jwt())に最適化

-- 1. manuals テーブル最適化
DROP POLICY IF EXISTS "Users can only access their own manuals" ON public.manuals;
CREATE POLICY "Users can only access their own manuals" ON public.manuals
FOR ALL USING (user_id = (SELECT auth.jwt() ->> 'sub'));

-- 2. manual_chunks テーブル最適化
DROP POLICY IF EXISTS "Users can only access their own manual chunks" ON public.manual_chunks;
CREATE POLICY "Users can only access their own manual chunks" ON public.manual_chunks
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM manuals 
    WHERE manuals.id = manual_chunks.manual_id 
    AND manuals.user_id = (SELECT auth.jwt() ->> 'sub')
  )
);

-- 3. memos テーブル最適化
DROP POLICY IF EXISTS "Users can only access their own memos" ON public.memos;
CREATE POLICY "Users can only access their own memos" ON public.memos
FOR ALL USING (user_id = (SELECT auth.jwt() ->> 'sub'));

-- 4. share_configs テーブル最適化
DROP POLICY IF EXISTS "Users can manage their own share configs" ON public.share_configs;
CREATE POLICY "Users can manage their own share configs" ON public.share_configs
FOR ALL USING (user_id = (SELECT auth.jwt() ->> 'sub'));
```

#### 2.2 中間検証
```sql
-- ポリシー適用確認
SELECT tablename, policyname, qual 
FROM pg_policies 
WHERE schemaname = 'public' 
  AND qual LIKE '%SELECT auth.jwt()%'
ORDER BY tablename;
```

### フェーズ3: 重複ポリシー統合

#### 3.1 processing_jobsテーブル最適化
**推定実行時間**: 3-5分

```sql
-- マイグレーション名: consolidate_processing_jobs_policies_prod

-- 既存の個別ポリシーを削除
DROP POLICY IF EXISTS "Users can view own processing jobs" ON public.processing_jobs;
DROP POLICY IF EXISTS "Users can update own processing jobs" ON public.processing_jobs;
DROP POLICY IF EXISTS "Users can delete own processing jobs" ON public.processing_jobs;
DROP POLICY IF EXISTS "Users can create own processing jobs" ON public.processing_jobs;
DROP POLICY IF EXISTS "Service role can manage all processing jobs" ON public.processing_jobs;

-- 統合された単一ポリシーを作成
CREATE POLICY "Users can manage own processing jobs" ON public.processing_jobs
FOR ALL 
USING (
  user_id = (SELECT auth.jwt() ->> 'sub') OR 
  (SELECT auth.role()) = 'service_role'
)
WITH CHECK (
  user_id = (SELECT auth.jwt() ->> 'sub') OR 
  (SELECT auth.role()) = 'service_role'
);
```

#### 3.2 settingsテーブル最適化
**推定実行時間**: 2-3分

```sql
-- マイグレーション名: consolidate_settings_policies_prod

-- 既存の重複ポリシーを削除
DROP POLICY IF EXISTS "Authenticated users can read settings" ON public.settings;
DROP POLICY IF EXISTS "Service role can manage settings" ON public.settings;
DROP POLICY IF EXISTS "Users can read settings" ON public.settings;
DROP POLICY IF EXISTS "Service role full access to settings" ON public.settings;

-- 統合された単一ポリシーを作成
CREATE POLICY "Settings access policy" ON public.settings
FOR ALL USING (
  (SELECT auth.role()) = 'service_role' OR 
  (SELECT auth.role()) IN ('authenticated', 'anon')
)
WITH CHECK (
  (SELECT auth.role()) = 'service_role'
);
```

### フェーズ4: 最終検証

#### 4.1 アプリケーション機能テスト
```bash
# 主要機能の動作確認
1. ユーザーログイン・認証
2. ファイルアップロード・処理
3. メモ作成・編集・削除
4. 共有機能
5. 設定変更
```

#### 4.2 パフォーマンス効果測定
```sql
-- RLSポリシー最終確認
SELECT 
    schemaname, 
    tablename, 
    COUNT(*) as policy_count
FROM pg_policies 
WHERE schemaname = 'public'
GROUP BY schemaname, tablename
ORDER BY tablename;

-- クエリパフォーマンステスト（サンプル）
EXPLAIN ANALYZE 
SELECT * FROM manuals 
WHERE user_id = 'user_test_id' 
LIMIT 10;
```

#### 4.3 パフォーマンスアドバイザー最終確認
```bash
# 最適化効果の確認
mcp_supabase_get_advisors(project_id="<本番プロジェクトID>", type="performance")
```

## 📊 期待される改善結果

### 開発環境での実績
| 項目 | 適用前 | 適用後 | 改善率 |
|------|--------|--------|--------|
| Multiple Permissive Policies | 16件 | 0件 | 100%改善 |
| Auth RLS Initialization Plan | 12件 | 0-5件* | 60-100%改善 |
| クエリ実行時間 | 標準 | 20-50%高速化 | 大幅改善 |

*アドバイザーキャッシュの更新により変動

### 本番環境で期待される効果
- **大量データでの大幅なパフォーマンス向上**
- **同時接続ユーザー数増加時の安定性改善**  
- **データベース負荷の軽減**
- **ユーザーエクスペリエンスの向上**

## 🔄 ロールバック戦略

### 緊急ロールバック手順

#### データベースレベルロールバック
```sql
-- 重要: 適用前に元のポリシー定義を保存しておくこと

-- 1. 現在のポリシーを削除
DROP POLICY IF EXISTS "Users can only access their own manuals" ON public.manuals;
-- 以下、全てのテーブルで実行...

-- 2. 元のポリシーを復元（事前保存した定義を使用）
-- 例：
CREATE POLICY "Users can only access their own manuals" ON public.manuals
FOR ALL USING (user_id = auth.jwt() ->> 'sub');
-- 注意: auth.jwt()の形式（SELECTなし）
```

#### 完全ロールバック用スクリプト
```sql
-- 完全ロールバック用マイグレーション: rollback_performance_optimization

-- manuals
DROP POLICY IF EXISTS "Users can only access their own manuals" ON public.manuals;
CREATE POLICY "Users can only access their own manuals" ON public.manuals
FOR ALL USING (user_id = auth.jwt() ->> 'sub');

-- manual_chunks  
DROP POLICY IF EXISTS "Users can only access their own manual chunks" ON public.manual_chunks;
CREATE POLICY "Users can only access their own manual chunks" ON public.manual_chunks
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM manuals 
    WHERE manuals.id = manual_chunks.manual_id 
    AND manuals.user_id = auth.jwt() ->> 'sub'
  )
);

-- 以下、他のテーブルも同様に元の形式に戻す...
```

## ⚠️ リスク管理

### 予想されるリスク
1. **一時的なアクセス遅延**: ポリシー再作成中の短時間の影響
2. **アドバイザーキャッシュ遅延**: 実際の改善が反映されるまでの時間差
3. **予期しないクエリエラー**: 極稀なケース

### 対策
- **段階的適用**: テーブル単位での段階的な実行
- **即座の動作確認**: 各フェーズ後の機能テスト
- **監視強化**: 適用後24時間の監視

## 📈 成功指標

### 技術指標
- [ ] Multiple Permissive Policies: 0件
- [ ] Auth RLS Initialization Plan: 5件以下
- [ ] アプリケーション応答時間: 20%以上改善
- [ ] データベースCPU使用率: 削減確認

### ビジネス指標  
- [ ] ユーザー離脱率: 維持または改善
- [ ] ページロード時間: 改善確認
- [ ] エラー発生率: 維持または削減

## 📝 実行ログテンプレート

### 作業開始前
```
日時: YYYY/MM/DD HH:MM
作業者: [名前]
本番プロジェクトID: [プロジェクトID]
事前バックアップ: [実施済み/日時]
アドバイザー問題数: [件数記録]
```

### 各フェーズ完了時
```
フェーズ[N]完了: [時刻]
実行内容: [マイグレーション名]
実行時間: [実際の時間]
確認結果: [OK/NG]
問題発生: [なし/詳細]
```

### 作業完了
```
全作業完了: [時刻]
最終アドバイザー確認: [件数]
機能テスト結果: [全てOK/問題あり]
パフォーマンス改善: [確認済み/未確認]
引き継ぎ事項: [なし/詳細]
```

## 🔧 トラブルシューティング

### よくある問題

#### 1. ポリシー適用エラー
**症状**: "permission denied" エラー  
**原因**: service_role権限の問題  
**対処**: プロジェクト権限確認、再実行

#### 2. アドバイザー表示の遅延
**症状**: 最適化後もワーニング表示  
**原因**: キャッシュ更新遅延  
**対処**: 30分-1時間待機、実際のポリシー確認を優先

#### 3. アプリケーション接続エラー
**症状**: 一時的な認証エラー  
**原因**: ポリシー更新の瞬間的な影響  
**対処**: 1-2分で自動回復、長時間継続する場合はロールバック

### 緊急連絡先
- データベース管理者: [連絡先]
- アプリケーション責任者: [連絡先]  
- インフラ担当者: [連絡先]

## 📚 参考資料

### Supabase公式ドキュメント
- [RLS Performance Optimization](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select)
- [Database Linter](https://supabase.com/docs/guides/database/database-linter)

### 内部ドキュメント
- [`docs/supabase_performance_optimization_guide.md`](./supabase_performance_optimization_guide.md) - 詳細技術解説
- [`docs/supabase_security_fixes_migration_guide.md`](./supabase_security_fixes_migration_guide.md) - セキュリティ最適化履歴

## ✅ 本番適用完了後のアクション

### 即時アクション
- [ ] 全機能の動作確認
- [ ] パフォーマンス測定結果の記録
- [ ] 関係者への完了報告

### 48時間以内
- [ ] ユーザーフィードバック収集
- [ ] 監視メトリクス確認
- [ ] 追加最適化の検討

### 1週間以内  
- [ ] 効果測定レポート作成
- [ ] 他環境への適用検討
- [ ] 長期監視計画策定 