'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Copy, Check, QrCode } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

interface ShareModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ShareModal: React.FC<ShareModalProps> = ({ isOpen, onOpenChange }) => {
  const [shareUrl, setShareUrl] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // モーダルが開かれたときに共有URLを生成
      const currentUrl = new URL(window.location.href);
      currentUrl.searchParams.set('mode', 'readonly');
      setShareUrl(currentUrl.toString());
      setIsCopied(false);
      setShowQR(false);
    }
  }, [isOpen]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000); // 2秒後にリセット
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
          </p>
          
          {/* URL表示とコピー */}
          <div className="space-y-2">
            <label className="text-sm font-medium">共有URL</label>
            <div className="flex gap-2">
              <Input
                value={shareUrl}
                readOnly
                className="flex-1 text-xs h-9"
                onClick={(e) => e.target.select()}
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

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              閉じる
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}; 