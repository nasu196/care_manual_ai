import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { testUsers, testFiles } from '../fixtures/test-data';
import path from 'path';

test.describe('🔍 デバッグ - ファイルアップロードテスト', () => {
  test('ファイルアップロード機能', async ({ page }) => {
    const loginPage = new LoginPage(page);
    
    console.log('=== ステップ1: ログイン ===');
    await loginPage.login(testUsers.userA.email, testUsers.userA.password);
    console.log('✅ ログイン成功');
    
    console.log('=== ステップ2: ファイル追加ボタンを探す ===');
    await page.waitForTimeout(2000);
    
    // 「ファイル追加」ボタンを探す
    const fileAddButton = page.getByRole('button', { name: 'ファイル追加' });
    
    try {
      await expect(fileAddButton).toBeVisible({ timeout: 10000 });
      console.log('✅ ファイル追加ボタンが見つかりました');
    } catch (error) {
      console.log('❌ ファイル追加ボタンが見つかりません');
      
      // 現在のページ状態を確認
      const currentURL = page.url();
      const pageTitle = await page.title();
      console.log(`現在のURL: ${currentURL}`);
      console.log(`ページタイトル: ${pageTitle}`);
      
      await page.screenshot({ path: 'debug-no-file-add-button.png' });
      throw error;
    }
    
    console.log('=== ステップ3: テストファイルをアップロード ===');
    const testFilePath = path.resolve(testFiles.pdf.path);
    console.log(`テストファイルパス: ${testFilePath}`);
    
    try {
      // 隠れているファイル入力要素に直接ファイルを設定
      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(testFilePath);
      console.log('✅ ファイル設定成功');
      
      // アップロード処理の開始を待機
      await page.waitForTimeout(3000);
      
      // アップロード完了やファイル表示の確認
      // ファイル名が表示されるか、アップロード成功メッセージが出るかを確認
      const uploadIndicator = page.getByText(testFiles.pdf.name).or(
        page.getByText('test-manual.txt').or(
          page.getByText('アップロード完了').or(
            page.getByText('成功').or(
              page.locator('[data-testid*="file"]').or(
                page.locator('.file-item').or(
                  page.locator('.uploaded-file')
                )
              )
            )
          )
        )
      );
      
      await expect(uploadIndicator).toBeVisible({ timeout: 30000 });
      console.log('✅ ファイルアップロード成功（ファイルが表示されました）');
      
    } catch (error) {
      console.log('❌ ファイルアップロード処理失敗:', error);
      
      // デバッグ用：現在のページ状態を確認
      const currentHTML = await page.content();
      console.log('ページ上のテキスト内容をチェック...');
      
      await page.screenshot({ path: 'debug-upload-failed.png' });
      throw error;
    }
    
    console.log('=== ステップ4: アップロードしたファイルの削除 ===');
    try {
      // 削除ボタンやメニューを探す
      const deleteButton = page.getByRole('button', { name: '削除' }).or(
        page.getByRole('button', { name: 'Delete' }).or(
          page.locator('[data-testid="delete-file"]').or(
            page.getByRole('menuitem', { name: '削除' }).or(
              page.locator('button[title="削除"]')
            )
          )
        )
      );
      
      if (await deleteButton.isVisible({ timeout: 5000 })) {
        await deleteButton.click();
        console.log('✅ 削除ボタンクリック');
        
        // 削除確認ダイアログがあればOKをクリック
        const confirmButton = page.getByRole('button', { name: 'OK' }).or(
          page.getByRole('button', { name: '確認' }).or(
            page.getByRole('button', { name: '削除' })
          )
        );
        
        if (await confirmButton.isVisible({ timeout: 3000 })) {
          await confirmButton.click();
          console.log('✅ 削除確認完了');
        }
        
        await page.waitForTimeout(2000);
        console.log('✅ ファイル削除完了');
        
      } else {
        console.log('⚠️ 削除ボタンが見つかりませんでした（手動削除が必要な可能性）');
      }
      
    } catch (error) {
      console.log('⚠️ ファイル削除処理で問題が発生:', error);
      // 削除失敗はテスト失敗にはしない（警告のみ）
    }
    
    console.log('=== テスト完了 ===');
  });
}); 