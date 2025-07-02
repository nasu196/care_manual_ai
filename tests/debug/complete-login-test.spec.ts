import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { testUsers } from '../fixtures/test-data';

test.describe('🔍 デバッグ - 完全ログインテスト', () => {
  test('完全なログインフロー', async ({ page }) => {
    const loginPage = new LoginPage(page);
    
    console.log('=== ステップ1: ページにアクセス ===');
    await loginPage.goto();
    await page.waitForTimeout(3000);
    
    console.log('=== ステップ2: メールアドレスを入力 ===');
    await loginPage.emailInput.fill(testUsers.userA.email);
    console.log(`✅ メールアドレス入力: ${testUsers.userA.email}`);
    
    console.log('=== ステップ3: 続けるボタンクリック ===');
    await loginPage.continueButton.click();
    console.log('✅ 続けるボタンクリック成功');
    
    console.log('=== ステップ4: パスワード入力画面を待機 ===');
    await page.waitForTimeout(2000);
    await expect(loginPage.passwordInput).toBeVisible({ timeout: 10000 });
    console.log('✅ パスワード入力欄が表示されました');
    
    console.log('=== ステップ5: パスワードを入力 ===');
    await loginPage.passwordInput.fill(testUsers.userA.password);
    console.log('✅ パスワード入力成功');
    
    console.log('=== ステップ6: サインインボタンクリック ===');
    await loginPage.signInButton.click();
    console.log('✅ サインインボタンクリック成功');
    
    console.log('=== ステップ7: ログイン完了を待機 ===');
    
    // まず少し待機して、次の画面の状態を確認
    await page.waitForTimeout(3000);
    
    const currentURL = page.url();
    const pageTitle = await page.title();
    console.log(`現在のURL: ${currentURL}`);
    console.log(`ページタイトル: ${pageTitle}`);
    
    // factor-oneページから先に進むかをチェック
    if (currentURL.includes('sign-in/factor-one')) {
      console.log('🔍 追加認証ステップが必要の可能性があります');
      
      // 追加の認証要素があればクリック（Continue的なボタン）
      try {
        const nextButton = page.getByRole('button', { name: '続ける' }).or(
          page.getByRole('button', { name: 'Continue' }).or(
            page.getByRole('button', { name: 'Skip' }).or(
              page.getByRole('button', { name: 'スキップ' })
            )
          )
        );
        
        if (await nextButton.isVisible({ timeout: 3000 })) {
          await nextButton.click();
          console.log('✅ 追加認証ステップをスキップまたは続行');
          await page.waitForTimeout(2000);
        }
      } catch (e) {
        console.log('追加認証ボタンが見つからないか、不要でした');
      }
    }
    
    // 最終的なURL遷移を待機（より柔軟な条件で）
    try {
      await page.waitForURL(/\/(dashboard|app|home|\/)$/, { timeout: 10000 });
      console.log('🎉 ログイン完了！');
      
      const finalURL = page.url();
      console.log(`最終URL: ${finalURL}`);
      
    } catch (error) {
      // 最終状態を確認
      const finalURL = page.url();
      const finalTitle = await page.title();
      console.log(`最終URL: ${finalURL}`);
      console.log(`最終タイトル: ${finalTitle}`);
      
      // サインイン関連のURLでなければ成功とみなす
      if (!finalURL.includes('sign-in') && !finalURL.includes('sign-up')) {
        console.log('🎉 ログイン成功（サインイン画面を離脱）');
      } else {
        console.log('❌ まだサインイン画面にいます');
        await page.screenshot({ path: 'debug-login-still-signin.png' });
        throw error;
      }
    }
  });
}); 