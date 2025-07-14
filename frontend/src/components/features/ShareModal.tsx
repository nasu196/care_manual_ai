'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Copy, Check, QrCode, Loader2, Trash2, Calendar } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '@clerk/nextjs';

interface ShareConfig {
  id: string;
  selected_record_ids: string[];
  created_at: string;
  expires_at: string | null;
  is_active: boolean;
  file_names?: string[]; // ファイル名情報を追加
}

interface FileData {
  id: string;
  original_file_name: string;
  [key: string]: unknown;
}

interface ShareModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  selectedRecordIds: string[]; // ★ 追加: recordIdベースの選択状態
}

export const ShareModal: React.FC<ShareModalProps> = ({ isOpen, onOpenChange, selectedRecordIds }) => {
  const [shareUrl, setShareUrl] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingShares, setExistingShares] = useState<ShareConfig[]>([]);
  const [isLoadingShares, setIsLoadingShares] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  
  const { getToken, userId } = useAuth();



  // 既存の共有URL一覧を取得
  const loadExistingShares = useCallback(async () => {
    if (!userId) return;
    
    setIsLoadingShares(true);
    try {
      const token = await getToken({ template: 'supabase' });
      if (!token) {
        throw new Error('認証トークンの取得に失敗しました。');
      }

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!supabaseUrl) {
        throw new Error('Supabase URLが設定されていません。');
      }

      const response = await fetch(`${supabaseUrl}/functions/v1/list-share-configs`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'サーバーエラーが発生しました。' }));
        throw new Error(errorData.error || '共有URL一覧の取得に失敗しました。');
      }

      const responseData = await response.json();
      const shareConfigs = responseData.shareConfigs || responseData || [];
      
      // 各共有設定のファイル名を取得
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      const shareConfigsWithFileNames = await Promise.all(
        shareConfigs.map(async (share: ShareConfig) => {
          if (share.selected_record_ids && share.selected_record_ids.length > 0 && supabaseAnonKey) {
            try {
              // manualsテーブルからファイル名を取得（正しいSupabase REST API記法）
              const apiUrl = `${supabaseUrl}/rest/v1/manuals?select=original_file_name&id=in.(${share.selected_record_ids.join(',')})`;
              
              const fileResponse = await fetch(apiUrl, {
                method: 'GET',
                headers: {
                  'apikey': supabaseAnonKey,
                  'Authorization': `Bearer ${token}`,
                },
              });
              
              if (fileResponse.ok) {
                const fileData = await fileResponse.json();
                
                const fileNames = fileData.map((file: FileData) => file.original_file_name).filter(Boolean);
                
                // 取得できなかったファイルがある場合は「削除されたファイル」を追加
                const missingFileCount = share.selected_record_ids.length - fileNames.length;
                if (missingFileCount > 0) {
                  for (let i = 0; i < missingFileCount; i++) {
                    fileNames.push('ファイルが見つかりません');
                  }
                }
                
                return { ...share, file_names: fileNames };
              }
            } catch (error) {
              // ファイル名取得エラーは内部的に処理
            }
          }
          
          // ファイル名取得に失敗した場合の処理
          if (share.selected_record_ids && share.selected_record_ids.length > 0) {
            // record IDの数だけ「ファイル名を取得できません」を生成
            const fallbackFileNames = share.selected_record_ids.map((_, index) => 
              `ファイル名を取得できません (${index + 1})`
            );
            return { ...share, file_names: fallbackFileNames };
          } else {
            // selected_record_idsが空の場合
            return { ...share, file_names: ['共有ファイルが設定されていません'] };
          }
        })
      );
      
      setExistingShares(shareConfigsWithFileNames);
    } catch (err) {
      console.error('Error loading existing shares:', err);
      // 既存URL読み込みエラーは表示しない（新規作成は可能なため）
    } finally {
      setIsLoadingShares(false);
    }
  }, [getToken, userId]);

  // 共有URLを削除
  const deleteShare = useCallback(async (shareId: string) => {
    setDeletingId(shareId);
    try {
      const token = await getToken({ template: 'supabase' });
      if (!token) {
        throw new Error('認証トークンの取得に失敗しました。');
      }

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!supabaseUrl) {
        throw new Error('Supabase URLが設定されていません。');
      }

      const response = await fetch(`${supabaseUrl}/functions/v1/delete-share-config/${shareId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'サーバーエラーが発生しました。' }));
        throw new Error(errorData.error || '共有URLの削除に失敗しました。');
      }

      // リストを再取得
      await loadExistingShares();
      
      // 削除したURLが現在表示中の場合はクリア
      if (shareUrl.includes(shareId)) {
        setShareUrl('');
        setShowQR(false);
      }
    } catch (err) {
      console.error('Error deleting share:', err);
      setError(err instanceof Error ? err.message : '共有URLの削除に失敗しました。');
    } finally {
      setDeletingId(null);
    }
  }, [getToken, shareUrl, loadExistingShares]);

  const generateShareUrl = useCallback(async () => {
    setIsGenerating(true);
    setError(null);
    
    try {
      // マニュアルが選択されているかチェック（recordIdベース）
      if (!selectedRecordIds || selectedRecordIds.length === 0) {
        throw new Error('共有するマニュアルが選択されていません。\n「参照元の管理」からマニュアルにチェックを入れて、AIチャットで利用するマニュアルを選択してから共有してください。');
      }

      const token = await getToken({ template: 'supabase' });
      if (!token) {
        throw new Error('認証トークンの取得に失敗しました。');
      }

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      
      if (!supabaseUrl) {
        throw new Error('Supabase URLが設定されていません。');
      }

      // 共有設定を保存するEdge Functionを呼び出し
      const createResponse = await fetch(`${supabaseUrl}/functions/v1/create-share-config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          selectedRecordIds,
        }),
      });

      if (!createResponse.ok) {
        const errorData = await createResponse.json().catch(() => ({ error: 'サーバーエラーが発生しました。' }));
        throw new Error(errorData.error || '共有設定の作成に失敗しました。');
      }

      const { shareId } = await createResponse.json();
      
      // 共有URLを生成
      const currentUrl = new URL(window.location.origin);
      currentUrl.pathname = '/';
      currentUrl.searchParams.set('shareId', shareId);
      
      setShareUrl(currentUrl.toString());
      setIsCopied(false);
      setShowQR(false);

      // 既存のリストを更新
      await loadExistingShares();

    } catch (err) {
      console.error('Error generating share URL:', err);
      setError(err instanceof Error ? err.message : '共有URLの生成に失敗しました。');
    } finally {
      setIsGenerating(false);
    }
  }, [getToken, loadExistingShares, selectedRecordIds]);

  useEffect(() => {
    if (isOpen && userId) {
      loadExistingShares();
    }
  }, [isOpen, userId, loadExistingShares]);

  const handleCopy = async (url?: string) => {
    const urlToCopy = url || shareUrl;
    try {
      await navigator.clipboard.writeText(urlToCopy);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error('クリップボードへのコピーに失敗しました:', error);
      alert('クリップボードへのコピーに失敗しました。');
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('ja-JP');
  };

  const generateShareUrlFromId = (shareId: string) => {
    const currentUrl = new URL(window.location.origin);
    currentUrl.pathname = '/';
    currentUrl.searchParams.set('shareId', shareId);
    return currentUrl.toString();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5" />
            閲覧専用で共有
          </DialogTitle>
          <DialogDescription>
            選択したソースとメモを閲覧専用で共有します。
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* 新しい共有URL作成 */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">新しい共有URLを作成</h3>
            <p className="text-sm text-muted-foreground">
              <span className="font-bold text-black underline">現在選択されているソースとメモ</span>が共有されます。
            </p>

            {error && (
              <div className="text-red-500 bg-red-100 border border-red-400 rounded p-3 text-sm">
                エラー: {error}
              </div>
            )}

            {shareUrl ? (
              <>
                {/* URL表示とコピー */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">共有URL</label>
                  <div className="flex gap-2">
                    <Input
                      value={shareUrl}
                      readOnly
                      className="flex-1 text-xs h-9"
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                    />
                    <Button
                      size="sm"
                      onClick={() => handleCopy()}
                      className={`px-3 h-9 ${isCopied ? 'bg-green-600 hover:bg-green-700' : ''}`}
                    >
                      {isCopied ? (
                        <>
                          <Check className="h-4 w-4 mr-1" />
                          コピー済
                        </>
                      ) : (
                        <>
                          <Copy className="h-4 w-4 mr-1" />
                          コピー
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                {/* QRコード表示切り替え */}
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowQR(!showQR)}
                    className="flex items-center gap-2"
                  >
                    <QrCode className="h-4 w-4" />
                    {showQR ? 'QRコードを隠す' : 'QRコードを表示'}
                  </Button>
                </div>

                {/* QRコード */}
                {showQR && (
                  <div className="flex justify-center p-4 bg-white rounded-lg border">
                    <QRCodeSVG
                      value={shareUrl}
                      size={200}
                      level="M"
                      includeMargin={true}
                    />
                  </div>
                )}
              </>
            ) : (
              <div className="flex justify-center">
                <Button onClick={generateShareUrl} disabled={isGenerating}>
                  {isGenerating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      共有URLを生成中...
                    </>
                  ) : (
                    '共有URLを作成'
                  )}
                </Button>
              </div>
            )}
          </div>

          {/* 既存の共有URL一覧 */}
          <div className="space-y-3 border-t pt-4">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              既存の共有URL
            </h3>
            
            {isLoadingShares ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                <span className="text-sm text-muted-foreground">読み込み中...</span>
              </div>
            ) : existingShares.length > 0 ? (
              <div className="space-y-2 max-h-48 overflow-y-auto border rounded-lg p-3">
                {existingShares.map((share) => (
                  <div key={share.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-muted-foreground mb-1">
                        作成日時: {formatDate(share.created_at)}
                      </div>
                      <div className="text-xs text-muted-foreground mb-2">
                        対象ソース: {share.file_names && share.file_names.length > 0 
                          ? (
                            <div className="max-w-xs">
                              {share.file_names.map((fileName, index) => (
                                <div key={index} className="truncate" title={fileName}>
                                  • {fileName}
                                </div>
                              ))}
                            </div>
                          )
                          : share.selected_record_ids.length > 0 
                            ? (
                              <div className="text-gray-500 italic">
                                ファイル名を取得中... ({share.selected_record_ids.length}個のファイル)
                              </div>
                            ) 
                            : (
                              <div className="text-gray-500 italic">
                                ファイル情報がありません
                              </div>
                            )}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleCopy(generateShareUrlFromId(share.id))}
                          className="text-xs h-7"
                        >
                          <Copy className="h-3 w-3 mr-1" />
                          コピー
                        </Button>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => deleteShare(share.id)}
                      disabled={deletingId === share.id}
                      className="ml-2 h-7 w-7 p-0"
                    >
                      {deletingId === share.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground text-center py-4 border rounded-lg">
                まだ共有URLが作成されていません
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              閉じる
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}; 