'use client'; // このページがクライアントコンポーネントであることを示す

import { useState, useEffect, Suspense, useCallback } from 'react'; // ★ useEffect をインポート
import { useSearchParams } from 'next/navigation'; // 共有ID取得用
import AppLayout from '@/components/layout/AppLayout';
import ChatInterfaceMain from '@/components/ChatInterfaceMain'; // 作成したコンポーネントをインポート
import SourceManager from '@/components/features/SourceManager'; // ★ SourceManager をインポート
import MemoStudio from '@/components/admin/MemoStudio'; // ★ MemoStudio をインポート
import { DeveloperPanel, PremiumStatus } from '@/components/features/DeveloperPanel'; // ★ DeveloperPanel をインポート
import { useMemoStore } from '@/store/memoStore'; // 編集権限管理用
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Loader2 } from 'lucide-react';

// ★ localStorage キー定義
const LOCAL_STORAGE_KEY_SELECTED_SOURCES = 'careManualAi_selectedSourceNames';

// 共有データの型定義
interface ShareData {
  shareConfig: {
    id: string;
    selectedRecordIds: string[];
    createdAt: string;
    expiresAt: string;
  };
  memos: Array<{
    id: string;
    title: string;
    content: string;
    is_important: boolean;
    created_at: string;
    updated_at: string;
  }>;
  manuals: Array<{
    id: string;
    file_name: string;
    original_file_name: string;
    is_deleted?: boolean;
  }>;
}

// useSearchParamsを使用するコンポーネントを分離
function HomePageContent() {
  const searchParams = useSearchParams();
  const shareId = searchParams.get('shareId');
  
  const [selectedSourceNames, setSelectedSourceNames] = useState<string[]>([]); // ★ 初期値は空配列
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([]);
  const [isClient, setIsClient] = useState(false); // クライアントサイドかどうかの判定用
  const [shareData, setShareData] = useState<ShareData | null>(null); // eslint-disable-line @typescript-eslint/no-unused-vars
  const [isLoadingShare, setIsLoadingShare] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [premiumStatus, setPremiumStatus] = useState<PremiumStatus>({ // ★ プレミアム状態管理を追加
    isPremium: false,
    fileLimit: 3,
    fileSizeLimit: 30
  });
  
  const setEditPermission = useMemoStore((state) => state.setEditPermission);

  // ★ クライアントサイドでlocalStorageから選択状態を復元
  useEffect(() => {
    setIsClient(true);
    
    // 共有ページでなければlocalStorageから選択状態を復元
    if (!shareId) {
      const savedSources = localStorage.getItem(LOCAL_STORAGE_KEY_SELECTED_SOURCES);
      if (savedSources) {
        try {
          const parsedSources = JSON.parse(savedSources);
          setSelectedSourceNames(parsedSources);
        } catch (error) {
          console.error('[page.tsx] localStorage解析エラー:', error);
          localStorage.removeItem(LOCAL_STORAGE_KEY_SELECTED_SOURCES); // 不正な値は削除
        }
      }
    }
  }, [shareId]);

  // ★ プレミアム状態変更ハンドラー
  const handlePremiumStatusChange = useCallback((status: PremiumStatus) => {
    setPremiumStatus(status);
  }, []);

  // 共有データを取得する関数
  const fetchShareData = useCallback(async (id: string) => {
    setIsLoadingShare(true);
    setShareError(null);
    
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!supabaseUrl) {
        throw new Error('Supabase URL is not configured');
      }

      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseAnonKey) {
        throw new Error('Supabase Anon Key is not configured');
      }

      const response = await fetch(`${supabaseUrl}/functions/v1/get-share-config?id=${id}`, {
        headers: {
          'apikey': supabaseAnonKey,
          'Authorization': `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to fetch share data' }));
        throw new Error(errorData.error || 'Failed to fetch share data');
      }

      const data: ShareData = await response.json();
      
      setShareData(data);
      
      // 共有データのソース選択状態を適用
      if (!data.manuals || data.manuals.length === 0) {
        setSelectedSourceNames([]);
        setSelectedRecordIds(data.shareConfig.selectedRecordIds || []);
        setEditPermission(false);
        return;
      }

      const fileNames = data.manuals
        .filter(manual => !manual.is_deleted) // 削除されていないファイルのみ
        .map(manual => manual.original_file_name || manual.file_name)
        .filter(fileName => fileName && fileName !== ''); // 空のファイル名を除外
      
      setSelectedSourceNames(fileNames);
      setSelectedRecordIds(data.shareConfig.selectedRecordIds);
      
      // 閲覧専用モードに設定
      setEditPermission(false);
      
    } catch (error) {
      console.error('Error fetching share data:', error);
      setShareError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setIsLoadingShare(false);
    }
  }, [setEditPermission]);

  // クライアントサイドの判定
  useEffect(() => {
    setIsClient(true);
  }, []);

  // 共有IDがある場合の処理
  useEffect(() => {
    if (!isClient) return; // クライアントサイドでのみ実行
    
    if (shareId) {
      fetchShareData(shareId);
    } else {
      // 通常モード: 編集権限を有効にし、localStorageから選択状態を読み込む
      setEditPermission(true);
      
      const storedSelection = localStorage.getItem(LOCAL_STORAGE_KEY_SELECTED_SOURCES);
      if (storedSelection) {
        try {
          const parsedSelection = JSON.parse(storedSelection);
          if (Array.isArray(parsedSelection) && parsedSelection.every(item => typeof item === 'string')) {
            setSelectedSourceNames(parsedSelection);
          }
        } catch (error) {
          console.error('Failed to parse selectedSourceNames from localStorage:', error);
          localStorage.removeItem(LOCAL_STORAGE_KEY_SELECTED_SOURCES); // 不正な値は削除
        }
      }
    }
  }, [shareId, setEditPermission, isClient, fetchShareData]);

  // ★ selectedSourceNamesが変更されたらlocalStorageに保存する（共有モードでは保存しない）
  useEffect(() => {
    if (!isClient || shareId) return; // クライアントサイドかつ非共有モードでのみ実行
    localStorage.setItem(LOCAL_STORAGE_KEY_SELECTED_SOURCES, JSON.stringify(selectedSourceNames));
  }, [selectedSourceNames, shareId, isClient]); // selectedSourceNamesが変更されるたびに実行

  // ★ SourceManager側で選択状態が変更されたときに呼び出される関数
  const handleSourceSelectionChange = (newSelectedSourceNames: string[]) => {
    setSelectedSourceNames(newSelectedSourceNames);
  };

  // ★ SourceManager側でレコードID選択状態が変更されたときに呼び出される関数
  const handleRecordSelectionChange = (newSelectedRecordIds: string[]) => {
    setSelectedRecordIds(newSelectedRecordIds);
  };

  // 共有データ読み込み中
  if (shareId && isLoadingShare) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-gray-500" />
          <p className="text-gray-600">共有データを読み込んでいます...</p>
        </div>
      </div>
    );
  }

  // 共有データ読み込みエラー
  if (shareId && shareError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full">
          <Alert className="border-red-200 bg-red-50">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-800">
              {shareError}
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  return (
    <AppLayout
      selectedRecordIds={selectedRecordIds} // ★ 追加: recordIdベースの選択状態
      sourceSlot={ // ★ sourceSlot に SourceManager を明示的に指定
        <div className="h-full flex flex-col">
          <SourceManager 
            selectedSourceNames={selectedSourceNames} 
            onSelectionChange={handleSourceSelectionChange} // ★ props名をSourceManagerの実装に合わせる
            onRecordSelectionChange={handleRecordSelectionChange} // ★ recordId選択変更ハンドラーを追加
            selectedRecordIds={selectedRecordIds} // ★ 追加: recordId選択状態を渡す
            premiumStatus={premiumStatus} // ★ プレミアム状態を渡す
          />
          {/* ★ 開発用パネルを追加（共有モードでは非表示） */}
          {!shareId && typeof window !== 'undefined' && window.location.hostname !== 'manual.t-north.jp' && (
            <div className="p-4 border-t">
              <DeveloperPanel onPremiumStatusChange={handlePremiumStatusChange}  />
            </div>
          )}
        </div>
      }
      chatSlot={
        <ChatInterfaceMain 
          selectedSourceNames={selectedSourceNames} 
        />
      } // ★ ChatInterfaceMain に選択ソースを渡す
      memoSlot={ // ★ memoSlot に MemoStudio を配置し、selectedRecordIds を渡す
        <MemoStudio selectedRecordIds={selectedRecordIds} />
      } 
    />
  );
}

// メインのコンポーネント（Suspenseでラップ）
export default function HomePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-gray-500" />
          <p className="text-gray-600">読み込み中...</p>
        </div>
      </div>
    }>
      <HomePageContent />
    </Suspense>
  );
}
