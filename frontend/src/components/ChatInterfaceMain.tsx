'use client'; 

import { useState, FormEvent, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  sources?: Array<{ id: string; page_number: number; text_snippet: string; similarity: number }>;
}

export default function ChatInterfaceMain() { // 関数名を変更
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      text: inputValue,
      sender: 'user',
    };
    setMessages((prevMessages) => [...prevMessages, userMessage]);
    setInputValue('');
    setIsLoading(true);

    try {
      const response = await fetch('http://localhost:3001/api/qa', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: userMessage.text }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "APIからのエラー応答が不正です。" }));
        throw new Error(errorData.error || `APIエラー: ${response.status}`);
      }

      const data = await response.json();
      const aiMessage: Message = {
        id: Date.now().toString() + '-ai',
        text: data.answer || "回答がありませんでした。",
        sender: 'ai',
        sources: data.sources,
      };
      setMessages((prevMessages) => [...prevMessages, aiMessage]);
    } catch (error) {
      console.error("APIリクエストエラー:", error);
      const errorMessage: Message = {
        id: Date.now().toString() + '-error',
        text: error instanceof Error ? error.message : "不明なエラーが発生しました。",
        sender: 'ai',
      };
      setMessages((prevMessages) => [...prevMessages, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (scrollAreaRef.current) {
        const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
        if (viewport) {
            viewport.scrollTop = viewport.scrollHeight;
        }
    }
  }, [messages]);

  return (
    // このdivがChatInterfaceMainのルート要素になります
    <div className="flex flex-col items-center justify-center h-full p-4"> 
      <Card className="w-full max-w-2xl shadow-xl h-full flex flex-col">
        <CardHeader>
          <CardTitle className="text-center text-2xl font-bold">AIチャットボット</CardTitle>
        </CardHeader>
        <CardContent className="flex-grow overflow-hidden"> {/* flex-grow と overflow-hidden を追加 */}
          <ScrollArea className="h-full w-full p-4 border rounded-md" ref={scrollAreaRef}> {/* mb-4 を削除し、h-full を適用 */}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`mb-3 flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`p-3 rounded-lg max-w-[70%] ${ 
                    msg.sender === 'user'
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                  }`}
                >
                  {msg.sender === 'user' ? (
                    <p className="whitespace-pre-wrap">{msg.text}</p>
                  ) : (
                    <div className="prose dark:prose-invert prose-sm sm:prose-base lg:prose-lg xl:prose-xl break-words">
                      <ReactMarkdown>{msg.text}</ReactMarkdown>
                    </div>
                  )}
                  {msg.sender === 'ai' && msg.sources && msg.sources.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-gray-300 dark:border-gray-600">
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
                </div>
              </div>
            ))}
            {isLoading && (
                <div className="flex justify-start mb-3">
                    <div className="p-3 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 animate-pulse">
                        AIが考え中...
                    </div>
                </div>
            )}
          </ScrollArea>
        </CardContent>
        <CardFooter>
          <form onSubmit={handleSubmit} className="flex w-full space-x-2">
            <Input
              type="text"
              placeholder="質問を入力してください..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className="flex-1"
              disabled={isLoading}
            />
            <Button type="submit" disabled={isLoading}>
              {isLoading ? '送信中...' : '送信'}
            </Button>
          </form>
        </CardFooter>
      </Card>
    </div>
  );
} 