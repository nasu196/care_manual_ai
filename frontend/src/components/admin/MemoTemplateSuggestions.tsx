import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import MemoTemplateSuggestionItem from './MemoTemplateSuggestionItem';
import { Button } from '@/components/ui/button';
import { Loader2, SlidersHorizontal } from 'lucide-react';
import type { FunctionsError } from '@supabase/supabase-js';
import Image from 'next/image';
import { TooltipProvider } from "@/components/ui/tooltip";
import { motion, AnimatePresence } from 'framer-motion';
import { useMemoStore } from '@/store/memoStore';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from '@clerk/nextjs';
import { marked } from 'marked';

// AIが生成するメモのソース情報の型 (エクスポートする)
export interface AIGeneratedMemoSource {
  id: string;
  manual_id: string;
  file_name: string;
  similarity: number;
  text_snippet: string;
}

// ChatInterfaceMain.tsx から AiVerbosity 型をコピー
export type AiVerbosity = 'concise' | 'default' | 'detailed';

const getLocalStorageKey = (userId: string) => `nextActionSuggestionsCache_${userId}`;
const CACHE_EXPIRATION_MS = 2 * 24 * 60 * 60 * 1000; // 2 days in milliseconds

interface Suggestion {
  id: string;
  title: string;
  description: string;
  source_files?: string[]; // APIのレスポンスに合わせて optional に
}

// Propsの型定義を修正
interface MemoTemplateSuggestionsProps {
  selectedSourceNames: string[];
}

const MemoTemplateSuggestions: React.FC<MemoTemplateSuggestionsProps> = ({ selectedSourceNames }) => {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false); // 提案取得時のローディング
  const [error, setError] = useState<string | null>(null); // 提案取得時のエラー
  const [hasFetchedOnce, setHasFetchedOnce] = useState<boolean>(false);
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null);

  // メモ生成モーダル関連のstate
  const [isGenerateMemoModalOpen, setIsGenerateMemoModalOpen] = useState(false);
  const [selectedIdeaForModal, setSelectedIdeaForModal] = useState<Suggestion | null>(null);
  const [generateMemoError, setGenerateMemoError] = useState<string | null>(null); // メモ生成時のエラー
  const [aiVerbosity, setAiVerbosity] = useState<AiVerbosity>('default'); // 詳細度のためのstateを追加

  const triggerMemoListRefresh = useMemoStore((state) => state.triggerMemoListRefresh);
  const addGeneratingMemo = useMemoStore((state) => state.addGeneratingMemo);
  const updateGeneratingMemoStatus = useMemoStore((state) => state.updateGeneratingMemoStatus);
  const removeGeneratingMemo = useMemoStore((state) => state.removeGeneratingMemo);
  const setIsAnyModalOpen = useMemoStore((state) => state.setIsAnyModalOpen);

  const { userId: clerkUserId, isSignedIn: isClerkSignedIn, getToken } = useAuth();

  // 共有ページかどうかを判定
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const shareId = urlParams?.get('shareId');

  useEffect(() => {
    if (!clerkUserId) return; // ユーザーIDがない場合は何もしない
    
    try {
      const localStorageKey = getLocalStorageKey(clerkUserId);
      const cachedItemText = localStorage.getItem(localStorageKey);
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
            localStorage.removeItem(localStorageKey);
          }
        } else {
          console.warn("Cached suggestions are expired, not in the new format, or invalid. Clearing cache.");
          localStorage.removeItem(localStorageKey);
        }
      }
    } catch (e) {
      console.error("Failed to load or parse suggestions from localStorage", e);
      if (clerkUserId) {
        localStorage.removeItem(getLocalStorageKey(clerkUserId));
      }
    }
  }, [clerkUserId]);

  const fetchSuggestions = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setGenerateMemoError(null); 
    setMessage(null); 
    setHasFetchedOnce(true);

    if (!selectedSourceNames || selectedSourceNames.length === 0) {
      setMessage({ type: 'info', text: '提案を生成するには、まずソースを選択してください。' });
      setSuggestions([]);
      setIsLoading(false);
      return;
    }
    
    // Clerkトークンを取得 (ここ！ getToken は useAuth から取得済みのはず)
    let token;
    try {
      token = await getToken({ template: 'supabase' }); 
      if (!token) {
        throw new Error('Clerk token is not available.');
      }
    } catch (e) {
      console.error("Failed to get Clerk token:", e);
      setError('認証情報の取得に失敗しました。再ログインしてみてください。');
      setIsLoading(false);
      return;
    }

    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!supabaseUrl) {
        throw new Error('Supabase URL is not configured (NEXT_PUBLIC_SUPABASE_URL).');
      }
      const edgeFunctionUrl = `${supabaseUrl}/functions/v1/suggest-next-actions`;

      const response = await fetch(edgeFunctionUrl, {
          method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ selectedFileNames: selectedSourceNames }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: `Failed to fetch suggestions. Edge Function status: ${response.status}` }));
        throw new Error(errorData.error || `Failed to fetch suggestions. Edge Function status: ${response.status}`);
      }

      const responseText = await response.text(); // Edge Function が直接文字列を返すことを想定

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
          // 今回は、より安全に、全体をパースしようとするフォールバックに倒すが、AIの出力が安定しているならエラーの方が良いかもしれない
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
        if (clerkUserId) {
          const itemToCache = {
            suggestions: fetchedSuggestions,
            timestamp: Date.now()
          };
          const localStorageKey = getLocalStorageKey(clerkUserId);
          localStorage.setItem(localStorageKey, JSON.stringify(itemToCache));
          console.log("Saved suggestions to cache with timestamp.");
        }
      } catch (e) {
        console.error("Failed to save suggestions to localStorage", e);
      }

    } catch (err) {
      console.error("Error fetching suggestions:", err);
      let errorMessage = '提案の取得中に不明なエラーが発生しました。';
      
      if (err instanceof Error) {
        errorMessage = err.message;
      }

      const functionError = err as FunctionsError;
      if (functionError && typeof functionError === 'object' && functionError !== null) {
        if (functionError.message && errorMessage !== functionError.message) {
            errorMessage = `${errorMessage} (${functionError.message})`.trim();
        }
      }
      setError(errorMessage.replace(/^\(不明なエラーが発生しました。\) /,''));
      setSuggestions([]);
    } finally {
      setIsLoading(false);
    }
  }, [selectedSourceNames, getToken, clerkUserId]);

  // アイデアカードクリック時のハンドラ
  const handleSuggestionItemClick = (suggestion: Suggestion) => {
    setSelectedIdeaForModal(suggestion);
    setGenerateMemoError(null); // モーダルを開くときに前回のエラーをクリア
    setIsGenerateMemoModalOpen(true);
    setIsAnyModalOpen(true);
  };

  // モーダルで「作成」が押されたときのハンドラ
  const handleConfirmGenerateMemo = useCallback(async () => {
    if (!selectedIdeaForModal) {
      setGenerateMemoError('提案が選択されていません。');
      return;
    }
    if (!isClerkSignedIn) {
      setGenerateMemoError('Supabaseクライアントの準備ができていないか、認証されていません。');
      return;
    }

    const tempMemoId = Date.now().toString();
    addGeneratingMemo({
      id: tempMemoId,
      title: selectedIdeaForModal.title,
      status: 'prompt_creating',
    });

    setIsGenerateMemoModalOpen(false);
    setIsAnyModalOpen(false);
    const memoTitle = selectedIdeaForModal.title;
    console.log("Generating memo for:", memoTitle, "by user:", clerkUserId);

    let tokenForCreateMemo; 
    try {
      tokenForCreateMemo = await getToken({ template: 'supabase' }); 
      if (!tokenForCreateMemo) {
        throw new Error('Clerk token for create-memo is not available.');
      }
    } catch (e) {
      console.error("Failed to get Clerk token for create-memo:", e);
      setGenerateMemoError('メモ作成のための認証情報の取得に失敗しました。再ログインしてみてください。');
      updateGeneratingMemoStatus(tempMemoId, 'error', { errorMessage: '認証トークン取得失敗' });
      return;
    }

    try {
      console.log(`[${tempMemoId}] Calling PromptCraftLLM for: ${memoTitle}`);
      const promptResponse = await fetch('/api/craft-memo-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ideaTitle: selectedIdeaForModal.title,
          ideaDescription: selectedIdeaForModal.description,
          sourceFileNames: selectedIdeaForModal.source_files || [],
        }),
      });
      if (!promptResponse.ok) {
        const errorText = await promptResponse.text(); 
        let errorJson = {};
        try { errorJson = JSON.parse(errorText); } catch {}
        const errorMessage = (typeof errorJson === 'object' && errorJson !== null && 'error' in errorJson && typeof errorJson.error === 'string') 
                           ? errorJson.error 
                           : errorText || 'プロンプト作成リクエストの処理中に不明なエラーが発生しました。';
        throw new Error(errorMessage);
      }
      const { generatedPrompt } = await promptResponse.json();
      console.log(`[${tempMemoId}] PromptCraftLLM successful.`);

      updateGeneratingMemoStatus(tempMemoId, 'memo_generating');
      console.log(`[${tempMemoId}] Calling MemoWriterLLM for: ${memoTitle}`);
      const memoResponse = await fetch('/api/generate-memo', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenForCreateMemo}`,
        },
        body: JSON.stringify({
          crafted_prompt: generatedPrompt,
          source_filenames: selectedIdeaForModal.source_files || [],
          verbosity: aiVerbosity,
        }),
      });
      if (!memoResponse.ok) {
        const errorData = await memoResponse.json().catch(() => ({error: 'メモ生成リクエストの解析に失敗'}));
        throw new Error(errorData.error || 'メモの生成に失敗しました。');
      }
      const memoGenerationResult = await memoResponse.json();
      console.log(`[${tempMemoId}] MemoWriterLLM successful.`);
      
      // ☆☆☆ デバッグログ追加 ☆☆☆
      console.log(`[${tempMemoId}] Raw memoGenerationResult from API:`, JSON.stringify(memoGenerationResult, null, 2));

      if (!memoGenerationResult || !memoGenerationResult.generated_memo) {
        // ☆☆☆ より詳細なエラーメッセージ ☆☆☆
        let detail = "Response was null or undefined.";
        if (memoGenerationResult) {
          detail = "'generated_memo' property was missing, null, or empty.";
        }
        console.error(`[${tempMemoId}] Invalid memo generation result. Detail: ${detail}. Raw response:`, memoGenerationResult);
        throw new Error(`AIからのメモ生成結果が不正です。(詳細: ${detail})`);
        }
        
      // Markdown から HTML への変換
      const htmlContent = marked.parse(memoGenerationResult.generated_memo) as string;

      updateGeneratingMemoStatus(tempMemoId, 'saving', {
        newTitle: memoTitle,
        newContent: htmlContent,
        newSources: memoGenerationResult.sources,
      });

      // ▼▼▼ create-memo 呼び出し: 標準 fetch で Edge Function を直接呼び出す ▼▼▼
      try {
        console.log(`[${tempMemoId}] Calling create-memo Edge Function directly for: ${memoTitle}`);
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        if (!supabaseUrl) {
          throw new Error('Supabase URL is not configured (NEXT_PUBLIC_SUPABASE_URL).');
        }
        const edgeFunctionUrl = `${supabaseUrl}/functions/v1/create-memo`;

        const response = await fetch(edgeFunctionUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${tokenForCreateMemo}`,
          },
          body: JSON.stringify({
                title: memoTitle,
            content: htmlContent,
                is_ai_generated: true,
            ai_generation_sources: memoGenerationResult.sources,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: `Failed to save memo. Edge Function status: ${response.status}` }));
          throw new Error(errorData.error || `Failed to save memo. Edge Function status: ${response.status}`);
        }

        const createdMemo = await response.json();

        console.log(`[${tempMemoId}] create-memo Edge Function successful:`, createdMemo);
            removeGeneratingMemo(tempMemoId);
            triggerMemoListRefresh();

      } catch (err) {
        console.error(`[${tempMemoId}] Error calling create-memo Edge Function:`, err);
        let createErrorMessage = 'メモの保存中にエラーが発生しました。';
        if (err instanceof Error) {
          createErrorMessage = err.message;
        } else if (typeof err === 'object' && err !== null && 'message' in err && typeof (err as { message?: string }).message === 'string') {
          createErrorMessage = (err as { message: string }).message;
        } else if (typeof err === 'string') {
          createErrorMessage = err;
        }
        updateGeneratingMemoStatus(tempMemoId, 'error', { errorMessage: createErrorMessage });
        setGenerateMemoError(`AIはメモを生成しましたが、保存中にエラーが発生しました: ${createErrorMessage}`);
        }
      // ▲▲▲ ここまで create-memo 呼び出し処理 ▲▲▲

    } catch (e: unknown) {
      let errorMessage = 'AIによるメモの生成または初期保存処理中に不明なエラーが発生しました。';
      if (e instanceof Error) {
        errorMessage = e.message;
      } else if (typeof e === 'object' && e !== null && 'message' in e && typeof (e as { message?: unknown }).message === 'string') {
        errorMessage = (e as { message: string }).message;
        } else if (typeof e === 'string') {
        errorMessage = e;
        }
      console.error("Error generating memo with AI:", e);
      setGenerateMemoError(errorMessage);
      updateGeneratingMemoStatus(tempMemoId, 'error', { errorMessage });
      // エラー時は removeGeneratingMemo を呼ぶか、ユーザーが手動で消せるように残すか検討
    }
    // finally ブロックは不要かもしれない、エラー時や成功時でUIの状態（ローディングインジケータなど）が
    // addGeneratingMemo / updateGeneratingMemoStatus / removeGeneratingMemo で管理されるなら。
    // もし finally で共通処理が必要ならここに記述。
  }, [selectedIdeaForModal, isClerkSignedIn, getToken, aiVerbosity, addGeneratingMemo, updateGeneratingMemoStatus, removeGeneratingMemo, triggerMemoListRefresh, setIsAnyModalOpen, clerkUserId]);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
    }
  };

  // 共有ページの場合は何も表示しない
  if (shareId) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-medium text-gray-500">資料の活用アイデア</h3>
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
          <motion.div
            className="grid grid-cols-1 sm:grid-cols-2 gap-3"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            exit={{ opacity: 0 }}
          >
            {suggestions.map((suggestion, index) => (
        <MemoTemplateSuggestionItem 
                key={suggestion.id}
                suggestion={suggestion}
                index={index}
                onSuggestionClick={handleSuggestionItemClick}
        />
      ))}
          </motion.div>
        </TooltipProvider>
      )}

      {/* メモ生成モーダル */}
      {isGenerateMemoModalOpen && selectedIdeaForModal && createPortal(
        <AnimatePresence>
          <div 
            className="fixed inset-0 flex items-center justify-center p-4"
            style={{ 
              backgroundColor: 'rgba(0, 0, 0, 0.1)',
              zIndex: 999999
            }}
          >
            <motion.div 
              className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full relative"
              style={{ 
                zIndex: 1000000
              }}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
            >
              <h3 className="text-lg font-semibold mb-2">メモを生成しますか？</h3>
              <p className="text-sm mb-1">アイデア: 「{selectedIdeaForModal.title}」</p>
              {selectedIdeaForModal.source_files && selectedIdeaForModal.source_files.length > 0 && (
                <p className="text-xs text-gray-600 mb-4">
                  参照ファイル: {selectedIdeaForModal.source_files.join(', ')}
                </p>
              )}
              {/* 詳細度選択ドロップダウンを追加 */}
              <div className="mb-4">
                <label htmlFor="memo-verbosity" className="block text-sm font-medium text-gray-700 mb-1">詳細度:</label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" id="memo-verbosity" className="w-full justify-between">
                      {aiVerbosity === 'concise' ? '簡潔に' : aiVerbosity === 'detailed' ? 'より丁寧に' : '標準的'}
                      <SlidersHorizontal className="ml-2 h-4 w-4 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-56">
                    <DropdownMenuLabel>回答の詳細度</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuRadioGroup value={aiVerbosity} onValueChange={(value) => setAiVerbosity(value as AiVerbosity)}>
                      <DropdownMenuRadioItem value="concise">簡潔に</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="default">標準的</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="detailed">より丁寧に</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {generateMemoError && (
                <div className="mb-3 p-2 bg-red-100 text-red-700 rounded-md text-sm">
                  <p>エラー: {generateMemoError}</p>
                </div>
              )}
              <div className="flex justify-end gap-2 mt-5">
                <Button 
                  variant="outline" 
                  onClick={() => { 
                    setIsGenerateMemoModalOpen(false); 
                    setGenerateMemoError(null); 
                    setIsAnyModalOpen(false);
                  }} 
                >
                  キャンセル
                </Button>
                <Button onClick={handleConfirmGenerateMemo}>
                  作成する
                </Button>
              </div>
            </motion.div>
          </div>
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
};

export default MemoTemplateSuggestions; 