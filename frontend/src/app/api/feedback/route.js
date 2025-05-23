import { NextResponse } from 'next/server';
import { Resend } from 'resend';

const resendApiKey = process.env.RESEND_API_KEY;
const feedbackToEmail = process.env.FEEDBACK_TO_EMAIL;
// 送信元メールアドレス: 環境変数 FEEDBACK_FROM_EMAIL があればそれを使用、なければ onboarding@resend.dev
const feedbackFromEmail = process.env.FEEDBACK_FROM_EMAIL || 'onboarding@resend.dev';

export async function POST(request) {
  if (!resendApiKey) {
    console.error('Resend API key is not configured.');
    return NextResponse.json({ error: 'サーバー設定エラー: メール送信機能が利用できません。(API Key)' }, { status: 500 });
  }
  if (!feedbackToEmail) {
    console.error('Feedback recipient email is not configured.');
    return NextResponse.json({ error: 'サーバー設定エラー: メール送信機能が利用できません。(Recipient Email)' }, { status: 500 });
  }

  const resend = new Resend(resendApiKey);

  try {
    const { message } = await request.json();

    if (!message || typeof message !== 'string' || message.trim() === '') {
      return NextResponse.json({ error: 'フィードバック内容 (message) が必要です。' }, { status: 400 });
    }

    const subject = `Care Manual AI - 新しいフィードバック`;
    const now = new Date();
    const emailHtmlBody = `
      <h1>新しいフィードバックが届きました</h1>
      <p><strong>受信日時:</strong> ${now.toLocaleString('ja-JP')}</p>
      <hr>
      <h2>フィードバック内容:</h2>
      <pre style="white-space: pre-wrap; word-wrap: break-word; background-color: #f9f9f9; padding: 15px; border-radius: 5px;">${
        message.replace(/</g, "&lt;").replace(/>/g, "&gt;")
      }</pre>
      <hr>
      <p>-- Care Manual AI フィードバックシステム --</p>
    `;

    const { data, error } = await resend.emails.send({
      from: `Care Manual AI Feedback <${feedbackFromEmail}>`,
      to: [feedbackToEmail],
      subject: subject,
      html: emailHtmlBody,
    });

    if (error) {
      console.error('Resend API error:', error);
      return NextResponse.json({ error: `メール送信に失敗しました: ${error.message || 'Resend APIエラー'}` }, { status: 500 });
    }

    console.log('Feedback email sent successfully:', data);
    return NextResponse.json({ success: true, message: 'フィードバックが正常に送信されました。' }, { status: 200 });

  } catch (err) {
    console.error('Error processing feedback request:', err);
    if (err instanceof SyntaxError) {
        return NextResponse.json({ error: 'リクエスト形式が不正です。' }, { status: 400 });
    }
    return NextResponse.json({ error: err.message || 'サーバー内部エラーが発生しました。' }, { status: 500 });
  }
} 