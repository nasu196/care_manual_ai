import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Settings, Share2, UserCircle, Edit3, Eye } from 'lucide-react'; // Edit3とEyeを追加
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FeedbackModal } from '@/components/features/FeedbackModal';
import { useMemoStore } from '@/store/memoStore'; // memoStoreを追加

interface TopHeaderProps {
  title: string;
  onTitleChange: (newTitle: string) => void;
}

const TopHeader: React.FC<TopHeaderProps> = ({ title, onTitleChange }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editableTitle, setEditableTitle] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);

  // ★ 編集権限を取得
  const hasEditPermission = useMemoStore((state) => state.hasEditPermission);
  const setEditPermission = useMemoStore((state) => state.setEditPermission);

  useEffect(() => {
    setEditableTitle(title);
  }, [title]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleTitleClick = () => {
    setIsEditing(true);
  };

  const handleTitleBlur = () => {
    setIsEditing(false);
    if (editableTitle.trim() === '') {
      setEditableTitle(title);
    } else {
      onTitleChange(editableTitle.trim());
    }
  };

  const handleTitleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      setIsEditing(false);
      if (editableTitle.trim() === '') {
        onTitleChange(title);
      } else {
        onTitleChange(editableTitle.trim());
      }
    } else if (event.key === 'Escape') {
      setIsEditing(false);
      setEditableTitle(title);
    }
  };

  const openFeedbackModal = () => {
    setIsFeedbackModalOpen(true);
  };

  const handleTerms = () => {
    console.log("利用規約がクリックされました");
    // TODO: 利用規約ページへの遷移など
  };

  return (
    <>
      <div className="flex items-center justify-between px-4 py-2 border-b h-16 bg-background">
        {/* 左側: アイコンとタイトル */}
        <div className="flex items-center flex-grow">
          {/* アイコン用プレースホルダー */}
          <div className="h-8 w-8 bg-slate-300 rounded mr-3 flex-shrink-0"></div>
          
          <div className="text-lg font-semibold text-foreground flex-grow mr-4" onClick={handleTitleClick} style={{ cursor: 'pointer' }}>
            {isEditing ? (
              <input
                ref={inputRef}
                type="text"
                value={editableTitle}
                onChange={(e) => setEditableTitle(e.target.value)}
                onBlur={handleTitleBlur}
                onKeyDown={handleTitleKeyDown}
                className="text-lg font-semibold bg-transparent border-b border-primary focus:outline-none w-full"
              />
            ) : (
              <span title="クリックして編集">{title}</span>
            )}
          </div>
        </div>

        {/* 右側: 操作ボタンとユーザーアイコン */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          {/* 編集権限切り替えボタン */}
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setEditPermission(!hasEditPermission)}
            className="flex items-center space-x-1.5"
            title={hasEditPermission ? '閲覧専用モードに切り替え' : '編集モードに切り替え'}
          >
            {hasEditPermission ? <Eye className="h-4 w-4" /> : <Edit3 className="h-4 w-4" />}
            <span className="hidden sm:inline">
              {hasEditPermission ? '閲覧専用' : '編集モード'}
            </span>
          </Button>

          <Button variant="ghost" size="sm" className="flex items-center space-x-1.5">
            <Share2 className="h-4 w-4" />
            <span className="hidden sm:inline">共有</span>
          </Button>

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

          {/* TODO: ClerkのUserButtonに置き換える */}
          <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
            <UserCircle className="h-5 w-5" />
          </div>
        </div>
      </div>
      <FeedbackModal 
        isOpen={isFeedbackModalOpen} 
        onOpenChange={setIsFeedbackModalOpen}
      />
    </>
  );
};

export default TopHeader; 