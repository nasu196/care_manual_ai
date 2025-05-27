import React, { useState, ChangeEvent, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
// import { Input } from '@/components/ui/input'; // 未使用のためコメントアウト
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { FileText, Loader2, PlusIcon, MoreVertical, AlertCircle, CheckCircle2 } from 'lucide-react';

import { useAuth } from '@clerk/nextjs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface SourceFile {
  id: string; // Supabase Storage オブジェクトは id を持たないため、name を id として使うか、別途定義が必要
  name: string;
  originalName: string;
  //必要に応じて他のプロパティ (type, size, etc.) を追加
}

interface UploadStatus {
  id: string;
  fileName: string;
  originalFileName: string;
  status: 'uploading' | 'processing' | 'completed' | 'error';
  progress?: number;
  message?: string;
  error?: string;
}


interface SourceManagerProps {
  selectedSourceNames: string[];
  onSelectionChange: (selectedNames: string[]) => void;
  isMobileView?: boolean;
}

const SourceManager: React.FC<SourceManagerProps> = ({ selectedSourceNames, onSelectionChange, isMobileView }) => { // ★ propsを受け取るように変更
  // 共有ページかどうかを判定（クライアントサイドでのみ）
  const [shareId, setShareId] = useState<string | null>(null);
  
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      setShareId(urlParams.get('shareId'));
    }
  }, []);
  
  const { getToken, isSignedIn } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messageTimerRef = useRef<NodeJS.Timeout | null>(null); // ★ メッセージ自動消去用タイマー
  const [sourceFiles, setSourceFiles] = useState<SourceFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<UploadStatus[]>([]);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [selectAll, setSelectAll] = useState(false);
  
  // ★ ソースデータ表示用のstate
  const [isSourceModalOpen, setIsSourceModalOpen] = useState(false);
  const [selectedFileForSource, setSelectedFileForSource] = useState<string>('');
  const [sourceTextData, setSourceTextData] = useState<string>('');
  const [loadingSourceData, setLoadingSourceData] = useState(false);

  // ★ メッセージ設定ヘルパー関数（自動消去機能付き）
  const setMessageWithAutoHide = useCallback((msg: { type: 'success' | 'error' | 'info'; text: string } | null, autoHideDelay: number = 10000) => {
    // 既存のタイマーをクリア
    if (messageTimerRef.current) {
      clearTimeout(messageTimerRef.current);
      messageTimerRef.current = null;
    }
    
    setMessage(msg);
    
    // 成功メッセージの場合のみ自動消去
    if (msg && msg.type === 'success') {
      messageTimerRef.current = setTimeout(() => {
        setMessage(null);
        messageTimerRef.current = null;
      }, autoHideDelay);
    }
  }, []);

  // ★ コンポーネントのクリーンアップ
  useEffect(() => {
    return () => {
      if (messageTimerRef.current) {
        clearTimeout(messageTimerRef.current);
      }
    };
  }, []);

  // 並行アップロード用のヘルパー関数
  const updateUploadStatus = (id: string, updates: Partial<UploadStatus>) => {
    setUploadQueue(prev => prev.map(item => 
      item.id === id ? { ...item, ...updates } : item
    ));
  };

  const removeFromUploadQueue = (id: string) => {
    setUploadQueue(prev => prev.filter(item => item.id !== id));
  };

  const addToUploadQueue = (uploadStatus: UploadStatus) => {
    setUploadQueue(prev => [...prev, uploadStatus]);
  };

  const fetchUploadedFiles = useCallback(async () => {
    // 共有ページの場合は何もしない
    if (shareId) {
      setLoadingFiles(false);
      return;
    }
    
    setLoadingFiles(true);
    try {
      const token = await getToken({ template: 'supabase' });
      if (!token) {
        console.error('[SourceManager] Failed to get auth token for fetching files.');
        throw new Error("Failed to get auth token for fetching files.");
      }

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      if (!supabaseUrl || !supabaseAnonKey) {
        console.error('[SourceManager] Supabase URL or Anon Key is not configured.');
        throw new Error("Supabase URL or Anon Key is not configured.");
      }

      const apiUrl = `${supabaseUrl}/rest/v1/manuals?select=file_name,original_file_name&order=file_name.asc`;

      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'apikey': supabaseAnonKey,
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: response.statusText }));
        console.error('[SourceManager] API response not OK:', errorData);
        throw new Error(errorData.message || `Failed to fetch files. Status: ${response.status}`);
      }

      const data = await response.json();



      const files = (data as Array<{file_name: string, original_file_name: string}>)?.map((item) => ({ 
        name: item.original_file_name || item.file_name, 
        originalName: item.original_file_name || item.file_name,
        id: item.file_name 
      })) || [];
      setSourceFiles(files);

    } catch (err) {
      console.error('[SourceManager] Unexpected error fetching files:', err);
      setMessageWithAutoHide({ type: 'error', text: 'ファイル一覧取得中に予期せぬエラーが発生しました。' });
      setSourceFiles([]);
    } finally {
      setLoadingFiles(false);
    }
  }, [getToken, setMessageWithAutoHide, shareId]);

  useEffect(() => {
    if (isSignedIn && typeof getToken === 'function') {
      fetchUploadedFiles();
    } else {
      setLoadingFiles(false); // サインインしていない、またはgetToken準備中の場合はローディングを解除
      setSourceFiles([]); // ファイルリストもクリア
    }
  }, [isSignedIn, getToken, fetchUploadedFiles]); // fetchUploadedFiles を依存配列に残したままにします（useCallbackでメモ化されたため）

  // 選択状態を親コンポーネントと同期
  useEffect(() => {
    const allFilesSelected = sourceFiles.length > 0 && sourceFiles.every(file => selectedSourceNames.includes(file.name));
    setSelectAll(allFilesSelected);
  }, [selectedSourceNames, sourceFiles]);

  const handleFileTrigger = () => {
    fileInputRef.current?.click();
  };

  const handleLocalFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setMessageWithAutoHide(null);
    if (event.target.files && event.target.files.length > 0) {
      const files = Array.from(event.target.files);
      
      // 複数ファイルを並行してアップロード
      files.forEach(file => {
        handleUpload(file);
      });
      
      event.target.value = '';
    }
  };

  const handleUpload = async (file: File) => {
    if (!file) {
      setMessageWithAutoHide({ type: 'error', text: 'アップロードするファイルを選択してください。' });
      return;
    }

    const originalFileName = file.name;
    const uploadId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // 日本語ファイル名対応: Base64エンコーディングを使用
    const encodeFileName = (name: string): string => {
      try {
        const lastDotIndex = name.lastIndexOf('.');
        const fileNameOnly = lastDotIndex !== -1 ? name.substring(0, lastDotIndex) : name;
        const extension = lastDotIndex !== -1 ? name.substring(lastDotIndex) : '';

        const utf8Bytes = new TextEncoder().encode(fileNameOnly);
        
        let binaryString = '';
        utf8Bytes.forEach((byte) => {
          binaryString += String.fromCharCode(byte);
        });
        let base64Encoded = btoa(binaryString);
        
        base64Encoded = base64Encoded
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
        
        return `${base64Encoded}${extension}`;
      } catch (error) {
        console.error('Failed to encode filename:', error);
        const safeName = name.substring(0, name.lastIndexOf('.')).replace(/[^a-zA-Z0-9-]/g, '_');
        const ext = name.substring(name.lastIndexOf('.'));
        return `${safeName}${ext}`;
      }
    };

    const encodedFileName = encodeFileName(originalFileName);


    // アップロードキューに追加
    addToUploadQueue({
      id: uploadId,
      fileName: encodedFileName,
      originalFileName: originalFileName,
      status: 'uploading',
      message: `アップロード中...`
    });

    try {
      // ★ Clerkトークンを取得
      const token = await getToken({ template: 'supabase' });
      if (!token) {
        console.error("Failed to get auth token for storage upload.");
        updateUploadStatus(uploadId, {
          status: 'error',
          error: '認証トークンを取得できませんでした。再ログインしてみてください。',
          message: 'エラー: 認証トークン取得失敗'
        });
        return;
      }

      // ★ JWTトークンの内容をデバッグ出力
      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1]));
          console.log('[DEBUG] JWT Payload:', payload);
          console.log('[DEBUG] user_metadata:', payload.user_metadata);
          console.log('[DEBUG] user_id from user_metadata:', payload.user_metadata?.user_id);
          console.log('[DEBUG] sub:', payload.sub);
        }
      } catch (debugError) {
        console.error('[DEBUG] Failed to parse JWT for debugging:', debugError);
      }

      // ★ Edge Function経由でアップロード
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!supabaseUrl) {
        console.error("Supabase URL is not defined.");
        updateUploadStatus(uploadId, {
          status: 'error',
          error: 'Supabase URLが設定されていません。',
          message: 'エラー: 設定不備'
        });
        return;
      }
      const uploadFunctionUrl = `${supabaseUrl}/functions/v1/upload-manual-function`;
      const formData = new FormData();
      formData.append('file', file);
      formData.append('originalFileName', originalFileName);
      const uploadResponse = await fetch(uploadFunctionUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });



      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error('[handleUpload] Storage upload error:', errorText);
        let errorMessage = `ストレージアップロードに失敗しました (status: ${uploadResponse.status})`;
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.message) {
            errorMessage = errorJson.message;
          }
        } catch {
          // JSON解析に失敗した場合はそのままテキストを使用
          if (errorText) {
            errorMessage = errorText;
          }
        }
        updateUploadStatus(uploadId, {
          status: 'error',
          error: `アップロードに失敗しました: ${errorMessage}`,
          message: `エラー: ${errorMessage}`
        });
        return;
      }

      // upload-manual-functionからのレスポンスをパース
      const uploadResult = await uploadResponse.json();
      const storagePath = uploadResult.storagePath; // `userId/encodedFileName` 形式のパス

      if (!storagePath) {
        console.error('[handleUpload] storagePath not found in upload-manual-function response:', uploadResult);
        updateUploadStatus(uploadId, {
          status: 'error',
          error: 'アップロード処理は成功しましたが、サーバーからの応答が不正です。',
          message: 'エラー: サーバー応答不備'
        });
        return;
      }
      
      updateUploadStatus(uploadId, {
        status: 'processing',
        message: `処理中...`
      });

      await fetchUploadedFiles();

      try {
        // ★ process-manual-function Edge Functionを呼び出し
        const requestUrl = `${supabaseUrl}/functions/v1/process-manual-function`;
        const headers = {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        };
        // process-manual-function には storagePath を fileNameとして渡す
        const body = JSON.stringify({ fileName: storagePath, originalFileName });

        const response = await fetch(requestUrl, {
          method: 'POST',
          headers: headers,
          body: body,
        });

        let responseData;
        try {
          const responseText = await response.text();
          
          if (responseText.trim()) {
            responseData = JSON.parse(responseText);
          } else {
            responseData = { error: 'Edge Functionからの空のレスポンス' };
          }
        } catch (parseError) {
          console.error(`[handleUpload] Failed to parse Edge Function response:`, parseError);
          throw new Error(`Edge Functionのレスポンス解析に失敗: ${parseError instanceof Error ? parseError.message : '不明なエラー'}`);
        }

        if (!response.ok) {
          console.error('[handleUpload] Edge Function call failed:', response.status, responseData);
          const errorMessage = responseData?.error || responseData?.message || `Edge Functionの実行に失敗 (status: ${response.status})`;
          throw new Error(errorMessage);
        }


        updateUploadStatus(uploadId, {
          status: 'completed',
          message: `完了`
        });

        // アップロード成功後、そのファイルを選択状態にする（元のファイル名で）
        if (!selectedSourceNames.includes(originalFileName)) {
          onSelectionChange([...selectedSourceNames, originalFileName]);
        }
        await fetchUploadedFiles();

        // 3秒後にキューから削除
        setTimeout(() => {
          removeFromUploadQueue(uploadId);
        }, 3000);

      } catch (funcError: unknown) {
        console.error('Error calling Edge Function:', funcError);
        let errorMessage = 'サーバー処理中に不明なエラーが発生しました。';
        if (funcError instanceof Error) {
          errorMessage = funcError.message;
        }
        updateUploadStatus(uploadId, {
          status: 'error',
          error: errorMessage,
          message: `処理エラー: ${errorMessage}`
        });
        // ★ エラーの場合も10秒後にキューから削除
        setTimeout(() => {
          removeFromUploadQueue(uploadId);
        }, 10000);
      }
    } catch (e) {
      console.error(`[${uploadId}] Error during file upload:`, e);
      updateUploadStatus(uploadId, {
        status: 'error',
        error: `ファイルアップロード中に予期せぬエラー: ${e instanceof Error ? e.message : String(e)}`,
        message: 'アップロードエラー'
      });
    }
  };

  const handleSelectAllChange = (checked: boolean) => {
    setSelectAll(checked);
    if (checked) {
      onSelectionChange(sourceFiles.map(file => file.name));
    } else {
      onSelectionChange([]);
    }
  };

  const handleSourceSelectionChange = (fileName: string, checked: boolean) => {
    if (checked) {
      onSelectionChange([...selectedSourceNames, fileName]);
    } else {
      onSelectionChange(selectedSourceNames.filter(name => name !== fileName));
    }
  };
  
  const handleDeleteFile = async (fileName: string) => {
    // アップロード中のファイルは削除できない
    const uploadingFile = uploadQueue.find(item => item.originalFileName === fileName);
    if (uploadingFile) {
      setMessageWithAutoHide({ type: 'error', text: `ファイル「${fileName}」はアップロード中のため削除できません。` });
      return;
    }

    if (!window.confirm(`ファイル「${fileName}」を本当に削除しますか？`)) {
      return;
    }
    
    // UIで表示されているファイル名から、実際のStorageファイル名（エンコードされた名前）を取得
    const targetFile = sourceFiles.find(file => file.name === fileName);
    if (!targetFile) {
      setMessageWithAutoHide({ type: 'error', text: `ファイル「${fileName}」が見つかりません。` });
      return;
    }
    const storageFileName = targetFile.id; // エンコードされたファイル名

    
    setMessageWithAutoHide({ type: 'info', text: `ファイル「${fileName}」を削除中です...` });
    try {
      const token = await getToken({ template: 'supabase' });
      if (!token) {
        throw new Error("Failed to get auth token for deleting file.");
      }
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!supabaseUrl) {
        throw new Error("Supabase URL is not configured.");
      }


      
            // ★ Edge Function経由でファイル削除
      const deleteFunctionUrl = `${supabaseUrl}/functions/v1/delete-file-function`;
      const deleteResponse = await fetch(deleteFunctionUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fileName: storageFileName }),
      });

      if (!deleteResponse.ok) {
        const errorData = await deleteResponse.json().catch(() => ({ message: deleteResponse.statusText }));
        console.error('Delete function error:', errorData);
        setMessageWithAutoHide({ type: 'error', text: `ファイル「${fileName}」の削除に失敗しました: ${errorData.message || deleteResponse.statusText}` });
        return;
      }


      // Fetch updated list and update UI
      await fetchUploadedFiles();
      onSelectionChange(selectedSourceNames.filter(name => name !== fileName));
      setMessageWithAutoHide({ type: 'success', text: `ファイル「${fileName}」を完全に削除しました。` });

    } catch (err: unknown) {
      console.error('Generic delete error:', err);
      let deleteErrorMessage = 'ファイル削除中に予期せぬエラーが発生しました。';
      if (err instanceof Error) {
        deleteErrorMessage = err.message;
      }
      setMessageWithAutoHide({ type: 'error', text: deleteErrorMessage });
    }
  };

  const handleRenameFile = async (oldName: string) => {
    // アップロード中のファイルは名前変更できない
    const uploadingFile = uploadQueue.find(item => item.originalFileName === oldName);
    if (uploadingFile) {
      setMessageWithAutoHide({ type: 'error', text: `ファイル「${oldName}」はアップロード中のため名前変更できません。` });
      return;
    }

    const newNamePromptResult = window.prompt(`ファイル「${oldName}」の新しい名前を入力してください。`, oldName);


    if (newNamePromptResult === null) {
      setMessageWithAutoHide({ type: 'info', text: 'ファイル名の変更がキャンセルされました。' });
      return;
    }

    const trimmedNewName = newNamePromptResult.trim();
    if (trimmedNewName === '') {
      setMessageWithAutoHide({ type: 'error', text: '新しいファイル名を入力してください。' });
      return;
    }

    if (trimmedNewName === oldName) {
      setMessageWithAutoHide({ type: 'info', text: 'ファイル名に変更はありませんでした。' });
      return;
    }

    // 重複チェック（同じ名前のファイルが既に存在するか）
    if (sourceFiles.some(file => file.name === trimmedNewName)) {
      setMessageWithAutoHide({ type: 'error', text: `ファイル名「${trimmedNewName}」は既に存在します。` });
      return;
    }

    // UIで表示されているファイル名から、実際のStorageファイル名（エンコードされた名前）を取得
    const targetFile = sourceFiles.find(file => file.name === oldName);
    if (!targetFile) {
      setMessageWithAutoHide({ type: 'error', text: `ファイル「${oldName}」が見つかりません。` });
      return;
    }
    const storageFileName = targetFile.id; // エンコードされたファイル名

    setMessageWithAutoHide({ type: 'info', text: `ファイル「${oldName}」を「${trimmedNewName}」に変更しています...` });
    
    
    try {
      const token = await getToken({ template: 'supabase' });
      if (!token) {
        throw new Error("Failed to get auth token for renaming file.");
      }
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error("Supabase URL or Anon Key is not configured.");
      }

      // Storageファイル名は変更せず、manualsテーブルのoriginal_file_nameのみ更新
      const apiUrl = `${supabaseUrl}/rest/v1/manuals?file_name=eq.${storageFileName}`;
      const response = await fetch(apiUrl, {
        method: 'PATCH',
        headers: {
          'apikey': supabaseAnonKey,
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal', // 更新後のデータを返さない場合
        },
        body: JSON.stringify({ original_file_name: trimmedNewName }),
      });
        

      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: response.statusText }));
        console.error('[handleRenameFile] Database update error:', errorData);
        setMessageWithAutoHide({ type: 'error', text: `ファイル名の変更に失敗しました: ${errorData.message || response.statusText}` });
      } else {
        setMessageWithAutoHide({ type: 'success', text: `ファイル「${oldName}」を「${trimmedNewName}」に変更しました。` });
        await fetchUploadedFiles();
        
        // 選択状態の更新ロジック
        const newSelectedNames = selectedSourceNames.map(name => 
          name === oldName ? trimmedNewName : name
        );
        if (JSON.stringify(newSelectedNames) !== JSON.stringify(selectedSourceNames)) {
          onSelectionChange(newSelectedNames);
        }
      }
    } catch (err: unknown) {
      let renameErrorMessage = 'ファイル名変更中に予期せぬエラーが発生しました。';
      if (err instanceof Error) {
        renameErrorMessage = err.message;
      }
      setMessageWithAutoHide({ type: 'error', text: renameErrorMessage });
    }
    
  };

  // ★ ソースデータ取得関数
  const fetchSourceData = async (fileName: string) => {
    setLoadingSourceData(true);
    try {
      const token = await getToken({ template: 'supabase' });
      if (!token) {
        throw new Error("Failed to get auth token for fetching source data.");
      }
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error("Supabase URL or Anon Key is not configured.");
      }

      // UIで表示されているファイル名から、実際のStorageファイル名（エンコードされた名前）を取得
      const targetFile = sourceFiles.find(file => file.name === fileName);
      if (!targetFile) {
        setMessageWithAutoHide({ type: 'error', text: `ファイル「${fileName}」が見つかりません。` });
        setLoadingSourceData(false); // ★ ローディング解除
        return;
      }
      const storageFileName = targetFile.id; // エンコードされたファイル名

      // manualsテーブルからmanual_idを取得
      const manualApiUrl = `${supabaseUrl}/rest/v1/manuals?select=id&file_name=eq.${storageFileName}`;
      const manualResponse = await fetch(manualApiUrl, {
        method: 'GET',
        headers: {
          'apikey': supabaseAnonKey,
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.pgrst.object+json', // .single() に相当
        },
      });

      if (!manualResponse.ok) {
        const errorData = await manualResponse.json().catch(() => ({ message: manualResponse.statusText }));
        console.error('Manual not found error:', errorData);
        setMessageWithAutoHide({ type: 'error', text: `ファイル「${fileName}」のデータが見つかりません: ${errorData.message || manualResponse.statusText}` });
        setLoadingSourceData(false); // ★ ローディング解除
        return;
      }
      const manualData = await manualResponse.json();
      if (!manualData || !manualData.id) { // manualData自体がnull/undefined、またはidがない場合
        console.error('Manual data or ID is missing after successful fetch');
        setMessageWithAutoHide({ type: 'error', text: `ファイル「${fileName}」のID取得に失敗しました。` });
        setLoadingSourceData(false); // ★ ローディング解除
        return;
      }

      // manual_chunksからテキストデータを取得
      const chunksApiUrl = `${supabaseUrl}/rest/v1/manual_chunks?select=chunk_text,chunk_order&manual_id=eq.${manualData.id}&order=chunk_order.asc`;
      const chunksResponse = await fetch(chunksApiUrl, {
        method: 'GET',
        headers: {
          'apikey': supabaseAnonKey,
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!chunksResponse.ok) {
        const errorData = await chunksResponse.json().catch(() => ({ message: chunksResponse.statusText }));
        console.error('Error fetching chunks:', errorData);
        setMessageWithAutoHide({ type: 'error', text: `テキストデータの取得に失敗しました: ${errorData.message || chunksResponse.statusText}` });
        setLoadingSourceData(false); // ★ ローディング解除
        return;
      }
      const chunksData = await chunksResponse.json() as Array<{chunk_text: string, chunk_order: number}>; // 型アサーション

      // チャンクを結合してテキストデータを作成
      const combinedText = chunksData?.map(chunk => chunk.chunk_text).join('\n\n') || '';
      
      setSourceTextData(combinedText);
      setSelectedFileForSource(fileName);
      setIsSourceModalOpen(true);

    } catch (err) {
      console.error('Unexpected error fetching source data:', err);
      setMessageWithAutoHide({ type: 'error', text: 'ソースデータ取得中に予期せぬエラーが発生しました。' });
    } finally {
      setLoadingSourceData(false);
    }
  };

  // 共有ページの場合は何も表示しない
  if (shareId) {
    return null;
  }

  return (
    <div className="flex flex-col h-full">
      {/* ヘッダーセクション */}
      <div className="px-4 pt-4 pb-2 border-b flex justify-between items-center">
        <h2 className="text-lg font-semibold">ソース管理</h2>
        <Button onClick={handleFileTrigger} size="icon" variant="outline">
          <PlusIcon className="h-5 w-5" />
          <span className="sr-only">ファイル追加</span>
        </Button>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleLocalFileChange}
          className="hidden"
          multiple
          accept=".pdf,.txt,.md,.docx,.pptx,.xlsx,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        />
      </div>

      {/* 全選択チェックボックス */}
      {sourceFiles.length > 0 && (
        <div className="p-4 pt-3">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="select-all-sources"
              checked={selectAll}
              onCheckedChange={handleSelectAllChange}
            />
            <label
              htmlFor="select-all-sources"
              className="text-base md:text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              全てのソースを選択/解除
            </label>
          </div>
        </div>
      )}

      {/* Alertメッセージ表示エリア (左右にパディングを追加) */}
      {message && (
        <div className="px-4">
          <Alert variant={message.type === 'error' ? 'destructive' : 'default'} className="mb-4 w-full">
            {/* アイコンをAlertの直接の子要素として配置 */}
            {message.type === 'error' && <AlertCircle className="h-4 w-4" />}
            {message.type === 'success' && <CheckCircle2 className="h-4 w-4" />}
            {/* TODO: message.type === 'info' の場合のアイコンも追加検討 */}

            {/* AlertTitleとAlertDescriptionはアイコンの兄弟要素として配置 */}
            <AlertTitle className="break-words">
              {message.type === 'error' ? 'エラー' : message.type === 'success' ? '成功' : '情報'}
            </AlertTitle>
            <AlertDescription className="break-words whitespace-pre-wrap">
              {message.text}
            </AlertDescription>
          </Alert>
        </div>
      )}

      {/* アップロードキュー */}
      {uploadQueue.length > 0 && (
        <div className="px-4 mb-4 space-y-3">
          <h3 className="text-md font-semibold text-gray-600">アップロード中のファイル:</h3>
          {uploadQueue.map((item) => (
            <div key={item.id} className="p-3 rounded-md bg-gray-50">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium truncate w-2/3" title={item.originalFileName}>
                  {item.originalFileName}
                </span>
                {item.status === 'uploading' && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
                {item.status === 'processing' && <Loader2 className="h-4 w-4 animate-spin text-yellow-500" />}
                {item.status === 'completed' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                {item.status === 'error' && <AlertCircle className="h-4 w-4 text-red-500" />}
              </div>
              {item.message && <p className="text-xs text-gray-500 mt-1">{item.message}</p>}
              {item.error && <p className="text-xs text-red-600 mt-1">{item.error}</p>}
            </div>
          ))}
        </div>
      )}
      
      {/* ファイルリスト */}
      <div className="flex-grow overflow-y-auto px-4 space-y-2">
        {loadingFiles && (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="ml-2 text-muted-foreground">ファイル一覧を読み込み中...</p>
          </div>
        )}
        {!loadingFiles && sourceFiles.length === 0 && (
          <div className="text-center text-muted-foreground py-8">
            <FileText className="mx-auto h-12 w-12 text-gray-400 mb-2" />
            <p className="font-semibold">利用可能なソースファイルがありません。</p>
            <p className="text-sm">「ファイル追加」ボタンからアップロードしてください。</p>
          </div>
        )}
        {!loadingFiles && sourceFiles.map((file) => (
          <div
            key={file.id || file.name}
            className={`flex items-center justify-between p-3 rounded-md transition-colors
                        ${selectedSourceNames.includes(file.name) ? "bg-primary/10" : "bg-gray-50 hover:bg-gray-100"}
                        `}
          >
            <div className="flex items-center space-x-3 flex-grow min-w-0">
              <Checkbox
                id={`source-${file.name}`}
                checked={selectedSourceNames.includes(file.name)}
                onCheckedChange={(checked) => handleSourceSelectionChange(file.name, !!checked)}
                className={isMobileView && selectedSourceNames.includes(file.name) ? "text-primary focus:ring-primary" : ""}
              />
              <FileText className={`h-5 w-5 ${selectedSourceNames.includes(file.name) ? "text-primary" : "text-gray-500"}`} />
              <label 
                htmlFor={`source-${file.name}`} 
                className="text-base md:text-sm font-medium truncate cursor-pointer flex-grow"
                title={file.originalName || file.name}
              >
                {file.originalName || file.name}
              </label>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreVertical className="h-4 w-4" />
                  <span className="sr-only">アクション</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>操作</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => fetchSourceData(file.name)}>
                  ソース元データを表示
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleRenameFile(file.name)}>
                  名前を変更
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleDeleteFile(file.name)}
                  className="text-red-600 hover:!bg-red-50 hover:!text-red-700"
                >
                  削除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
      </div>

      {/* ソースデータ表示モーダル */}
      <Dialog open={isSourceModalOpen} onOpenChange={setIsSourceModalOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>ソース元データ - {selectedFileForSource}</DialogTitle>
            <DialogDescription>
              PDFから抽出されたテキストデータです。OCR抽出部分は [OCR抽出テキスト] マーカーで識別されます。
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 overflow-y-auto max-h-[60vh] border rounded-md p-4 bg-gray-50">
            {loadingSourceData ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                <span>データを読み込み中...</span>
              </div>
            ) : (
              <pre className="whitespace-pre-wrap text-sm font-mono leading-relaxed">
                {sourceTextData || 'テキストデータが見つかりません。'}
              </pre>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SourceManager; 