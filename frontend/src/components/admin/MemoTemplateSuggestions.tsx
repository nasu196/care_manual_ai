import React, { useState, useEffect } from 'react';
import MemoTemplateSuggestionItem from './MemoTemplateSuggestionItem';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import type { FunctionInvokeError } from '@supabase/supabase-js';
import Image from 'next/image';
import { TooltipProvider } from "@/components/ui/tooltip";

const LOCAL_STORAGE_KEY = 'nextActionSuggestionsCache';
const CACHE_EXPIRATION_MS = 2 * 24 * 60 * 60 * 1000; // 2 days in milliseconds

interface Suggestion {
  id: string;
  title: string;
  description: string;
  source_files?: string[];
}

// Propsの型定義を追加
interface MemoTemplateSuggestionsProps {
  selectedSourceNames: string[];
}

const MemoTemplateSuggestions: React.FC<MemoTemplateSuggestionsProps> = ({ selectedSourceNames }) => {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetchedOnce, setHasFetchedOnce] = useState<boolean>(false);
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null);

  useEffect(() => {
    try {
      const cachedItemText = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (cachedItemText) {
        const cachedItem = JSON.parse(cachedItemText);
        if (
          cachedItem &&
          typeof cachedItem.timestamp === 'number' &&
          Array.isArray(cachedItem.suggestions) &&
          (Date.now() - cachedItem.timestamp < CACHE_EXPIRATION_MS)
        ) {
          // Validate structure of cached suggestions
          if (
            cachedItem.suggestions.length === 0 ||
            (cachedItem.suggestions.length > 0 &&
              typeof cachedItem.suggestions[0].id === 'string' &&
              typeof cachedItem.suggestions[0].title === 'string' &&
              typeof cachedItem.suggestions[0].description === 'string' &&
              (cachedItem.suggestions[0].source_files === undefined || 
               (Array.isArray(cachedItem.suggestions[0].source_files) && 
                cachedItem.suggestions[0].source_files.every((sf: unknown) => typeof sf === 'string'))))
          ) {
            setSuggestions(cachedItem.suggestions);
            setHasFetchedOnce(true); // Consider if this should be true if loading from cache
            console.log("Loaded suggestions from valid cache.");
          } else {
            console.warn("Cached suggestions array has invalid structure. Clearing cache.");
            localStorage.removeItem(LOCAL_STORAGE_KEY);
          }
        } else {
          console.warn("Cached suggestions are expired, not in the new format, or invalid. Clearing cache.");
          localStorage.removeItem(LOCAL_STORAGE_KEY);
        }
      }
    } catch (e) {
      console.error("Failed to load or parse suggestions from localStorage", e);
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    }
  }, []);

  const fetchSuggestions = async () => {
    setIsLoading(true);
    setError(null);
    setHasFetchedOnce(true);

    if (!selectedSourceNames || selectedSourceNames.length === 0) {
      setMessage({ type: 'info', text: '提案を生成するには、まずソースを選択してください。' });
      setSuggestions([]);
      setIsLoading(false);
      // キャッシュはクリアしない（選択なしの状態とキャッシュされた全件提案は別物として扱う）
      // 必要であれば、ここで localStorage.removeItem(LOCAL_STORAGE_KEY) を呼ぶことも検討
      return;
    }

    try {
      const { data: responseText, error: invokeError } = await supabase.functions.invoke<string>(
        'suggest-next-actions',
        {
          method: 'POST',
          body: { selectedFileNames: selectedSourceNames } // 選択されたファイル名を渡す
        }
      );

      if (invokeError) {
        throw invokeError;
      }

      if (typeof responseText !== 'string') {
        throw new Error('AIからのレスポンスが予期しない形式です。 (Not a string)');
      }

      console.log("Raw response text from Edge Function:\n", responseText);

      let jsonStringToParse = "";
      const startIndexMarker = "```json";
      const endIndexMarker = "```";

      const startIndex = responseText.indexOf(startIndexMarker);
      if (startIndex !== -1) {
        // ```json のマーカーが見つかった場合
        const searchAfterStartMarker = responseText.substring(startIndex + startIndexMarker.length);
        const endIndex = searchAfterStartMarker.indexOf(endIndexMarker);
        if (endIndex !== -1) {
          jsonStringToParse = searchAfterStartMarker.substring(0, endIndex).trim();
          console.log("Extracted JSON string using string manipulation (client-side):\n", jsonStringToParse);
        } else {
          // 開始マーカーはあったが終了マーカーが見つからない場合
          console.warn("JSON start marker (```json) found, but end marker (```) not found. Attempting to parse from start marker to end of string, or whole string if that fails.");
          // この場合、状況によっては ```json 以降全てをパースしようと試みるか、エラーにするか判断が必要
          // 今回は、より安全に、全体をパースしようとするフォールバックに任せるか、明確なエラーとする
          // 一旦、全体をパースする方に倒すが、AIの出力が安定しているならエラーの方が良いかもしれない
          jsonStringToParse = responseText; // フォールバック：全体をパースしようと試みる
        }
      } else {
        // ```json のマーカーが見つからない場合、レスポンス全体をJSONとみなしてパースを試みる
        console.warn("JSON start marker (```json) not found in response, attempting to parse the whole string.");
        jsonStringToParse = responseText;
      }
      
      let parsedSuggestions: Array<{ id?: string; title: string; description: string; source_files?: string[] }> = [];
      try {
        const parsedData = JSON.parse(jsonStringToParse);
        if (Array.isArray(parsedData)) {
          parsedSuggestions = parsedData;
        } else if (parsedData && Array.isArray(parsedData.suggestions)) {
          parsedSuggestions = parsedData.suggestions;
        } else {
          throw new Error('解析されたデータが期待する提案の配列形式ではありません。');
        }
      } catch (e: unknown) {
        console.error("Failed to parse JSON response (client-side):", e);
        console.error("Original string attempted to parse:", jsonStringToParse);
        let errorMessage = "AIからの提案の解析中に不明なエラーが発生しました。";
        if (e instanceof Error) {
          errorMessage = `AIからの提案の解析に失敗しました。(${e.message})`;
        } else if (typeof e === 'string') {
          errorMessage = `AIからの提案の解析に失敗しました。(${e})`;
        }
        throw new Error(errorMessage);
      }

      const fetchedSuggestions: Suggestion[] = parsedSuggestions.map((suggestionObj, index) => ({
        id: suggestionObj.id || `suggestion-${Date.now()}-${index}`,
        title: suggestionObj.title || "無題の提案",
        description: suggestionObj.description || "説明がありません。",
        source_files: suggestionObj.source_files || []
      }));
      
      setSuggestions(fetchedSuggestions);

      try {
        const itemToCache = {
          suggestions: fetchedSuggestions,
          timestamp: Date.now()
        };
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(itemToCache));
        console.log("Saved suggestions to cache with timestamp.");
      } catch (e) {
        console.error("Failed to save suggestions to localStorage", e);
      }

    } catch (err) {
      console.error("Error fetching suggestions:", err);
      let errorMessage = '提案の取得中に不明なエラーが発生しました。';
      
      if (err instanceof Error) {
        errorMessage = err.message;
      }

      const functionError = err as FunctionInvokeError;
      if (functionError && typeof functionError === 'object' && functionError !== null) {
        if (functionError.message && errorMessage !== functionError.message) {
            errorMessage = `${errorMessage} (${functionError.message})`.trim();
        }
        if (functionError.details && typeof functionError.details === 'string') {
          errorMessage = `${errorMessage} Details: ${functionError.details}`.trim();
        } else if (functionError.context && typeof functionError.context === 'object' && functionError.context !== null) {
          const contextError = functionError.context.error;
          if (contextError && typeof contextError === 'object' && contextError !== null && 'message' in contextError && typeof contextError.message === 'string') {
            errorMessage = `${errorMessage} Context: ${contextError.message}`.trim();
          }
        }
      }
      setError(errorMessage.replace(/^\(不明なエラーが発生しました。\) /,''));
      setSuggestions([]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-medium text-gray-500">提案</h3>
        <Button onClick={fetchSuggestions} disabled={isLoading}>
          {isLoading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : null}
          アイディアを更新
        </Button>
      </div>

      {isLoading && (
        <div className="flex justify-center items-center h-32">
          <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
          <p className="ml-2 text-gray-500">提案を読み込んでいます...</p>
        </div>
      )}

      {!isLoading && error && (
        <div className="text-red-500 bg-red-100 border border-red-400 rounded p-3 text-sm">
          エラー: {error}
        </div>
      )}

      {/* 情報メッセージ表示の追加 */}
      {!isLoading && !error && message && (
        <div className="text-blue-700 bg-blue-100 border border-blue-400 rounded p-3 text-sm">
          情報: {message.text}
        </div>
      )}

      {!isLoading && !error && !hasFetchedOnce && suggestions.length === 0 && !message && (
        <div className="text-center text-gray-500 py-4 flex flex-col items-center">
          <Image 
            src="/thinking_animal.png"
            alt="提案を考えている動物のイラスト"
            width={160}
            height={160}
            className="mb-3"
          />
          <p>「アイディアを更新」ボタンを押して、最初の提案を取得しましょう。</p>
        </div>
      )}

      {!isLoading && !error && hasFetchedOnce && suggestions.length === 0 && !message && (
         <div className="text-center text-gray-500 py-4">
          <p>適切な提案が見つかりませんでした。</p>
        </div>
      )}

      {!isLoading && !error && suggestions.length > 0 && (
        <TooltipProvider>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {suggestions.map((suggestion, index) => (
              <MemoTemplateSuggestionItem
                key={suggestion.id}
                title={suggestion.title}
                description={suggestion.description}
                source_files={suggestion.source_files}
                isLastItem={index === suggestions.length - 1}
              />
            ))}
          </div>
        </TooltipProvider>
      )}
    </div>
  );
};

export default MemoTemplateSuggestions; 