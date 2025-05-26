'use client'; 

import { useState, FormEvent, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { marked } from 'marked';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Gauge, NotebookPen } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMemoStore } from '@/store/memoStore';
import { ChatEmptyState } from '@/components/features/ChatEmptyState';
import { useAuth } from '@clerk/nextjs';

interface Message {
  id: string;
  text: string;
  isUser: boolean;
  sources?: Array<{ id: string; page_number: number; text_snippet: string; similarity: number; original_file_name?: string }>;
  isStreaming?: boolean;
  timestamp?: Date;
}

export type AiVerbosity = 'concise' | 'default' | 'detailed';

interface ChatInterfaceMainProps {
  selectedSourceNames: string[];
}

export default function ChatInterfaceMain({ selectedSourceNames }: ChatInterfaceMainProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [aiVerbosity, setAiVerbosity] = useState<AiVerbosity>('default');
  const { getToken } = useAuth();
  const setNewMemoRequest = useMemoStore((state) => state.setNewMemoRequest);
  const setMemoViewExpanded = useMemoStore((state) => state.setMemoViewExpanded);
  const hasEditPermission = useMemoStore((state) => state.hasEditPermission); // ★ 編集権限を取得

  // 追加: ユーザーが一番下を見ているかどうかのstate
  const [isAtBottom, setIsAtBottom] = useState(true);

  // sourcesSeparatorを定義
  const sourcesSeparator = "\n\nSOURCES_SEPARATOR_MAGIC_STRING\n\n";

  // localStorageからaiVerbosity設定を読み込む
  useEffect(() => {
    const savedVerbosity = localStorage.getItem('aiVerbosity');
    if (savedVerbosity && ['concise', 'default', 'detailed'].includes(savedVerbosity)) {
      setAiVerbosity(savedVerbosity as AiVerbosity);
    }
  }, []);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      text: inputValue,
      isUser: true,
      timestamp: new Date(),
    };

    setMessages((prevMessages) => [...prevMessages, userMessage]);
    setInputValue('');
    setIsLoading(true);

    const tempAiMessageId = (Date.now() + 1).toString();
    const tempAiMessage: Message = {
      id: tempAiMessageId,
      text: '',
      isUser: false,
      timestamp: new Date(),
      isStreaming: true,
    };
    setMessages((prevMessages) => [...prevMessages, tempAiMessage]);

    try {
      // 共有ページかどうかを判定
      const urlParams = new URLSearchParams(window.location.search);
      const shareId = urlParams.get('shareId');

      let apiRequestBody;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (shareId) {
        // 共有ページの場合は認証不要
        apiRequestBody = {
          query: inputValue,
          source_filenames: selectedSourceNames,
          verbosity: aiVerbosity,
          shareId: shareId,
        };
      } else {
        // 通常ページの場合は認証が必要
        const token = await getToken({ template: 'supabase' });
        if (!token) {
          throw new Error('認証情報の取得に失敗しました。');
        }

        apiRequestBody = {
          query: inputValue,
          source_filenames: selectedSourceNames,
          verbosity: aiVerbosity,
        };

        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch('/api/qa', {
        method: 'POST',
        headers,
        body: JSON.stringify(apiRequestBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "APIからのエラー応答が不正です。" }));
        setMessages((prevMessages) => 
          prevMessages.map(msg => 
            msg.id === tempAiMessageId 
              ? { ...msg, text: errorData.error || `APIエラー: ${response.status}`, isStreaming: false } 
              : msg
          )
        );
        throw new Error(errorData.error || `APIエラー: ${response.status}`);
      }

      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulatedData = '';
        let finishedStreamingText = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            if (!finishedStreamingText && accumulatedData) {
                setMessages((prevMessages) =>
                    prevMessages.map(msg => 
                        msg.id === tempAiMessageId ? { ...msg, text: accumulatedData, isStreaming: false } : msg
                    )
                );
            } else if (!accumulatedData && !finishedStreamingText) {
                 setMessages((prevMessages) =>
                    prevMessages.map(msg => 
                        msg.id === tempAiMessageId ? { ...msg, text: "AIからの応答が空でした。", isStreaming: false } : msg
                    )
                );
            }
             setMessages((prevMessages) =>
              prevMessages.map(msg => 
                msg.id === tempAiMessageId ? { ...msg, isStreaming: false } : msg
              )
            );
            break;
          }
          accumulatedData += decoder.decode(value, { stream: true });
          
          if (!finishedStreamingText) {
            const separatorIndex = accumulatedData.indexOf(sourcesSeparator);
            if (separatorIndex !== -1) {
              const textPart = accumulatedData.substring(0, separatorIndex);
              const sourcesJsonPart = accumulatedData.substring(separatorIndex + sourcesSeparator.length);
              
              setMessages((prevMessages) =>
                prevMessages.map(msg => 
                  msg.id === tempAiMessageId ? { ...msg, text: textPart, isStreaming: false } : msg
                )
              );
              finishedStreamingText = true;
              accumulatedData = sourcesJsonPart;
              
              try {
                const sources = JSON.parse(accumulatedData);
                setMessages((prevMessages) =>
                  prevMessages.map(msg => 
                    msg.id === tempAiMessageId ? { ...msg, sources: sources, isStreaming: false } : msg
                  )
                );
                accumulatedData = "";
              } catch (e) {
                console.warn("Failed to parse sources JSON, data might be incomplete or malformed:", accumulatedData, e);
                 setMessages((prevMessages) =>
                    prevMessages.map(msg => 
                        msg.id === tempAiMessageId ? { ...msg, text: msg.text + "\n(参照情報の取得に失敗しました)", sources: [], isStreaming: false } : msg
                    )
                );
              }
            } else {
              setMessages((prevMessages) =>
                prevMessages.map(msg => 
                  msg.id === tempAiMessageId ? { ...msg, text: accumulatedData } : msg
                )
              );
            }
          } else {
            try {
                const sources = JSON.parse(accumulatedData);
                setMessages((prevMessages) =>
                  prevMessages.map(msg => 
                    msg.id === tempAiMessageId ? { ...msg, sources: sources, isStreaming: false } : msg
                  )
                );
                accumulatedData = "";
              } catch (_) {
                console.error("Error during source data chunk processing:", _);
                console.log("Waiting for more source data chunks...");
              }
          }
        }
      } else {
        console.warn("API response body is not streamable, attempting to parse as JSON.");
        const data = await response.json().catch(() => ({ answer: "AIからの応答形式が不正です。", sources: [] }));
        setMessages((prevMessages) =>
          prevMessages.map(msg => 
            msg.id === tempAiMessageId 
              ? { ...msg, text: data.answer || "回答がありませんでした。", sources: data.sources || [], isStreaming: false }
              : msg
          )
        );
      }

    } catch (error) {
      console.error("APIリクエストエラー（catchブロック）:", error);
      setMessages((prevMessages) => {
        const aiMsgExists = prevMessages.find(m => m.id === tempAiMessageId);
        if (aiMsgExists) {
          return prevMessages.map(msg => 
            msg.id === tempAiMessageId 
              ? { ...msg, text: (msg.text && msg.text !== '' ? msg.text + "\n" : "") + (error instanceof Error ? error.message : "不明なエラーが発生しました。"), isStreaming: false } 
              : msg
          );
        }
        return prevMessages;
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleMemoMessage = (message: Message) => {
    if (message.isStreaming) {
        console.log("Cannot memoize a message that is still streaming.");
        alert("AIの回答が完了してからメモを作成してください。");
        return;
    }
    const title = `AIの回答 (${new Date().toLocaleString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })})`;
    // MarkdownをHTMLに変換
    const htmlContent = marked.parse(message.text) as string;
    setNewMemoRequest({ title, content: htmlContent });
    setMemoViewExpanded(true);
    console.log('New memo request set to store:', { title, content: htmlContent });
  };

  const handleVerbosityChange = (value: string) => {
    const newVerbosity = value as AiVerbosity;
    console.log('[ChatInterfaceMain] Verbosity changed from', aiVerbosity, 'to', newVerbosity);
    setAiVerbosity(newVerbosity);
    // localStorageに保存
    localStorage.setItem('aiVerbosity', newVerbosity);
  };

  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]');
    if (!viewport) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = viewport;
      setIsAtBottom(scrollHeight - scrollTop - clientHeight < 5); // 5px以内なら一番下
    };

    viewport.addEventListener('scroll', handleScroll);
    return () => viewport.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]');
    if (viewport && isAtBottom) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [messages, isAtBottom]);

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 pt-4 pb-2 border-b flex justify-between items-center">
        <h2 className="text-lg font-semibold">AIチャット</h2>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <Gauge className="h-5 w-5" />
              <span className="sr-only">回答の詳細度を設定</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56">
            <DropdownMenuLabel>回答の詳細度</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={aiVerbosity} onValueChange={(value) => handleVerbosityChange(value)}>
              <DropdownMenuRadioItem value="concise">簡潔に</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="default">標準的</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="detailed">より丁寧に</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      
      <div className="flex-grow overflow-hidden px-6 min-h-0">
        <ScrollArea className="h-full w-full" ref={scrollAreaRef}>
          {messages.length === 0 ? (
            <ChatEmptyState />
          ) : (
            <div className="pt-4 pb-4 pr-2">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`mb-3 ${msg.isUser ? 'flex justify-end' : ''}`}
                >
                  <div className={`flex ${msg.isUser ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`p-3 rounded-lg break-words ${
                        msg.isUser
                          ? 'bg-primary text-primary-foreground w-auto max-w-4xl lg:max-w-5xl'
                          : msg.text === '' && msg.isStreaming
                          ? 'bg-muted text-muted-foreground animate-pulse max-w-[calc(100vw-4.5rem)] sm:max-w-[98%] relative'
                          : 'bg-muted text-muted-foreground max-w-[calc(100vw-4.5rem)] sm:max-w-[98%] relative'
                      }`}
                    >
                      {msg.isUser ? (
                        <p className="whitespace-pre-wrap">{msg.text}</p>
                      ) : (
                        <>
                          <div className="prose dark:prose-invert prose-sm sm:prose-base lg:prose-lg xl:prose-xl break-words">
                            {msg.text === '' && msg.isStreaming ? 'AIが考え中...' : <ReactMarkdown>{msg.text}</ReactMarkdown>}
                          </div>
                          
                          {msg.sources && !msg.isStreaming && msg.sources.length > 0 && (
                            <div className="mt-2 pt-2 border-t">
                              <p className="text-xs font-semibold mb-1">参照元:</p>
                              <ul className="list-disc list-inside text-xs">
                                {msg.sources.map(source => (
                                  <li key={source.id} title={`類似度: ${source.similarity.toFixed(3)}`}>
                                    ページ {source.page_number}: {source.text_snippet}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  
                  {/* メモを作成ボタン - AIメッセージの下に表示 */}
                  {!msg.isUser && !msg.isStreaming && msg.text && hasEditPermission && (
                    <div className="mt-2 flex justify-start">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 px-3 text-xs font-medium bg-blue-50 hover:bg-blue-100 border-blue-200 hover:border-blue-300 text-blue-700 hover:text-blue-800 shadow-sm hover:shadow-md transition-all duration-200 transform hover:scale-105"
                        onClick={() => handleMemoMessage(msg)}
                      >
                        <NotebookPen size={14} className="mr-1.5" />
                        メモを作成
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      <div className="p-4 md:p-6 border-t">
        <form onSubmit={handleSubmit} className="flex w-full space-x-2 items-center">
          <Input
            type="text"
            placeholder="質問を入力してください..."
            value={inputValue}
            onChange={(_) => setInputValue(_.target.value)}
            className="flex-1 h-12 text-base md:h-10 md:text-sm focus:outline-none focus:ring-0 focus:ring-offset-0 focus:border-gray-300 focus:shadow-none focus-visible:outline-none focus-visible:ring-0"
            disabled={isLoading}
          />
          <Button type="submit" disabled={isLoading} className="h-12 text-base px-4 md:h-10 md:px-6 md:text-sm">
            {isLoading ? '送信中...' : '送信'}
          </Button>
        </form>
      </div>
    </div>
  );
} 