'use client';

import React, { useState, useEffect } from 'react';

// 介護現場での実用的な入力例
const inputExamples = [
  "外国語に翻訳して",
  "問題集作って",
  "研修資料を作って", 
  "FAQを作って",
  "要点をまとめて",
  "チェックリストを作って",
  "新人向けに簡単に説明して",
  "家族向けの説明資料を作って",
  "事故防止のポイントをまとめて",
  "手順を箇条書きにして"
];

export const ChatEmptyState: React.FC = () => {
  const [currentExample, setCurrentExample] = useState('');

  useEffect(() => {
    // コンポーネントマウント時にランダムな例示を選択
    const randomIndex = Math.floor(Math.random() * inputExamples.length);
    setCurrentExample(inputExamples[randomIndex]);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-260px)] w-full text-center p-4">
      {/* メインメッセージ - モダンなグラデーション文字 */}
      <div className="mb-6">
        <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold bg-gradient-to-r from-blue-300 via-sky-300 to-slate-400 bg-clip-text text-transparent leading-tight">
          下の入力欄から質問を送信して<br />会話を始めましょう
        </h1>
      </div>

      {/* 例示 */}
      <div className="text-lg text-gray-500">
        例：{currentExample}
      </div>
    </div>
  );
}; 