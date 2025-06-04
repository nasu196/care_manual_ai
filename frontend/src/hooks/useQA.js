import { useState, useCallback } from 'react';

export function useQA() {
  const [isLoading, setIsLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState([]); // 30往復分の会話履歴を管理

  const MAX_HISTORY_ENTRIES = 30; // 最大30往復分

  const addToChatHistory = useCallback((userMessage, aiResponse) => {
    setChatHistory(prevHistory => {
      const newHistory = [
        ...prevHistory,
        { type: 'user', content: userMessage },
        { type: 'ai', content: aiResponse }
      ];
      // 最大30往復（60エントリ）を超えた場合は古いものから削除
      if (newHistory.length > MAX_HISTORY_ENTRIES * 2) {
        return newHistory.slice(-MAX_HISTORY_ENTRIES * 2);
      }
      return newHistory;
    });
  }, []);

  const clearChatHistory = useCallback(() => {
    setChatHistory([]);
  }, []);

  const askQuestion = useCallback(async (question, sourceFilenames = null, verbosity = 'standard', shareId = null, authToken = null) => {
    if (!question?.trim()) {
      throw new Error('質問を入力してください。');
    }

    setIsLoading(true);

    try {
      if (!shareId && !authToken) {
        throw new Error('認証が必要です。ログインしてください。');
      }

      const requestBody = {
        query: question,
        source_filenames: sourceFilenames,
        verbosity: verbosity,
        chat_history: chatHistory // クライアントサイド履歴を送信
      };

      if (shareId) {
        requestBody.shareId = shareId;
      }

      const headers = {
        'Content-Type': 'application/json',
      };

      if (!shareId && authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const response = await fetch('/api/qa', {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTPエラー: ${response.status}`);
      }

      // ReadableStreamのレスポンスを処理
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('レスポンスの読み取りができませんでした。');
      }

      let accumulatedText = '';
      let sources = null;
      const decoder = new TextDecoder();

      return {
        async *stream() {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              const chunk = decoder.decode(value, { stream: true });
              
              // SOURCESセパレータをチェック
              if (chunk.includes('SOURCES_SEPARATOR_MAGIC_STRING')) {
                const parts = chunk.split('SOURCES_SEPARATOR_MAGIC_STRING');
                if (parts.length > 1) {
                  // parts[0]をaccumulatedTextに追加
                  accumulatedText += parts[0];
                  try {
                    sources = JSON.parse(parts[1]);
                  } catch (e) {
                    console.warn('ソース情報のパースに失敗:', e);
                  }
                  // accumulatedText全体をyieldする（parts[0]だけではなく）
                  yield { text: accumulatedText, isComplete: true, sources };
                  break;
                }
              }
              
              accumulatedText += chunk;
              yield { text: chunk, isComplete: false, sources: null };
            }
          } finally {
            reader.releaseLock();
            // 回答完了時に履歴に追加
            if (accumulatedText.trim()) {
              addToChatHistory(question, accumulatedText.trim());
            }
          }
        },
        sources
      };
    } catch (error) {
      console.error('QA APIエラー:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [chatHistory, addToChatHistory]);

  return {
    askQuestion,
    isLoading,
    chatHistory,
    clearChatHistory,
    addToChatHistory
  };
} 