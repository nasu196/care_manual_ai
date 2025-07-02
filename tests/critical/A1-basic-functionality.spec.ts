import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { testUsers, testFiles, testQuestions } from '../fixtures/test-data';

test.describe('A1. 基本動作確認 🚨最優先', () => {
  let loginPage: LoginPage;

  test.beforeEach(({ page }) => {
    loginPage = new LoginPage(page);
  });

  test('ログイン・ログアウトが正常動作する', async ({ page }) => {
    // ログイン
    await loginPage.login(testUsers.userA.email, testUsers.userA.password);
    
    // ダッシュボードが表示されることを確認
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText('ダッシュボード')).toBeVisible();
    
    // ログアウト
    await loginPage.logout();
    
    // トップページに戻ることを確認
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('button', { name: 'ログイン' })).toBeVisible();
  });

  test('ファイルアップロードが成功する', async ({ page }) => {
    await loginPage.login(testUsers.userA.email, testUsers.userA.password);
    
    // 参照元の管理セクションに移動
    await page.getByText('参照元の管理').click();
    
    // ファイル追加ボタンをクリック
    await page.getByRole('button', { name: 'ファイル追加' }).click();
    
    // ファイルを選択（テストファイルのパスを指定）
    await page.setInputFiles('input[type="file"]', testFiles.pdf.path);
    
    // アップロード成功を確認
    await expect(page.getByText('完了')).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(testFiles.pdf.name)).toBeVisible();
  });

  test('AIチャット基本機能が動作する', async ({ page }) => {
    await loginPage.login(testUsers.userA.email, testUsers.userA.password);
    
    // チャットエリアに質問を入力
    const chatInput = page.getByRole('textbox', { name: 'チャット入力' });
    await chatInput.fill(testQuestions.simple);
    
    // 送信ボタンをクリック
    await page.getByRole('button', { name: '送信' }).click();
    
    // AI回答が表示されることを確認
    await expect(page.getByText('AI:', { exact: false })).toBeVisible({ timeout: 15000 });
  });

  test('メモ作成・編集・保存が正常動作する', async ({ page }) => {
    await loginPage.login(testUsers.userA.email, testUsers.userA.password);
    
    // メモスタジオに移動
    await page.getByText('メモスタジオ').click();
    
    // 新規メモ作成
    await page.getByRole('button', { name: '新規メモ' }).click();
    
    // タイトルを入力
    const titleInput = page.getByRole('textbox', { name: 'タイトル' });
    await titleInput.fill('テストメモ');
    
    // 内容を入力
    const contentArea = page.getByRole('textbox', { name: 'メモ内容' });
    await contentArea.fill('これはテスト用のメモです。');
    
    // 保存
    await page.getByRole('button', { name: '保存' }).click();
    
    // 保存成功を確認
    await expect(page.getByText('保存されました')).toBeVisible();
    
    // メモ一覧でメモが表示されることを確認
    await expect(page.getByText('テストメモ')).toBeVisible();
  });

  test('共有URL生成が動作する', async ({ page }) => {
    await loginPage.login(testUsers.userA.email, testUsers.userA.password);
    
    // ファイルをアップロード（前提条件）
    await page.getByText('参照元の管理').click();
    await page.getByRole('button', { name: 'ファイル追加' }).click();
    await page.setInputFiles('input[type="file"]', testFiles.pdf.path);
    await expect(page.getByText('完了')).toBeVisible({ timeout: 30000 });
    
    // ファイルを選択
    await page.getByRole('checkbox', { name: testFiles.pdf.name }).check();
    
    // 共有ボタンをクリック
    await page.getByRole('button', { name: '共有' }).click();
    
    // 共有URL生成モーダルが表示される
    await expect(page.getByText('共有URL生成')).toBeVisible();
    
    // 「URLを生成」ボタンをクリック
    await page.getByRole('button', { name: 'URLを生成' }).click();
    
    // 共有URLが生成されることを確認
    await expect(page.getByText('https://', { exact: false })).toBeVisible({ timeout: 10000 });
    
    // 生成されたURLをコピー
    const shareUrl = await page.getByRole('textbox', { name: '共有URL' }).inputValue();
    
    // 新しいタブで共有URLにアクセス
    const shareContext = await page.context().newPage();
    await shareContext.goto(shareUrl);
    
    // 共有ページが表示されることを確認
    await expect(shareContext.getByText('共有されたマニュアル')).toBeVisible();
    
    await shareContext.close();
  });
}); 