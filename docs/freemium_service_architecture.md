# フリーミアムサービス設計構想

## 概要

介護施設向けAIマニュアルツールのフリーミアム化と、将来的なマルチツールプラットフォーム構築に向けた設計構想。

## ビジネスモデル

### 将来構想：Google Workspace風統合プラットフォーム

```
┌─────────────────────────────────────────┐
│        統合プラットフォーム（月額1万円）                │
├─────────────────────────────────────────┤
│ 複数の介護DXツールを一つのプランで利用可能              │
└─────────────────────────────────────────┘

┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  accounts.domain.com │  │ caremanual.domain.com│  │ tool2.domain.com     │
│                  │  │                  │  │                  │
│ 🔐 ユーザー管理        │  │ 📖 介護マニュアルAI     │  │ 🛠️ 別ツール           │
│ 💳 決済管理          │  │ (現在のプロジェクト)      │  │                  │
│ ⚙️ プラン管理         │  │                  │  │                  │
│ 📊 組織管理          │  │                  │  │                  │
└──────────────────┘  └──────────────────┘  └──────────────────┘
        ↑                       ↑                       ↑
    統合管理画面              個別ツール1              個別ツール2
```

### 課金モデル：Organization-Based（B2B SaaS）

**基本方針：**
- 🏢 **介護事業所単位**での課金
- 👤 **個人ユーザー単位ではない**
- 🎫 **組織の全従業員**が有料機能を利用可能
- 👨‍💼 **決済責任者**（管理者）が組織を代表して契約

## 技術アーキテクチャ

### Clerk Organization構造

#### Organization Metadata例
```json
{
  "subscriptionStatus": "active",     // "active" | "inactive" | "trial"
  "subscriptionPlan": "premium",      // "free" | "premium" | "enterprise"
  "subscriptionExpiry": "2024-12-31",
  "paymentResponsible": "user_xyz123", // 決済責任者のUser ID
  "facilityName": "〇〇介護センター",
  "facilityType": "nursing_home",     // "nursing_home" | "day_service" | "home_care"
  "contractStartDate": "2024-01-01",
  "employeeCount": 25
}
```

#### User Roles
- `org:admin` - 決済責任者・組織管理者
- `org:member` - 一般従業員

### 権限チェック実装

#### Edge Functions
```javascript
// 組織ベース権限チェック
const { has, orgId } = await auth()

// 1. 組織メンバーかチェック
if (!has({ role: 'org:member' })) {
  return new Response('Organization membership required', { status: 403 })
}

// 2. 組織の有料プラン確認
const organization = await clerkClient.organizations.getOrganization({
  organizationId: orgId
})
const isPremiumOrg = organization.publicMetadata?.subscriptionStatus === 'active'

if (!isPremiumOrg) {
  return new Response('Organization subscription required', { status: 403 })
}
```

#### Frontend
```javascript
// React Hook
const { organization } = useOrganization()
const isPremiumOrg = organization?.publicMetadata?.subscriptionStatus === 'active'

if (!isPremiumOrg) {
  return <UpgradePrompt />
}
```

### Middleware設定
```javascript
// src/middleware.ts
export default clerkMiddleware((auth, req) => {
  if (isProtectedRoute(req)) {
    auth().protect()

    const { has, orgId } = auth()
    
    // 組織メンバーシップチェック
    if (!has({ role: 'org:member' })) {
      return NextResponse.redirect(new URL('/organization/join', req.url))
    }

    // 組織の有料プラン確認（必要に応じて）
    // ※ 重い処理はEdge Functionで実行
  }
})
```

## 実装フェーズ

### Phase 1: 基盤構築（現在のプロジェクト）
- ✅ Organization Metadataを使用した権限管理
- ✅ 基本的な有料/無料機能の分離
- ✅ 将来のaccounts連携準備

**実装対象：**
1. Organization作成・管理機能
2. 従業員招待システム
3. 有料機能の権限チェック
4. 無料ユーザー向けアップグレード案内

### Phase 2: 統合管理システム（accounts.domain.com）
- 🔄 Clerk Billing + Stripe統合
- 🔄 マルチツール対応SSO
- 🔄 統合ダッシュボード

### Phase 3: マルチツール展開
- 🔄 新ツールの追加
- 🔄 統合アナリティクス
- 🔄 エンタープライズ機能

## 決済システム

### 技術スタック
- **Clerk Billing**: UI/UX、認証統合、プラン管理
- **Stripe**: 実際の決済処理、PCI compliance、資金管理
- **Organization Metadata**: プラン状態の保存・管理

### フロー
1. 🏢 組織管理者がaccounts.domain.comで決済
2. ✅ 決済完了時にOrganization Metadataを更新
3. 🔄 全個別ツールで有料機能が利用可能に

## 対象機能（有料化候補）

### 現在のcare_manual_ai
- 🤖 **AIによるメモ生成** - 基本的な有料機能
- 📊 **高度な分析機能** - エンタープライズ向け
- 📤 **大容量ファイルアップロード** - 制限緩和
- 🔗 **API アクセス** - 外部システム連携
- 📧 **プレミアムサポート** - 優先サポート

### 将来のツール
- 📋 **勤怠管理システム**
- 💰 **請求書作成ツール**
- 📈 **経営分析ダッシュボード**
- 🏥 **入居者管理システム**

## メリット

### 開発効率
- 🔧 各ツール独立開発・デプロイ
- 🔄 共通認証・決済基盤
- 📦 マイクロサービス構成

### ビジネス効率
- 💼 B2B営業効率化
- 📊 組織単位での契約管理
- 💰 予測しやすい収益モデル
- 🔒 エンタープライズ対応

### ユーザー体験
- 🎫 シングルサインオン
- 👥 組織レベルでの権限管理
- 📱 統一されたユーザー体験
- 🛠️ 必要なツールを自由に組み合わせ

## 注意事項

### 技術制約
- Organization Metadata上限: 8KB
- Clerk料金: $25/月 + $0.02/MAU
- Stripe手数料: 3.6%

### 設計方針
- 🚫 既存UI/UXの大幅変更は事前承認必要
- 🚫 技術スタック変更は事前承認必要
- ✅ 段階的実装を重視
- ✅ 既存機能への影響最小化

## 次のステップ

1. **Organization機能の基盤実装**
2. **有料機能の選定と実装**
3. **テスト環境での検証**
4. **段階的リリース**

---

## 更新履歴
- 2024-01-XX: 初回作成
- 対象プロジェクト: care_manual_ai
- 技術スタック: Next.js, Clerk, Supabase 