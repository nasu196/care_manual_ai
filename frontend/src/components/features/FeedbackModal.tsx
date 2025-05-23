"use client";

import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose, // ダイアログを閉じるために追加
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface FeedbackModalProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onFeedbackSubmitSuccess?: () => void; // 送信成功時のコールバック (任意)
}

export const FeedbackModal: React.FC<FeedbackModalProps> = ({ isOpen, onOpenChange, onFeedbackSubmitSuccess }) => {
  const [feedbackText, setFeedbackText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // モーダルが開かれたときに状態をリセット
  useEffect(() => {
    if (isOpen) {
      setFeedbackText('');
      setError(null);
      setSubmitSuccess(false);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (feedbackText.trim() === '') {
      setError('フィードバック内容を入力してください。');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    setSubmitSuccess(false);

    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: feedbackText }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `フィードバックの送信に失敗しました。(HTTP ${response.status})`);
      }
      
      // 成功時
      setSubmitSuccess(true);
      setFeedbackText(''); // テキストエリアをクリア
      if (onFeedbackSubmitSuccess) {
        onFeedbackSubmitSuccess();
      }
      // 2秒後にモーダルを閉じるなどの処理も可能
      // setTimeout(() => onOpenChange(false), 2000);

    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      }
      else {
        setError('不明なエラーが発生しました。');
      }
      console.error('Feedback submission error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[525px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>フィードバックを送信</DialogTitle>
            <DialogDescription>
              サービスに関するご意見・ご感想をお聞かせください。今後の改善に役立たせていただきます。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid w-full gap-1.5">
              <Label htmlFor="feedback-message">フィードバック内容</Label>
              <Textarea
                id="feedback-message"
                placeholder="こちらにフィードバックをご記入ください..."
                rows={6}
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                disabled={isSubmitting || submitSuccess}
              />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            {submitSuccess && (
              <p className="text-sm text-green-600">
                フィードバックが送信されました。ありがとうございます！
              </p>
            )}
          </div>
          <DialogFooter>
            {!submitSuccess ? (
              <>
                <DialogClose asChild>
                  <Button type="button" variant="outline" disabled={isSubmitting}>
                    キャンセル
                  </Button>
                </DialogClose>
                <Button type="submit" disabled={isSubmitting || feedbackText.trim() === ''}>
                  {isSubmitting ? '送信中...' : '送信する'}
                </Button>
              </>
            ) : (
              <DialogClose asChild>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}> {/* 送信成功後は閉じるボタンのみ */}
                  閉じる
                </Button>
              </DialogClose>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}; 