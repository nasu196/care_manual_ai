import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { testUsers, testFiles } from '../fixtures/test-data';
import path from 'path';

test.describe('🔍 デバッグ - 正確なファイルアップロードテスト', () => {
  test('SourceManager仕様に基づくファイルアップロード', async ({ page }) => {
    const loginPage = new LoginPage(page);
    
    console.log('=== ステップ1: ログイン ===');
    await loginPage.login(testUsers.userA.email, testUsers.userA.password);
    console.log('✅ ログイン成功');
    
    console.log('=== ステップ2: SourceManager画面の確認 ===');
    await page.waitForTimeout(3000);
    
    // 「参照元の管理」セクションが存在することを確認
    const sourceManagerSection = page.getByText('参照元の管理');
    await expect(sourceManagerSection).toBeVisible({ timeout: 10000 });
    console.log('✅ 参照元の管理セクションが見つかりました');
    
    console.log('=== ステップ3: ファイル追加ボタンを探す ===');
    // PlusIconのあるボタンを探す（size="icon" variant="outline"）
    const fileAddButton = page.locator('button').filter({ 
      has: page.locator('svg') // PlusIconのSVGがあるボタン
    }).filter({
      hasText: 'ファイル追加' // sr-onlyテキストが含まれる
    }).or(
      // より具体的にPlusIconを探す
      page.locator('button:has(span:text("ファイル追加"))')
    ).or(
      // さらにフォールバック
      page.locator('button[aria-label*="追加"], button[title*="追加"]')
    );
    
    await expect(fileAddButton).toBeVisible({ timeout: 10000 });
    console.log('✅ ファイル追加ボタンが見つかりました');
    
    console.log('=== ステップ4: 隠しファイル入力要素の確認 ===');
    // 隠された file input 要素を確認
    const hiddenFileInput = page.locator('input[type="file"][class*="hidden"]');
    await expect(hiddenFileInput).toBeAttached(); // DOM上に存在することを確認
    console.log('✅ 隠しファイル入力要素が確認されました');
    
    console.log('=== ステップ5: テストファイルのアップロード ===');
    const testFilePath = path.resolve(testFiles.pdf.path);
    console.log(`テストファイルパス: ${testFilePath}`);
    
    // 隠されたfile input要素に直接ファイルを設定
    await hiddenFileInput.setInputFiles(testFilePath);
    console.log('✅ ファイル設定成功');
    
    console.log('=== ステップ6: アップロードキューの監視 ===');
    // アップロード進行状況の表示を監視
    const uploadQueueSection = page.getByText('アップロード中のファイル:');
    
    try {
      // アップロードキューが表示されることを確認
      await expect(uploadQueueSection).toBeVisible({ timeout: 10000 });
      console.log('✅ アップロードキューが表示されました');
      
      // ファイル名がキューに表示されることを確認
      const uploadingFileItem = page.getByText(testFiles.pdf.name);
      await expect(uploadingFileItem).toBeVisible({ timeout: 5000 });
      console.log('✅ アップロード中のファイル名が表示されました');
      
    } catch (error) {
      console.log('⚠️ アップロードキューが確認できませんでした（処理が高速の可能性）');
    }
    
    console.log('=== ステップ7: アップロード完了の確認 ===');
    // ファイルがファイルリストに表示されることを確認（最大60秒待機）
    const uploadedFileInList = page.getByText(testFiles.pdf.name).last(); // リスト内のファイル名
    
    await expect(uploadedFileInList).toBeVisible({ timeout: 60000 });
    console.log('✅ ファイルがファイルリストに表示されました');
    
    // アップロードキューからファイルが消えることを確認（3秒後に自動削除）
    await page.waitForTimeout(5000);
    try {
      await expect(uploadQueueSection).not.toBeVisible({ timeout: 5000 });
      console.log('✅ アップロードキューから自動削除されました');
    } catch (error) {
      console.log('⚠️ アップロードキューがまだ表示されています（処理継続中の可能性）');
    }
    
    console.log('=== ステップ8: アップロードしたファイルの削除 ===');
    
    // より具体的にファイルアイテムを特定
    const fileListItem = page.locator('div').filter({
      has: page.getByText(testFiles.pdf.name)
    }).filter({
      has: page.locator('button[aria-label="アクション"], button:has-text("アクション")')
    }).or(
      // フォールバック: MoreVertical (3点ドット) アイコンを含むボタン
      page.locator('div').filter({
        has: page.getByText(testFiles.pdf.name)
      }).filter({
        has: page.locator('button:has(svg)')
      })
    );
    
    // より広範囲でドロップダウントリガーを探す
    const moreActionsButton = fileListItem.locator('button:has(svg)').first();
    
    await expect(moreActionsButton).toBeVisible({ timeout: 10000 });
    await moreActionsButton.click();
    console.log('✅ ファイルアクションメニューを開きました');
    
    // より柔軟に削除メニューを探す
    const deleteMenuItem = page.getByRole('menuitem', { name: '削除' }).or(
      page.getByText('削除').filter({ has: page.locator('[role="menuitem"]') }).or(
        page.locator('[role="menuitem"]').filter({ hasText: '削除' }).or(
          page.locator('div[role="menuitem"]:has-text("削除")')
        )
      )
    );
    
    await expect(deleteMenuItem).toBeVisible({ timeout: 5000 });
    await deleteMenuItem.click();
    console.log('✅ 削除メニューをクリックしました');
    
    // 確認ダイアログの処理（window.confirm）
    page.on('dialog', async dialog => {
      console.log(`確認ダイアログ: ${dialog.message()}`);
      await dialog.accept();
    });
    
    await page.waitForTimeout(2000);
    
    // 削除成功メッセージの確認
    const deleteSuccessMessage = page.getByText(/ファイル.*を完全に削除しました/);
    await expect(deleteSuccessMessage).toBeVisible({ timeout: 10000 });
    console.log('✅ 削除成功メッセージが表示されました');
    
    // ファイルがリストから消えることを確認
    await expect(uploadedFileInList).not.toBeVisible({ timeout: 10000 });
    console.log('✅ ファイルがリストから削除されました');
    
    console.log('=== テスト完了 ===');
    console.log('🎉 ファイルアップロード→削除の完全なフローが成功しました');
  });
}); 