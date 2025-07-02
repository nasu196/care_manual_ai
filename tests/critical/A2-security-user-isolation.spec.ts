import { test, expect, BrowserContext } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { testUsers, testFiles } from '../fixtures/test-data';

test.describe('A2. セキュリティ基本確認 🚨最重要', () => {
  let contextA: BrowserContext;
  let contextB: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    // ユーザー分離テストのため、2つの独立したブラウザコンテキストを作成
    contextA = await browser.newContext();
    contextB = await browser.newContext();
  });

  test.afterAll(async () => {
    await contextA?.close();
    await contextB?.close();
  });

  test('メモデータ分離確認 ★★★致命的', async () => {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    
    const loginPageA = new LoginPage(pageA);
    const loginPageB = new LoginPage(pageB);

    try {
      // ユーザーAでログインしてメモ作成
      await loginPageA.login(testUsers.userA.email, testUsers.userA.password);
      await pageA.getByText('メモスタジオ').click();
      await pageA.getByRole('button', { name: '新規メモ' }).click();
      
      const uniqueMemoTitle = `極秘メモ_${Date.now()}`;
      await pageA.getByRole('textbox', { name: 'タイトル' }).fill(uniqueMemoTitle);
      await pageA.getByRole('textbox', { name: 'メモ内容' }).fill('これは機密情報です');
      await pageA.getByRole('button', { name: '保存' }).click();
      
      await expect(pageA.getByText('保存されました')).toBeVisible();
      await expect(pageA.getByText(uniqueMemoTitle)).toBeVisible();

      // ユーザーBでログイン
      await loginPageB.login(testUsers.userB.email, testUsers.userB.password);
      await pageB.getByText('メモスタジオ').click();

      // ユーザーAのメモが表示されないことを確認（★★★致命的チェック）
      await expect(pageB.getByText(uniqueMemoTitle)).not.toBeVisible();
      await expect(pageB.getByText('これは機密情報です')).not.toBeVisible();
      
    } finally {
      await pageA.close();
      await pageB.close();
    }
  });

  test('ファイルデータ分離確認 ★★★致命的', async () => {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    
    const loginPageA = new LoginPage(pageA);
    const loginPageB = new LoginPage(pageB);

    try {
      // ユーザーAでログインしてファイルアップロード
      await loginPageA.login(testUsers.userA.email, testUsers.userA.password);
      await pageA.getByText('参照元の管理').click();
      await pageA.getByRole('button', { name: 'ファイル追加' }).click();
      
      // ファイル名は動的に生成
      await pageA.setInputFiles('input[type="file"]', testFiles.pdf.path);
      await expect(pageA.getByText('完了')).toBeVisible({ timeout: 30000 });

      // ユーザーBでログイン
      await loginPageB.login(testUsers.userB.email, testUsers.userB.password);
      await pageB.getByText('参照元の管理').click();

      // ユーザーAのファイルが表示されないことを確認（★★★致命的チェック）
      await expect(pageB.getByText(testFiles.pdf.name)).not.toBeVisible();
      
    } finally {
      await pageA.close();
      await pageB.close();
    }
  });

  test('AIチャット履歴分離確認 ★★★致命的', async () => {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    
    const loginPageA = new LoginPage(pageA);
    const loginPageB = new LoginPage(pageB);

    try {
      // ユーザーAでログインしてAIチャット実行
      await loginPageA.login(testUsers.userA.email, testUsers.userA.password);
      
      const secretQuestion = `極秘質問_${Date.now()}: 機密情報について教えてください`;
      const chatInput = pageA.getByRole('textbox', { name: 'チャット入力' });
      await chatInput.fill(secretQuestion);
      await pageA.getByRole('button', { name: '送信' }).click();
      
      // AI回答を待機
      await expect(pageA.getByText('AI:', { exact: false })).toBeVisible({ timeout: 15000 });

      // ユーザーBでログイン
      await loginPageB.login(testUsers.userB.email, testUsers.userB.password);

      // ユーザーAのチャット履歴が表示されないことを確認（★★★致命的チェック）
      await expect(pageB.getByText(secretQuestion)).not.toBeVisible();
      
    } finally {
      await pageA.close();
      await pageB.close();
    }
  });

  test('URL直接操作防止確認 ★★★致命的', async () => {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    
    const loginPageA = new LoginPage(pageA);
    const loginPageB = new LoginPage(pageB);

    try {
      // ユーザーAでログインしてメモ作成
      await loginPageA.login(testUsers.userA.email, testUsers.userA.password);
      await pageA.getByText('メモスタジオ').click();
      await pageA.getByRole('button', { name: '新規メモ' }).click();
      
      const secretMemoTitle = `極秘メモURL_${Date.now()}`;
      await pageA.getByRole('textbox', { name: 'タイトル' }).fill(secretMemoTitle);
      await pageA.getByRole('textbox', { name: 'メモ内容' }).fill('URL直接アクセステスト用機密データ');
      await pageA.getByRole('button', { name: '保存' }).click();
      await expect(pageA.getByText('保存されました')).toBeVisible();
      
      // メモ詳細URLを取得
      await pageA.getByText(secretMemoTitle).click();
      const memoDetailUrl = pageA.url();

      // ユーザーBでログイン
      await loginPageB.login(testUsers.userB.email, testUsers.userB.password);
      
      // ユーザーAのメモ詳細URLに直接アクセス試行（★★★致命的チェック）
      await pageB.goto(memoDetailUrl);
      
      // アクセス拒否またはエラーページが表示されることを確認
      const isAccessDenied = await Promise.race([
        pageB.getByText('アクセスが拒否されました').isVisible().catch(() => false),
        pageB.getByText('403').isVisible().catch(() => false),
        pageB.getByText('Forbidden').isVisible().catch(() => false),
        pageB.getByText('権限がありません').isVisible().catch(() => false),
        // メモの内容が表示されないことを確認
        pageB.getByText('URL直接アクセステスト用機密データ').isVisible().then(() => false).catch(() => true)
      ]);
      
      expect(isAccessDenied).toBeTruthy();
      
    } finally {
      await pageA.close();
      await pageB.close();
    }
  });

  test('API認証確認', async () => {
    const page = await contextA.newPage();
    const loginPage = new LoginPage(page);

    try {
      // DevToolsでネットワークタブを監視開始
      const requests: Array<{
        url: string;
        headers: Record<string, string>;
        method: string;
      }> = [];
      page.on('request', (request) => {
        if (request.url().includes('/api/') || request.url().includes('/rest/')) {
          requests.push({
            url: request.url(),
            headers: request.headers(),
            method: request.method()
          });
        }
      });

      await loginPage.login(testUsers.userA.email, testUsers.userA.password);
      
      // APIリクエストを発生させる操作
      await page.getByText('参照元の管理').click();
      
      // 少し待機してリクエストを収集
      await page.waitForTimeout(2000);

      // APIリクエストに正しいAuthorizationヘッダーが含まれていることを確認
      const apiRequests = requests.filter(req => 
        req.url.includes('/api/') || 
        req.url.includes('/rest/') ||
        req.url.includes('/functions/')
      );

      expect(apiRequests.length).toBeGreaterThan(0);
      
      // 少なくとも1つのリクエストにAuthorizationヘッダーがあることを確認
      const hasAuthHeader = apiRequests.some(req => 
        req.headers['authorization'] || req.headers['Authorization']
      );
      expect(hasAuthHeader).toBeTruthy();

      // service_role_keyが漏洩していないことを確認（★★★致命的チェック）
      const hasServiceRoleKey = apiRequests.some(req => {
        const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
        return authHeader.includes('service_role') || authHeader.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
      });
      expect(hasServiceRoleKey).toBeFalsy();
      
    } finally {
      await page.close();
    }
  });
}); 