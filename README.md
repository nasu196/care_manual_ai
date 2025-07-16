# care_manual_ai
介護施設向けAIマニュアルツール

## 🌿 開発環境

### Supabase環境構成

**本番環境 (Production)**
- Project ID: `rgvygxptjkjfsgfkmlwl`
- Branch: `main` (default)
- URL: https://rgvygxptjkjfsgfkmlwl.supabase.co

**開発環境 (Development)**
- Project ID: `axfcggmldezzvhpowtwn`
- Branch: `develop`
- Parent: `rgvygxptjkjfsgfkmlwl` (production)
- Status: Preview Branch

### GitHub環境構成

**現在のブランチ**: `develop`
- 開発作業は`develop`ブランチで実施
- 本番リリース時は`main`ブランチにマージ

### 開発ワークフロー

```bash
# Supabaseブランチでの開発
1. develop環境 (axfcggmldezzvhpowtwn) で機能開発
2. MCP/CLIで自由に調整・実験
3. 完了後にmainブランチにマージして本番適用

# GitHubブランチとの連携
1. GitHub develop ブランチで開発
2. Supabase develop ブランチと並行して作業
3. 両方の変更をmainにマージ
```

---

## 認証方式の変更履歴

### 2024年12月 - JWT Template方式への回帰

**背景**: Supabase Third-Party Auth統合でClerkのJWT情報が正常に取得できない問題が発生したため、より安定した認証方式に変更しました。

**変更内容**:
1. **Edge Functions設定**: `verify_jwt = false`に変更し、手動でJWT検証を実行
2. **Clerk JWT Template**: 既存の`supabase`テンプレートを使用してSupabase用のJWTを生成
3. **RLS Policy**: `auth.jwt()->>'sub'`を使用したユーザー分離を継続

**利点**:
- 認証フローの制御が明確
- デバッグが容易
- 既存のRLSポリシーとの互換性維持

---

## 技術的メモ: フロントエンドからのEdge Function呼び出し (Clerk認証連携)

Clerk認証を導入したSupabase Edge Function (特に `create-memo` など) をフロントエンドから呼び出す際に、いくつかの試行錯誤がありました。

### 課題と経緯

1.  **`supabaseClient.functions.invoke()` の標準的な利用**:
    *   ClerkのJWTをリクエストヘッダーに標準で付与する仕組みがなく、認証連携が困難でした。

2.  **カスタムユーティリティ `invokeFunction` の導入**:
    *   `frontend/src/lib/supabaseFunctionUtils.ts` に、Clerkトークンをヘッダーに付与するユーティリティを作成しました。
    *   しかし、このユーティリティが内部で利用する `supabaseClient.functions.invoke()` の挙動とClerkトークン認証の相性、あるいはEdge Function側の期待する認証ヘッダーとの間に微妙な齟齬があった可能性があり、一部で不安定さが残りました。

3.  **Next.js APIルート経由の試み**:
    *   フロントエンドからの呼び出しをNext.jsのAPIルート (`/api/...`) に集約し、サーバーサイドでEdge Functionを呼び出す方法を試みました。
    *   しかし、該当のAPIルートが存在しなかったため404エラーが発生し、このアプローチは採用しませんでした。（App Router利用時のRoute Handlerの検討も含む）

### 最終的な解決策と実装方針

最も安定し、Clerk認証との連携が確実な方法として、以下の方式を採用しました。

*   **フロントエンドから標準の `fetch` API を直接使用する。**
*   呼び出し先のURLには、**Supabase Edge Functionの完全なURL** (`<SUPABASE_PROJECT_URL>/functions/v1/<function-name>`) を指定する。
*   リクエストヘッダーには以下を明示的に設定する:
    *   `'Content-Type': 'application/json'`
    *   `'Authorization': \`Bearer \${clerkToken}\`` (Clerkの `getToken()` で取得したトークン)
    *   必要に応じて `'x-clerk-user-id': userId` (Edge Function側がこのヘッダーを参照する場合)

この方針により、Clerk認証とSupabase Edge Functionの連携がシンプルかつ確実に実現できました。

### 主な適用箇所

*   AIによるメモ生成時の `create-memo` 呼び出し (`frontend/src/components/admin/MemoTemplateSuggestions.tsx`)
*   その他、`MemoStudio.tsx` などでユーザー操作に基づいてEdge Functionを呼び出す箇所も同様の思想で実装されています（ただし、そちらは当初より `invokeFunction` 経由でClerkトークンを渡す形である程度安定していた部分もあり、必要に応じて上記 `fetch` 直叩き方式へのリファクタリングも検討可能です）。

このメモは、将来的に同様の機能追加や改修を行う際の参考としてください。
