"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PlusCircledIcon, TrashIcon } from "@radix-ui/react-icons";
import { useState, useEffect } from "react";

interface Memo {
  id: string;
  title: string;
  content: string;
  created_at?: string;
  updated_at?: string;
}

const initialMemos: Memo[] = [
  { id: "1", title: "今日のアイデア", content: "新しい機能について考えたこと..." },
  { id: "2", title: "会議メモ (2024/03/15)", content: "・プロジェクトAの進捗\n・課題Bの対応" },
  { id: "3", title: "重要なリンク集", content: "https://example.com\nhttps://anotherexample.dev" },
];

const MemoPanel = () => {
  return (
    <div className="flex flex-col items-start h-full bg-gray-100 p-2">
      <h2 className="text-sm font-medium">メモパネル</h2>
      <p className="text-sm text-gray-600">ここにメモ関連情報が表示されます。</p>
    </div>
  );
};

export default MemoPanel; 