# E2E テストスクリプト（Playwright-mcp使用）

このディレクトリには、[docs/launch_test_checklist.md](../docs/launch_test_checklist.md) に基づいたE2Eテストスクリプトが含まれています。

## 🚀 Playwright-mcp を使った自動テストについて

このテストスクリプトは、[Playwright-mcp](https://github.com/microsoft/playwright-mcp) と Cursor を使用して作成されました。記事「[Playwright-mcp を使ったE2Eテストスクリプトの作成を試してみた](https://zenn.dev/aldagram_tech/articles/3614dbabbf2f5d)」の手法に沿って実装されています。

## 📋 テスト構成

### 🚨 最優先テスト（Critical Tests）
- **A1. 基本動作確認** (`tests/critical/A1-basic-functionality.spec.ts`)
  - ログイン・ログアウト機能
  - ファイルアップロード機能  
  - AIチャット基本機能
  - メモ作成・編集・保存機能
  - 共有URL生成機能

- **A2. セキュリティ基本確認** (`tests/critical/A2-security-user-isolation.spec.ts`) 
  - ユーザー分離確認（★★★ 最重要）
  - API認証確認
  - URL直接アクセス防止

## 🛠 セットアップ

### 1. 依存関係のインストール

```bash
npm install
npx playwright install
```

### 2. 環境変数の設定

テスト実行前に以下の環境変数が設定されていることを確認してください：

```bash
# .env.local または環境変数として設定
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_key
```

### 3. テスト用ファイルの準備

`tests/fixtures/files/` ディレクトリに以下のテストファイルを配置してください：

```
tests/fixtures/files/
├── test-manual.pdf      # PDFテスト用ファイル
├── test-document.docx   # Wordテスト用ファイル  
├── test-image.jpg       # 無効ファイルテスト用
└── large-file.pdf       # 大容量ファイルテスト用
```

### 4. テストユーザーの準備

以下のテストユーザーをClerkに事前登録してください：

- **ユーザーA**: `test-user-a@example.com`
- **ユーザーB**: `test-user-b@example.com`

## 🎯 テスト実行

### 基本的な実行方法

```bash
# 全テスト実行
npm run test

# ヘッドレスモードで実行（ブラウザ表示なし）
npm run test -- --headed=false

# ブラウザを表示して実行
npm run test:headed

# 特定のテストファイルのみ実行
npm run test tests/critical/A1-basic-functionality.spec.ts

# 特定のブラウザでのみ実行
npm run test -- --project=chromium
```

### セキュリティテストの重点実行

最重要のセキュリティテストのみを実行：

```bash
npm run test tests/critical/A2-security-user-isolation.spec.ts -- --headed
```

### テスト結果の確認

```bash
# HTML レポートを開く
npx playwright show-report
```

## 🔧 Cursor + Playwright-mcp での開発

### 新しいテストの自動生成

1. **Cursor で MCP サーバーが有効になっていることを確認**
   - 右上の設定 → MCP → `playwright` サーバーが動作中

2. **Playwright-mcp を使った自動テスト生成**

Cursor のチャットで以下のようなプロンプトを使用：

```
# 基本的なテスト生成
「レスポンシブデザイン確認のテストを作成してください。
PC、タブレット、スマートフォンの各画面サイズで全機能が適切に表示されることを確認するテストスクリプトをPlaywrightで生成してください。」

# エラーハンドリングテスト生成  
「ネットワーク断、不正ファイル、大容量ファイルのエラーハンドリングテストを作成してください。
適切なエラーメッセージが表示されることを確認するPlaywrightテストを生成してください。」

# パフォーマンステスト生成
「初期読み込み速度、AI回答速度、大量データ処理のパフォーマンステストを作成してください。」
```

### テストの段階的実装

1. **Page Object パターンでの実装**
```
「ChatInterfaceのPage Objectクラスを作成してください。
AIチャット機能のロケーターとメソッドを含むクラスを生成してください。」
```

2. **テストケースの分割作成**
```
「メモ機能のテストケースを作成してください。
新規作成、編集、削除、重要フラグ設定の各機能を個別にテストするスクリプトを生成してください。」
```

## 🎨 テスト実行のコツ

### 効率的なデバッグ

```bash
# 失敗時にブラウザを開いたままにする
npm run test -- --headed --debug

# 特定のテストをステップ実行
npm run test -- --headed --debug tests/critical/A2-security-user-isolation.spec.ts

# トレース機能を有効にして実行
npm run test -- --trace=on
```

### CI/CD での実行

```bash
# CI環境での実行（並列処理無効、リトライ有効）
npm run test -- --workers=1 --retries=2
```

## 📊 テスト優先度

### 🚨 必須実行（ローンチ前に必ず実施）
- `A1-basic-functionality.spec.ts` - 基本機能の動作確認
- `A2-security-user-isolation.spec.ts` - セキュリティ確認（特にユーザー分離）

### 🔍 推奨実行（時間があれば実施）
- レスポンシブデザイン確認
- ブラウザ互換性確認
- パフォーマンス確認

### 📋 補完実行（余裕があれば実施）
- 詳細エラーケース
- エッジケース
- 負荷テスト

## ⚠️ 注意事項

1. **セキュリティテストは本番環境では実行しない**
   - ユーザー分離テストは必ずテスト環境で実施

2. **テスト用データのクリーンアップ**
   - テスト後は作成したメモ・ファイルを削除

3. **APIレート制限への対応**
   - AI機能のテストは適切な間隔を開けて実行

4. **テストユーザーの管理**
   - 本番環境にテストユーザーアカウントを作成しない

## 🔗 参考リンク

- [Playwright-mcp 公式ドキュメント](https://github.com/microsoft/playwright-mcp)
- [Playwright 公式ドキュメント](https://playwright.dev/)
- [参考記事: Playwright-mcpを使ったE2Eテストスクリプトの作成](https://zenn.dev/aldagram_tech/articles/3614dbabbf2f5d)
- [ローンチ前テストチェックリスト](../docs/launch_test_checklist.md) 