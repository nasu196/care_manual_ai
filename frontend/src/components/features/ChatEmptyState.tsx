'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';

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
  const [imageLoaded, setImageLoaded] = useState(true);
  const [currentExample, setCurrentExample] = useState('');

  const handleImageError = () => {
    setImageLoaded(false);
  };

  useEffect(() => {
    // コンポーネントマウント時にランダムな例示を選択
    const randomIndex = Math.floor(Math.random() * inputExamples.length);
    setCurrentExample(inputExamples[randomIndex]);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-[500px] h-full text-center">
      {/* マスコット画像 */}
      <div className="mb-6">
        {imageLoaded ? (
          <Image 
            src="/care-mascot.png" 
            alt="ケアマニュアルAIマスコット" 
            width={192}
            height={192}
            className="object-contain opacity-80"
            onError={handleImageError}
          />
        ) : (
          <div className="w-48 h-48 bg-blue-100 rounded-full flex items-center justify-center text-blue-500 text-6xl">
            🤖
          </div>
        )}
      </div>

      {/* 使い方のヒント */}
      <div className="text-base text-gray-500 mb-2">
        下の入力欄から質問を送信して会話を始めましょう
      </div>

      {/* 例示 */}
      <div className="text-sm text-gray-400">
        例：{currentExample}
      </div>
    </div>
  );
}; 