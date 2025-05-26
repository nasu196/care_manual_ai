'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, AlertCircle, FileText, Clock, Calendar } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import ChatInterfaceMain from '@/components/ChatInterfaceMain';

interface ShareConfig {
  id: string;
  selectedSourceNames: string[];
  createdAt: string;
  expiresAt: string;
}

interface Memo {
  id: string;
  title: string;
  content: string;
  is_important: boolean;
  created_at: string;
  updated_at: string;
}

interface Manual {
  id: string;
  file_name: string;
  original_file_name: string;
}

interface ShareData {
  shareConfig: ShareConfig;
  memos: Memo[];
  manuals: Manual[];
}

export default function SharedPage() {
  const searchParams = useSearchParams();
  const shareId = searchParams.get('id');
  
  const [shareData, setShareData] = useState<ShareData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!shareId) {
      setError('共有IDが指定されていません。');
      setIsLoading(false);
      return;
    }

    fetchShareData(shareId);
  }, [shareId]);

  const fetchShareData = async (id: string) => {
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!supabaseUrl) {
        throw new Error('Supabase URLが設定されていません。');
      }

      const response = await fetch(`${supabaseUrl}/functions/v1/get-share-config?id=${id}`);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'サーバーエラーが発生しました。' }));
        throw new Error(errorData.error || '共有データの取得に失敗しました。');
      }

      const data = await response.json();
      setShareData(data);

    } catch (err) {
      console.error('Error fetching share data:', err);
      setError(err instanceof Error ? err.message : '共有データの取得に失敗しました。');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-blue-600" />
          <p className="text-gray-600">共有データを読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full">
          <Alert className="border-red-200 bg-red-50">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-800">
              {error}
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  if (!shareData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-600">共有データが見つかりません。</p>
      </div>
    );
  }

  const { shareConfig, memos } = shareData;
  const expiresAt = new Date(shareConfig.expiresAt);
  const isExpiringSoon = expiresAt.getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000; // 7日以内

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <div className="bg-white border-b shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-gray-900">Care Manual AI - 共有ページ</h1>
              <p className="text-sm text-gray-600 mt-1">閲覧専用モード</p>
            </div>
            <div className="text-right">
              <div className="flex items-center text-sm text-gray-500 mb-1">
                <Calendar className="h-4 w-4 mr-1" />
                有効期限: {expiresAt.toLocaleDateString('ja-JP')}
              </div>
              {isExpiringSoon && (
                <div className="text-xs text-amber-600 font-medium">
                  <Clock className="h-3 w-3 inline mr-1" />
                  まもなく期限切れ
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 選択されたソース情報 */}
      {shareConfig.selectedSourceNames.length > 0 && (
        <div className="bg-blue-50 border-b">
          <div className="max-w-7xl mx-auto px-4 py-3">
            <div className="flex items-center">
              <FileText className="h-4 w-4 text-blue-600 mr-2" />
              <span className="text-sm font-medium text-blue-800">
                参照ソース ({shareConfig.selectedSourceNames.length}件):
              </span>
              <span className="text-sm text-blue-700 ml-2">
                {shareConfig.selectedSourceNames.join(', ')}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* メインコンテンツ */}
      <div className="max-w-7xl mx-auto p-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-[calc(100vh-200px)]">
          {/* AIチャット */}
                     <div className="bg-white rounded-lg shadow h-full overflow-hidden">
             <div className="h-full">
               <ChatInterfaceMain 
                 selectedSourceNames={shareConfig.selectedSourceNames} 
                 shareId={shareConfig.id}
               />
             </div>
           </div>

          {/* メモ一覧 */}
          <div className="bg-white rounded-lg shadow h-full overflow-hidden">
            <div className="h-full">
              <SharedMemoViewer memos={memos} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// 共有ページ専用のメモビューアーコンポーネント
interface SharedMemoViewerProps {
  memos: Memo[];
}

const SharedMemoViewer: React.FC<SharedMemoViewerProps> = ({ memos }) => {
  const [selectedMemo, setSelectedMemo] = useState<Memo | null>(null);

  const handleViewMemo = (memo: Memo) => {
    setSelectedMemo(memo);
  };

  const handleBackToList = () => {
    setSelectedMemo(null);
  };

  if (selectedMemo) {
    return (
      <div className="flex flex-col h-full">
        <div className="p-4 border-b bg-gray-50">
          <button
            onClick={handleBackToList}
            className="text-blue-600 hover:text-blue-800 text-sm font-medium"
          >
            ← メモ一覧に戻る
          </button>
        </div>
        <div className="flex-1 p-4 overflow-y-auto">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              {selectedMemo.title}
            </h2>
            <div className="flex items-center text-sm text-gray-500 space-x-4">
              <span>作成: {new Date(selectedMemo.created_at).toLocaleDateString('ja-JP')}</span>
              <span>更新: {new Date(selectedMemo.updated_at).toLocaleDateString('ja-JP')}</span>
              {selectedMemo.is_important && (
                <span className="bg-red-100 text-red-800 px-2 py-1 rounded-full text-xs font-medium">
                  重要
                </span>
              )}
            </div>
          </div>
          <div 
            className="prose max-w-none"
            dangerouslySetInnerHTML={{ __html: selectedMemo.content }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b bg-gray-50">
        <h2 className="text-lg font-semibold text-gray-900">作成済みメモ</h2>
        <p className="text-sm text-gray-600">管理者が作成したメモを閲覧できます</p>
      </div>
      
      <div className="flex-1 overflow-y-auto">
        {memos.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <FileText className="h-12 w-12 mx-auto mb-2 text-gray-400" />
            <p>メモがありません</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {memos.map((memo) => (
              <div
                key={memo.id}
                className={`p-4 hover:bg-gray-50 cursor-pointer transition-colors ${
                  memo.is_important ? 'bg-red-50/50 border-l-4 border-l-red-400' : ''
                }`}
                onClick={() => handleViewMemo(memo)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-gray-900 truncate">
                      {memo.title}
                    </h3>
                    <div className="flex items-center mt-1 text-xs text-gray-500 space-x-2">
                      <span>{new Date(memo.updated_at).toLocaleDateString('ja-JP')}</span>
                      {memo.is_important && (
                        <span className="bg-red-100 text-red-800 px-1.5 py-0.5 rounded text-xs">
                          重要
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}; 