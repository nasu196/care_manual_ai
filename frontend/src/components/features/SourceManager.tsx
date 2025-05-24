import React, { useState, ChangeEvent, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
// import { Input } from '@/components/ui/input'; // 未使用のためコメントアウト
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { FileText, Loader2, PlusIcon, MoreVertical, AlertCircle, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
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
  originalName: string; // ★ 元のファイル名を追加
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

// ★ propsの型定義を追加
interface SourceManagerProps {
  selectedSourceNames: string[];
  onSelectionChange: (selectedNames: string[]) => void;
  isMobileView?: boolean; // ★ isMobileView props を追加
}

const SourceManager: React.FC<SourceManagerProps> = ({ selectedSourceNames, onSelectionChange, isMobileView }) => { // ★ propsを受け取るように変更
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
  const setMessageWithAutoHide = (msg: { type: 'success' | 'error' | 'info'; text: string } | null, autoHideDelay: number = 10000) => {
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
  };

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

  const fetchUploadedFiles = async () => {
    setLoadingFiles(true);
    try {
      const { data, error } = await supabase
        .from('manuals')
        .select('file_name, original_file_name')
        .order('file_name', { ascending: true });

      if (error) {
        console.error('Error fetching file list from manuals table:', error);
        setMessageWithAutoHide({ type: 'error', text: `ファイル一覧の取得に失敗しました: ${error.message}` });
        setSourceFiles([]);
      } else {
        const files = data?.map(item => ({ 
          name: item.original_file_name || item.file_name, 
          originalName: item.original_file_name || item.file_name,
          id: item.file_name 
        })) || [];
        setSourceFiles(files);
      }
    } catch (err) {
      console.error('Unexpected error fetching files:', err);
      setMessageWithAutoHide({ type: 'error', text: 'ファイル一覧取得中に予期せぬエラーが発生しました。' });
      setSourceFiles([]);
    } finally {
      setLoadingFiles(false);
    }
  };

  useEffect(() => {
    fetchUploadedFiles();
  }, []); // 初回マウント時のみ実行

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
      console.log(`[handleLocalFileChange] Selected ${files.length} files for upload`);
      
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
      const bucketName = 'manuals';
      const { error: uploadError } = await supabase.storage
        .from(bucketName)
        .upload(`${encodedFileName}`, file, {
          cacheControl: '3600',
          upsert: true,
        });
      console.log('[handleUpload] Supabase upload call returned. Error:', uploadError);

      if (uploadError) {
        console.error('[handleUpload] Upload error details:', uploadError);
        updateUploadStatus(uploadId, {
          status: 'error',
          error: `アップロードに失敗しました: ${uploadError.message}`,
          message: `エラー: ${uploadError.message}`
        });
        return;
      }
      
      updateUploadStatus(uploadId, {
        status: 'processing',
        message: `処理中...`
      });

      await fetchUploadedFiles();

      try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        if (!supabaseUrl) {
          throw new Error("NEXT_PUBLIC_SUPABASE_URL is not defined.");
        }
        const urlRegex = new RegExp('https://([^.]+)\\.supabase\\.co');
        const match = supabaseUrl.match(urlRegex);
        const projectRef = match ? match[1] : null;
        if (!projectRef) {
          throw new Error("Supabase project reference ID could not be determined from NEXT_PUBLIC_SUPABASE_URL.");
        }
        const finalFunctionUrl = `https://${projectRef}.supabase.co/functions/v1/process-manual-function`;
        console.log(`[handleUpload] Calling Edge Function: ${finalFunctionUrl} for file: ${encodedFileName}`);

        // ★ より詳細なエラーハンドリングを追加
        let response;
        try {
          response = await fetch(finalFunctionUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              fileName: encodedFileName,
              originalFileName: originalFileName  // 元のファイル名も送信
            }),
          });
        } catch (fetchError) {
          console.error(`[handleUpload] Network error during Edge Function call:`, fetchError);
          throw new Error(`Edge Function呼び出し時のネットワークエラー: ${fetchError instanceof Error ? fetchError.message : '不明なエラー'}`);
        }

        // ★ レスポンスの詳細ログを追加
        console.log(`[handleUpload] Edge Function response status: ${response.status}`);
        console.log(`[handleUpload] Edge Function response headers:`, Object.fromEntries(response.headers.entries()));
        
        let responseData;
        try {
          const responseText = await response.text();
          console.log(`[handleUpload] Edge Function raw response text:`, responseText);
          
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

        console.log('[handleUpload] Edge Function call successful:', responseData);
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
    } catch (err: unknown) {
      console.error('Outer catch error during upload:', err);
      let outerErrorMessage = 'アップロード処理中に予期せぬエラーが発生しました。';
      if (err instanceof Error) {
        outerErrorMessage = err.message;
      }
      updateUploadStatus(uploadId, {
        status: 'error',
        error: outerErrorMessage,
        message: `エラー: ${outerErrorMessage}`
      });
      // ★ エラーの場合も10秒後にキューから削除
      setTimeout(() => {
        removeFromUploadQueue(uploadId);
      }, 10000);
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
      // Step 1: Delete from Storage (エンコードされたファイル名を使用)
      const { error: storageError } = await supabase.storage.from('manuals').remove([storageFileName]);

      if (storageError) {
        console.error('Storage delete error:', storageError);
        setMessageWithAutoHide({ type: 'error', text: `ストレージからのファイル「${fileName}」の削除に失敗しました: ${storageError.message}` });
        return;
      }

      console.log(`File「${storageFileName}」deleted from storage.`);

      // Step 2: Delete from manuals table (エンコードされたファイル名で検索)
      const { error: tableError } = await supabase
        .from('manuals')
        .delete()
        .eq('file_name', storageFileName);

      if (tableError) {
        console.error('Table delete error:', tableError);
        setMessageWithAutoHide({ type: 'error', text: `DBからのファイル「${fileName}」のレコード削除に失敗しました: ${tableError.message}。ストレージからは削除済みです。` });
        await fetchUploadedFiles();
        return;
      }
      
      console.log(`Record for「${storageFileName}」deleted from manuals table.`);

      // Step 3: Fetch updated list and update UI
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
    console.log(`[handleRenameFile] Attempting to rename. Original name: '${oldName}', New name prompt result: '${newNamePromptResult}'`);

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
    console.log(`[handleRenameFile] Updating original_file_name in database for file: ${storageFileName}`);
    
    try {
      // Storageファイル名は変更せず、manualsテーブルのoriginal_file_nameのみ更新
      const { error: updateError } = await supabase
        .from('manuals')
        .update({ original_file_name: trimmedNewName })
        .eq('file_name', storageFileName);
        
      console.log('[handleRenameFile] Database update call returned. Error:', JSON.stringify(updateError, null, 2));
      
      if (updateError) {
        console.error('[handleRenameFile] Database update error:', updateError);
        setMessageWithAutoHide({ type: 'error', text: `ファイル名の変更に失敗しました: ${updateError.message}` });
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
    console.log('[handleRenameFile] End.');
  };

  // ★ ソースデータ取得関数
  const fetchSourceData = async (fileName: string) => {
    setLoadingSourceData(true);
    try {
      // UIで表示されているファイル名から、実際のStorageファイル名（エンコードされた名前）を取得
      const targetFile = sourceFiles.find(file => file.name === fileName);
      if (!targetFile) {
        setMessageWithAutoHide({ type: 'error', text: `ファイル「${fileName}」が見つかりません。` });
        return;
      }
      const storageFileName = targetFile.id; // エンコードされたファイル名

      // manualsテーブルからmanual_idを取得
      const { data: manualData, error: manualError } = await supabase
        .from('manuals')
        .select('id')
        .eq('file_name', storageFileName)
        .single();

      if (manualError || !manualData) {
        console.error('Manual not found:', manualError);
        setMessageWithAutoHide({ type: 'error', text: `ファイル「${fileName}」のデータが見つかりません。` });
        return;
      }

      // manual_chunksからテキストデータを取得
      const { data: chunksData, error: chunksError } = await supabase
        .from('manual_chunks')
        .select('chunk_text, chunk_order')
        .eq('manual_id', manualData.id)
        .order('chunk_order', { ascending: true });

      if (chunksError) {
        console.error('Error fetching chunks:', chunksError);
        setMessageWithAutoHide({ type: 'error', text: `テキストデータの取得に失敗しました: ${chunksError.message}` });
        return;
      }

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