import { Page, Locator, expect } from '@playwright/test';

export class LoginPage {
  readonly page: Page;
  readonly googleSignInButton: Locator;
  readonly emailInput: Locator;
  readonly continueButton: Locator;
  readonly passwordInput: Locator;
  readonly signInButton: Locator;
  readonly signUpLink: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    
    // 実際のClerkサインイン画面の要素
    this.googleSignInButton = page.getByRole('button', { name: 'Googleで続ける' });
    
    this.emailInput = page.getByPlaceholder('メールアドレス');
    
    this.continueButton = page.getByRole('button', { name: '続ける', exact: true }).and(
      page.locator('[data-localization-key="formButtonPrimary"]')
    );
    
    // パスワード入力（メール入力後に表示される）
    this.passwordInput = page.locator('input[type="password"]').or(
      page.getByPlaceholder('パスワード')
    );
    
    // サインインボタン（パスワード入力後の続けるボタン）
    this.signInButton = page.getByRole('button', { name: '続ける', exact: true }).and(
      page.locator('[data-localization-key="formButtonPrimary"]')
    );
    
    // サインアップリンク
    this.signUpLink = page.getByText('サインアップ');
    
    this.errorMessage = page.locator('[data-testid="error-message"]');
  }

  async goto() {
    await this.page.goto('/');
  }

  async login(email: string, password: string) {
    await this.goto();
    
    // 少し待機してページが完全にロード
    await this.page.waitForTimeout(2000);
    
    // メールアドレスを入力
    await this.emailInput.fill(email);
    
    // 続けるボタンをクリック（メール入力後）
    await this.continueButton.click();
    
    // パスワード入力画面への遷移を待機
    await this.page.waitForTimeout(1000);
    
    // パスワードを入力
    await this.passwordInput.fill(password);
    
    // サインインボタン（続ける）をクリック
    await this.signInButton.click();
    
    // ログイン完了を待機
    await this.page.waitForTimeout(3000);
    
    // サインイン画面を離脱したかをチェック
    const currentURL = this.page.url();
    if (currentURL.includes('sign-in') || currentURL.includes('sign-up')) {
      throw new Error(`ログインに失敗しました。現在のURL: ${currentURL}`);
    }
  }

  async logout() {
    // ユーザーメニューを開く
    await this.page.getByRole('button', { name: 'ユーザーメニュー' }).click();
    
    // ログアウトボタンをクリック
    await this.page.getByRole('menuitem', { name: 'ログアウト' }).click();
    
    // ログアウト成功を待機
    await expect(this.page).toHaveURL('/');
  }
} 