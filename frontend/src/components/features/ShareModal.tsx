'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Copy, Check, QrCode, Loader2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '@clerk/nextjs';

interface ShareModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ShareModal: React.FC<ShareModalProps> = ({ isOpen, onOpenChange }) => {
  const [shareUrl, setShareUrl] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const { getToken, userId } = useAuth();

  const generateShareUrl = useCallback(async () => {
    setIsGenerating(true);
    setError(null);
    
    try {
      const token = await getToken({ template: 'supabase' });
      if (!token) {
        throw new Error('認証トークンの取得に失敗しました。');
      }

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!supabaseUrl) {
        throw new Error('Supabase URLが設定されていません。');
      }

      // 現在のソース選択状態を取得
      const selectedSources = localStorage.getItem('careManualAi_selectedSourceNames');
      const selectedSourceNames = selectedSources ? JSON.parse(selectedSources) : [];

      // 共有設定を保存するEdge Functionを呼び出し
      const response = await fetch(`${supabaseUrl}/functions/v1/create-share-config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          selectedSourceNames,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'サーバーエラーが発生しました。' }));
        throw new Error(errorData.error || '共有設定の作成に失敗しました。');
      }

      const { shareId } = await response.json();
      
      // 共有URLを生成
      const currentUrl = new URL(window.location.origin);
      currentUrl.pathname = '/';
      currentUrl.searchParams.set('shareId', shareId);
      
      setShareUrl(currentUrl.toString());
      setIsCopied(false);
      setShowQR(false);

    } catch (err) {
      console.error('Error generating share URL:', err);
      setError(err instanceof Error ? err.message : '共有URLの生成に失敗しました。');
    } finally {
      setIsGenerating(false);
    }
  }, [getToken]);

  useEffect(() => {
    if (isOpen && userId) {
      generateShareUrl();
    }
  }, [isOpen, userId, generateShareUrl]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error('クリップボードへのコピーに失敗しました:', error);
      alert('クリップボードへのコピーに失敗しました。');
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5" />
            閲覧専用で共有
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            共有されたユーザーは閲覧専用モードでアクセスできます。ログインは不要です。
            <span className="font-bold text-black underline">現在選択されているソースとメモが共有されます。</span>
          </p>

          {error && (
            <div className="text-red-500 bg-red-100 border border-red-400 rounded p-3 text-sm">
              エラー: {error}
            </div>
          )}

          {isGenerating ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span>共有URLを生成中...</span>
            </div>
          ) : shareUrl ? (
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
                    onClick={handleCopy}
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
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            {shareUrl && (
              <Button variant="outline" onClick={generateShareUrl} disabled={isGenerating}>
                URLを再生成
              </Button>
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              閉じる
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}; 