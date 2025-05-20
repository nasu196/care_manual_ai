'use client'; 

import { useState, FormEvent, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SlidersHorizontal } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  sources?: Array<{ id: string; page_number: number; text_snippet: string; similarity: number }>;
}

export type AiVerbosity = 'concise' | 'default' | 'detailed';

export default function ChatInterfaceMain() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [aiVerbosity, setAiVerbosity] = useState<AiVerbosity>('default');

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
        body: JSON.stringify({ 
          query: userMessage.text,
          verbosity: aiVerbosity,
        }),
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
    <div className="h-full flex flex-col">
      <div className="p-4 border-b flex justify-between items-center">
        <h2 className="text-lg font-semibold">AIチャット</h2>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <SlidersHorizontal className="h-5 w-5" />
              <span className="sr-only">回答の詳細度を設定</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56">
            <DropdownMenuLabel>回答の詳細度</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={aiVerbosity} onValueChange={(value) => setAiVerbosity(value as AiVerbosity)}>
              <DropdownMenuRadioItem value="concise">簡潔に</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="default">デフォルト</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="detailed">より丁寧に</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      
      <div className="flex-grow overflow-hidden px-6 min-h-0">
        <ScrollArea className="h-full w-full" ref={scrollAreaRef}>
          <div className="pt-4 pb-4 pr-6">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`mb-3 flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`p-3 rounded-lg ${ 
                    msg.sender === 'user'
                      ? 'bg-primary text-primary-foreground max-w-[70%]'
                      : 'bg-muted text-muted-foreground max-w-[95%]'
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
                </div>
              </div>
            ))}
            {isLoading && (
                <div className="flex justify-start mb-3">
                    <div className="p-3 rounded-lg bg-muted text-muted-foreground animate-pulse">
                        AIが考え中...
                    </div>
                </div>
            )}
          </div>
        </ScrollArea>
      </div>

      <div className="p-6 border-t">
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
      </div>
    </div>
  );
} 