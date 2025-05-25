import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import MemoTemplateSuggestionItem from './MemoTemplateSuggestionItem';
import { Button } from '@/components/ui/button';
import { Loader2, SlidersHorizontal } from 'lucide-react';
import { useSupabaseClient } from '@/hooks/useSupabaseClient';
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

const LOCAL_STORAGE_KEY = 'nextActionSuggestionsCache';
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

  const supabaseClient = useSupabaseClient();

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

  const fetchSuggestions = useCallback(async () => { // useCallback でラップ
    setIsLoading(true);
    setError(null);
    setGenerateMemoError(null); // エラーをクリア
    setMessage(null); // メッセージをクリア
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
      const { data: responseText, error: invokeError } = await supabaseClient.functions.invoke<string>(
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
  }, [selectedSourceNames, supabaseClient]); // 依存配列

  // アイデアカードクリック時のハンドラ
  const handleSuggestionItemClick = (suggestion: Suggestion) => {
    setSelectedIdeaForModal(suggestion);
    setGenerateMemoError(null); // モーダルを開くときに前回のエラーをクリア
    setIsGenerateMemoModalOpen(true);
    setIsAnyModalOpen(true);
  };

  // モーダルで「作成」が押されたときのハンドラ
  const handleConfirmGenerateMemo = async () => {
    if (!selectedIdeaForModal) return;

    // デバッグログ追加
    console.log(`[handleConfirmGenerateMemo Start] Attempting to get user and session before processing idea: ${selectedIdeaForModal.title}`);
    try {
      const { data: { user: userInHandle }, error: userErrorInHandle } = await supabaseClient.auth.getUser();
      if (userErrorInHandle) {
        console.error(`[handleConfirmGenerateMemo] Error getting user:`, userErrorInHandle);
      } else {
        console.log(`[handleConfirmGenerateMemo] Current user:`, userInHandle);
      }

      const { data: { session: sessionInHandle }, error: sessionErrorInHandle } = await supabaseClient.auth.getSession();
      if (sessionErrorInHandle) {
        console.error(`[handleConfirmGenerateMemo] Error getting session:`, sessionErrorInHandle);
      } else {
        console.log(`[handleConfirmGenerateMemo] Current session:`, sessionInHandle);
      }
    } catch (e) {
      console.error(`[handleConfirmGenerateMemo] Exception getting auth state:`, e);
    }
    // ここまでデバッグログ

    setIsGenerateMemoModalOpen(false);
    setIsAnyModalOpen(false);
    
    const tempMemoId = Date.now().toString();
    const memoTitle = selectedIdeaForModal.title;

    addGeneratingMemo({ id: tempMemoId, title: memoTitle, status: 'prompt_creating' });
    
    // 個別のアイデア処理のためのコントローラを分離
    const currentIdeaForProcessing = selectedIdeaForModal;
    setSelectedIdeaForModal(null); // すぐにクリアして他のアイデアの処理を可能にする
    
    console.log("Generating memo for:", memoTitle);

    try {
      console.log(`[${tempMemoId}] Calling PromptCraftLLM for: ${memoTitle}`);
      const promptResponse = await fetch('/api/craft-memo-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ideaTitle: currentIdeaForProcessing.title,
          ideaDescription: currentIdeaForProcessing.description,
          sourceFileNames: currentIdeaForProcessing.source_files || [],
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          crafted_prompt: generatedPrompt,
          source_filenames: currentIdeaForProcessing.source_files || [],
          verbosity: aiVerbosity,
        }),
      });
      if (!memoResponse.ok) {
        const errorData = await memoResponse.json().catch(() => ({error: 'メモ生成リクエストの解析に失敗'}));
        throw new Error(errorData.error || 'メモの生成に失敗しました。');
      }
      const { generated_memo, sources } = await memoResponse.json();
      console.log(`[${tempMemoId}] MemoWriterLLM successful.`);
      
      updateGeneratingMemoStatus(tempMemoId, 'saving'); // ステータスを「保存中」に更新
      
      // generated_memo が文字列であるかの確認と基本的なエラーハンドリング (htmlContentの削除に伴い修正)
      try {
        if (typeof generated_memo !== 'string') {
          console.warn(`[${tempMemoId}] generated_memo was not a string. Received:`, generated_memo);
          updateGeneratingMemoStatus(tempMemoId, 'error', "エラー: AIからのメモ内容が予期しない形式です。");
          setTimeout(() => { removeGeneratingMemo(tempMemoId); }, 5000);
          return; // 処理中断
        }
      } catch (e) { 
        console.error(`[${tempMemoId}] Error during generated_memo validation:`, e);
        updateGeneratingMemoStatus(tempMemoId, 'error', "エラー: メモ内容の検証中に問題が発生しました。");
        setTimeout(() => { removeGeneratingMemo(tempMemoId); }, 5000);
        return; // 処理中断
      }

      // === Edge Function 'create-memo' を呼び出して保存 ===
      try {
        console.log(`[${tempMemoId}] Getting user info for create-memo Edge Function.`);
        
        // 最初にセッションをリフレッシュ（Vercel環境での認証状態を確実にする）
        const { error: refreshError } = await supabaseClient.auth.refreshSession();
        if (refreshError) {
          console.warn(`[${tempMemoId}] Failed to refresh session:`, refreshError);
        }
        
        // ユーザー情報を取得（リトライロジック付き）
        let retryCount = 0;
        let userId: string | undefined;
        
        while (retryCount < 3 && !userId) {
          const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
          
          if (userError) {
            console.error(`[${tempMemoId}] Attempt ${retryCount + 1}: Error getting user:`, userError);
            retryCount++;
            
            if (retryCount < 3) {
              // 短い待機時間を入れてリトライ
              await new Promise(resolve => setTimeout(resolve, 1000));
              // 再度セッションをリフレッシュ
              await supabaseClient.auth.refreshSession();
            }
          } else {
            userId = user?.id;
            if (userId) {
              console.log(`[${tempMemoId}] Successfully got user ID: ${userId} on attempt ${retryCount + 1}`);
            }
          }
        }

        // 開発用にユーザーIDが取れない場合はダミーIDを使用 (本番では削除または適切な処理)
        if (!userId && process.env.NODE_ENV === 'development') {
          console.warn(`[${tempMemoId}] User ID not found after retries, using dummy_user_id for development.`);
          userId = 'dummy_user_id_dev'; 
        } else if (!userId) {
          // Vercel環境でのSSR/CSR認証同期問題の回避策
          console.warn(`[${tempMemoId}] User ID not found after ${retryCount} attempts. Using anonymous user as fallback.`);
          
          // 最終的なセッション状態をログ出力
          const { data: { session } } = await supabaseClient.auth.getSession();
          console.warn(`[${tempMemoId}] Session state (for debugging):`, { 
            hasSession: !!session,
            sessionUser: session?.user?.id,
            accessToken: !!session?.access_token,
            environment: process.env.NODE_ENV
          });
          
          // 認証が取れない場合でも処理を継続（anonymous userとして）
          userId = 'anonymous';
          console.log(`[${tempMemoId}] Proceeding with anonymous user ID`);
        }

        console.log(`[${tempMemoId}] Invoking create-memo Edge Function with userId: ${userId}`);
        const { data: createdMemoData, error: invokeError } = await supabaseClient.functions.invoke('create-memo', {
            body: {
                title: memoTitle,
                content: generated_memo, // Markdownのまま
                created_by: userId,     
                is_ai_generated: true,
                ai_generation_sources: sources,
                // tags: [], // 必要であれば追加
                // is_important: false, // 必要であれば追加
            },
        });

        if (invokeError) {
            console.error(`[${tempMemoId}] Error invoking create-memo Edge Function:`, invokeError);
            let displayErrorMessage = `メモの保存に失敗しました: ${invokeError.message}`;
            // invokeError の詳細を見て、より分かりやすいメッセージを検討 (例: context.error)
            if (typeof invokeError.context === 'object' && invokeError.context !== null && 'error' in invokeError.context && typeof invokeError.context.error === 'string') {
                displayErrorMessage = invokeError.context.error; // Edge Function内で返したエラーメッセージ
            } else if (invokeError.message.includes('Function returned an error')) {
                 displayErrorMessage = 'メモ保存機能の呼び出しでサーバーエラーが発生しました。';
            }
            updateGeneratingMemoStatus(tempMemoId, 'error', displayErrorMessage);
            setTimeout(() => { removeGeneratingMemo(tempMemoId); }, 5000);
        } else if (createdMemoData && createdMemoData.memo) {
            console.log(`[${tempMemoId}] Memo saved successfully via Edge Function with ID:`, createdMemoData.memo.id);
            removeGeneratingMemo(tempMemoId);
            triggerMemoListRefresh();
        } else {
            console.warn(`[${tempMemoId}] create-memo Edge Function did not return expected data or memo object. Response:`, createdMemoData);
            updateGeneratingMemoStatus(tempMemoId, 'error', 'メモの保存結果がサーバーから正しく返されませんでした。');
            setTimeout(() => { removeGeneratingMemo(tempMemoId); }, 5000);
        }

    } catch (e: unknown) {
        console.error(`[${tempMemoId}] Unexpected error during create-memo invocation or session handling:`, e);
        let errMsg = 'メモ保存処理中に予期せぬエラーが発生しました。';
        if (typeof e === 'object' && e !== null && 'message' in e && typeof (e as { message?: unknown }).message === 'string') {
            errMsg = (e as { message: string }).message;
        } else if (typeof e === 'string') {
            errMsg = e;
        }
        updateGeneratingMemoStatus(tempMemoId, 'error', errMsg);
        setTimeout(() => { removeGeneratingMemo(tempMemoId); }, 5000);
    }
    // === ここまで Edge Function 'create-memo' を呼び出して保存 ===

    } catch (err: unknown) {
      console.error(`[${tempMemoId}] Error in memo generation/auto-save process for ${memoTitle}:`, err);
      const errorMessage = err instanceof Error ? err.message : 'メモの生成または自動保存中に不明なエラーが発生しました。';
      updateGeneratingMemoStatus(tempMemoId, 'error', errorMessage);
      
      // エラー発生時に5秒後に自動的にメモ項目を削除
      setTimeout(() => {
        removeGeneratingMemo(tempMemoId);
      }, 5000);
    }
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
    }
  };

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