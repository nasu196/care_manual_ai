# サブドメイン間Cookie同意管理システム設定手順

## 概要
このシステムは、メインドメインとサブドメイン間でCookie同意状態を統一管理し、ユーザーのプライバシー保護とUX向上を両立させるソリューションです。

## 🎯 主な機能

- ✅ **統一管理**: 一度の同意で全ドメインに適用
- ✅ **双方向同期**: どのドメインで同意しても他に反映
- ✅ **プライバシー準拠**: 拒否時の完全なCookie削除
- ✅ **動的制御**: Cookie同意後に分析ツールを動的に有効化
- ✅ **セキュリティ**: オリジン検証による安全な通信

## 🔧 システム構成

### ドメイン構成例
```
your-domain.com          ← メインサイト
├── app.your-domain.com  ← SaaSアプリケーション
├── api.your-domain.com  ← API
└── docs.your-domain.com ← ドキュメント
```

### 実装されたコンポーネント

#### 1. CookieConsentコンポーネント
- **ファイル**: `frontend/src/components/common/CookieConsent.tsx`
- **機能**: 
  - Cookie同意バナーの表示
  - 親ドメインCookieでの同意状態管理
  - LocalStorageでの高速アクセス
  - クロスドメイン同期

#### 2. Analyticsコンポーネント（動的制御対応）
- **ファイル**: `frontend/src/components/common/Analytics.tsx`
- **機能**:
  - Cookie同意状態の監視
  - 分析ツールスクリプトの動的読み込み
  - 拒否時のスクリプト削除とCookie削除

#### 3. Cookie同期エンドポイント
- **ファイル**: `frontend/src/app/cookie-sync/page.tsx`
- **機能**:
  - サブドメイン間での同意状態同期
  - postMessage APIによる通信
  - 分析ツールの動的制御

## 🛠️ 設定手順

### 1. 環境変数の設定

`.env.local` ファイルに以下を追加：

```bash
# Google Analytics 4 (GA4)
NEXT_PUBLIC_GOOGLE_ANALYTICS_ID=G-XXXXXXXXXX

# Microsoft Clarity
NEXT_PUBLIC_CLARITY_PROJECT_ID=XXXXXXXXXX

# サブドメイン対応設定
NEXT_PUBLIC_DOMAIN=your-domain.com
NEXT_PUBLIC_SUBDOMAINS=app,api,docs
```

### 2. ドメイン設定のカスタマイズ

プロジェクトに応じて以下を調整：

```typescript
// CookieConsentコンポーネントで使用される設定
domain: 'your-domain.com'
subdomains: ['app', 'api', 'docs']
```

### 3. 各サブドメインへの配置

各サブドメインに以下のファイルを配置：
- `cookie-sync/page.tsx` エンドポイント
- `CookieConsent.tsx` コンポーネント
- `Analytics.tsx` コンポーネント

## 🔄 動作フロー

### 同意時の処理
1. ユーザーがメインドメインで「同意する」をクリック
2. LocalStorageに同意状態を保存
3. 親ドメインCookie (`.your-domain.com`) に同意状態を保存
4. サブドメインにiframe通信で同期
5. 各ドメインで分析ツールを動的に有効化

### 拒否時の処理
1. ユーザーが「拒否する」をクリック
2. 既存の分析ツールCookieを削除
3. 分析ツールスクリプトを削除
4. 拒否状態をサブドメインに同期
5. 各ドメインで分析ツールを無効化

## 📊 対応する分析ツール

### Google Analytics 4
- **削除対象Cookie**: `_ga`, `_gid`, `_gat_*`
- **制御方法**: 動的スクリプト読み込み/削除
- **完全停止**: スクリプト削除 + Cookie削除 + グローバル変数削除

### Microsoft Clarity
- **削除対象Cookie**: `_clck`, `_clsk`, `CLID`, `ANONCHK`, `SM`
- **制御方法**: 動的スクリプト読み込み/削除
- **完全停止**: スクリプト削除 + Cookie削除

## 🔒 セキュリティ機能

### オリジン検証
```typescript
const allowedOrigins = [
  `https://${domain}`,
  ...subdomains.map(sub => `https://${sub}.${domain}`)
];
```

### 入力検証
- URLパラメータの検証
- 同意状態の値チェック
- 送信元ドメインの検証

## 🧪 動作確認

### 1. Cookie同意バナーの表示
1. 初回訪問時にバナーが表示されることを確認
2. 「同意する」「拒否する」の両方をテスト

### 2. 分析ツールの動作確認
**同意後**:
- 開発者ツールのNetworkタブで `gtag/js` と `clarity.ms` のリクエストを確認
- GA4とClarityのCookieが設定されていることを確認

**拒否後**:
- 分析ツールのスクリプトが削除されていることを確認
- 関連Cookieが削除されていることを確認

### 3. サブドメイン間同期の確認
1. メインドメインで同意
2. サブドメインでページを開く
3. 同意バナーが表示されないことを確認
4. 分析ツールが動作していることを確認

## 🔍 トラブルシューティング

### よくある問題と解決策

#### 1. サブドメインで同意バナーが再表示される
**原因**: 親ドメインCookieの読み取り失敗
**解決策**: 
```javascript
// ブラウザのコンソールでデバッグ
console.log('Parent domain cookie:', document.cookie);
console.log('Local storage:', localStorage.getItem('cookieConsent'));
```

#### 2. 分析ツールが無効化されない
**原因**: スクリプトの削除不完全
**解決策**: 
```javascript
// すべての分析ツールスクリプトを確認
console.log('GA scripts:', document.querySelectorAll('script[src*="gtag"]'));
console.log('Clarity scripts:', document.querySelectorAll('script[src*="clarity"]'));
```

#### 3. クロスドメイン通信が失敗する
**原因**: CORS設定またはオリジン検証の問題
**解決策**: 
```javascript
// メッセージの送受信を確認
window.addEventListener('message', (event) => {
  console.log('Message from:', event.origin);
  console.log('Message data:', event.data);
});
```

## 🔮 今後の拡張可能性

### 1. 同意レベルの細分化
- 必須/分析/マーケティングの分離
- より細かい同意管理

### 2. 同意履歴の管理
- 同意変更の履歴記録
- 法的要件への対応

### 3. 追加分析ツールの対応
- Hotjar
- Facebook Pixel
- Google Tag Manager

## 📚 参考資料

### 技術仕様
- [postMessage API](https://developer.mozilla.org/docs/Web/API/Window/postMessage)
- [HTTP Cookies](https://developer.mozilla.org/docs/Web/HTTP/Cookies)
- [Same-origin policy](https://developer.mozilla.org/docs/Web/Security/Same-origin_policy)

### プライバシー法規
- [GDPR - Cookie同意要件](https://gdpr.eu/cookies/)
- [CCPA - プライバシー権利](https://oag.ca.gov/privacy/ccpa)

---

このシステムにより、サブドメイン間でのCookie同意管理が統一され、ユーザーのプライバシーが適切に保護されながら、必要な分析データの収集が可能になります。 