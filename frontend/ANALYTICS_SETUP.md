# Google Analytics 4 & Microsoft Clarity 設定手順 + サブドメイン対応

## 概要
このプロジェクトでは、Google Analytics 4 (GA4) と Microsoft Clarity によるアクセス解析を実装しています。
サブドメイン間でのCookie同意管理システムも含まれており、一度の同意で全ドメインに適用される統一管理が可能です。

## 環境変数の設定

### 1. 環境変数ファイルの作成
プロジェクトルートに `.env.local` ファイルを作成してください。

```bash
# Google Analytics 4 (GA4)
NEXT_PUBLIC_GOOGLE_ANALYTICS_ID=G-XXXXXXXXXX

# Microsoft Clarity
NEXT_PUBLIC_CLARITY_PROJECT_ID=XXXXXXXXXX

# サブドメイン対応設定
NEXT_PUBLIC_DOMAIN=your-domain.com
NEXT_PUBLIC_SUBDOMAINS=app,api,docs
```

### 2. GA4 測定IDの取得
1. [Google Analytics](https://analytics.google.com/) にアクセス
2. 新しいプロパティを作成
3. データストリーム（ウェブ）を作成
4. 測定ID（G-XXXXXXXXXX）をコピー

### 3. Clarity プロジェクトIDの取得
1. [Microsoft Clarity](https://clarity.microsoft.com/) にアクセス
2. 新しいプロジェクトを作成
3. プロジェクトID（XXXXXXXXXX）をコピー

## 実装内容

### 追加されたファイル
- `frontend/src/components/common/Analytics.tsx` - 動的トラッキングスクリプトコンポーネント
- `frontend/src/components/common/CookieConsent.tsx` - Cookie同意管理コンポーネント
- `frontend/src/app/cookie-sync/page.tsx` - サブドメイン間Cookie同期エンドポイント
- `frontend/src/lib/analytics.ts` - イベントトラッキング関数
- `frontend/ANALYTICS_SETUP.md` - 設定手順（このファイル）

### 変更されたファイル
- `frontend/src/app/layout.tsx` - Analyticsコンポーネントの追加
- `frontend/next.config.ts` - 環境変数の設定

## 使用方法

### 基本的なイベントトラッキング
```typescript
import { analytics } from '@/lib/analytics';

// ページビュー
analytics.pageView(window.location.href);

// ユーザーアクション
analytics.userAction('button_click', 'navigation', 'header_menu');

// ファイルアップロード
analytics.fileUpload('pdf', 1024000);

// エラー追跡
analytics.error('API request failed', false);

// 検索
analytics.search('介護マニュアル');

// フィードバック
analytics.feedback(5, 'user_satisfaction');
```

### 直接的なイベント送信
```typescript
import { gtag, clarityTrack } from '@/lib/analytics';

// GA4イベント
gtag('event', 'custom_event', {
  custom_parameter: 'value'
});

// Clarityイベント
clarityTrack('custom_event', {
  custom_property: 'value'
});
```

## 動作確認

### GA4の確認
1. ブラウザの開発者ツールを開く
2. Networkタブで `gtag/js` のリクエストを確認
3. GA4リアルタイムレポートでトラフィックを確認

### Clarityの確認
1. ブラウザの開発者ツールを開く
2. Networkタブで `clarity.ms` のリクエストを確認
3. Clarityダッシュボードでセッションを確認

## 注意事項

- 環境変数が設定されていない場合、トラッキングスクリプトは読み込まれません
- 本番環境と開発環境で異なる測定ID/プロジェクトIDを使用することを推奨
- プライバシーポリシーの更新を忘れずに行ってください 