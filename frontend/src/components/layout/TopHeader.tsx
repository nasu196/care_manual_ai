"use client";

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Settings, Share2, UserCircle } from 'lucide-react';
import { UserButton, SignInButton, useAuth } from '@clerk/nextjs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FeedbackModal } from '@/components/features/FeedbackModal';
import { ShareModal } from '@/components/features/ShareModal'; // ShareModalを追加
import { useMemoStore } from '@/store/memoStore'; // memoStoreを追加

const TopHeader: React.FC = () => {
  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false); // ShareModal用のstate追加
  const { isSignedIn } = useAuth();

  // ★ 編集権限を取得
  const hasEditPermission = useMemoStore((state) => state.hasEditPermission);
  const setEditPermission = useMemoStore((state) => state.setEditPermission);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode');
    
    if (mode === 'readonly') {
      setEditPermission(false);
      console.log('[TopHeader] URLパラメータにより閲覧専用モードに設定しました');
    }
  }, [setEditPermission]); // setEditPermissionを依存配列に追加

  const openFeedbackModal = () => {
    setIsFeedbackModalOpen(true);
  };

  const handleTerms = () => {
    console.log("利用規約がクリックされました");
    // TODO: 利用規約ページへの遷移など
  };

  const handleShare = () => {
    setIsShareModalOpen(true); // モーダルを表示するように変更
  };

  return (
    <>
      <div className="flex items-center justify-between px-3 md:px-4 py-1.5 md:py-2 border-b h-12 md:h-16 bg-background">
        {/* 左側: サービスロゴ */}
        <div className="flex items-center">
          {/* モバイル版でコンパクトなロゴサイズ */}
          <div className="h-[32px] md:h-[45px] flex-shrink-0">
            <Image 
              src="/service_logo.png" 
              alt="サービスロゴ" 
              width={200}
              height={45}
              className="h-full w-auto max-w-[140px] md:max-w-[200px] object-contain"
              priority
            />
          </div>
        </div>

        {/* 右側: 操作ボタンとユーザーアイコン */}
        <div className="flex items-center space-x-2 sm:space-x-3">


          {/* 共有ボタン（編集権限がある場合のみ表示） */}
          {hasEditPermission && (
            <Button 
              variant="ghost" 
              size="sm" 
              className="flex items-center space-x-1.5"
              onClick={handleShare}
              title="閲覧専用の共有URLを生成"
            >
              <Share2 className="h-4 w-4" />
              <span className="hidden sm:inline">共有</span>
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="flex items-center space-x-1.5">
                <Settings className="h-4 w-4" />
                <span className="hidden sm:inline">設定</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={openFeedbackModal}>
                フィードバックを送信
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleTerms}>
                利用規約
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Clerk認証に置き換え */}
          {isSignedIn ? (
            <UserButton 
              appearance={{
                elements: {
                  userButtonAvatarBox: "h-8 w-8",
                }
              }}
            />
          ) : (
            <SignInButton mode="modal">
              <Button variant="ghost" size="sm" className="flex items-center space-x-1.5">
                <UserCircle className="h-5 w-5" />
                <span className="hidden sm:inline">ログイン</span>
              </Button>
            </SignInButton>
          )}
        </div>
      </div>
      <FeedbackModal 
        isOpen={isFeedbackModalOpen} 
        onOpenChange={setIsFeedbackModalOpen}
      />
      <ShareModal 
        isOpen={isShareModalOpen} 
        onOpenChange={setIsShareModalOpen}
      />
    </>
  );
};

export default TopHeader; 