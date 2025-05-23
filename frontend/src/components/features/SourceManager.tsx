import React, { useState, ChangeEvent, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { FileText, Loader2, PlusIcon, MoreVertical, AlertCircle, CheckCircle2, Terminal } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
}

const SourceManager: React.FC<SourceManagerProps> = ({ selectedSourceNames, onSelectionChange }) => { // ★ propsを受け取るように変更
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [sourceFiles, setSourceFiles] = useState<SourceFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<UploadStatus[]>([]);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [selectAll, setSelectAll] = useState(false);

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
    console.log('[fetchUploadedFiles] Fetching file list from manuals TABLE...');
    try {
      const { data, error } = await supabase
        .from('manuals')
        .select('file_name, original_file_name')
        .order('file_name', { ascending: true });

      console.log('[fetchUploadedFiles] select() from manuals table returned. Error:', error, 'Raw data:', data);

      if (error) {
        console.error('Error fetching file list from manuals table:', error);
        setMessage({ type: 'error', text: `ファイル一覧の取得に失敗しました: ${error.message}` });
        setSourceFiles([]);
      } else {
        const files = data?.map(item => ({ 
          name: item.original_file_name || item.file_name, 
          originalName: item.original_file_name || item.file_name,
          id: item.file_name 
        })) || [];
        console.log('[fetchUploadedFiles] Mapped files for UI from manuals table:', files);
        setSourceFiles(files);
      }
    } catch (err) {
      console.error('Unexpected error fetching files:', err);
      setMessage({ type: 'error', text: 'ファイル一覧取得中に予期せぬエラーが発生しました。' });
      setSourceFiles([]);
    } finally {
      setLoadingFiles(false);
    }
  };

  useEffect(() => {
    fetchUploadedFiles();
  }, []); // 初回マウント時のみ実行

  const handleFileTrigger = () => {
    fileInputRef.current?.click();
  };

  const handleLocalFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setMessage(null);
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
    console.log('[handleUpload] Start. File to upload:', file);

    if (!file) {
      setMessage({ type: 'error', text: 'アップロードするファイルを選択してください。' });
      console.log('[handleUpload] No file selected.');
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

        // 1. ファイル名部分をUTF-8のバイト配列にエンコード
        const utf8Bytes = new TextEncoder().encode(fileNameOnly);
        
        // 2. バイト配列をBase64文字列にエンコード
        //    Uint8Arrayの各要素を文字コードとして扱い、バイナリ文字列に変換
        let binaryString = '';
        utf8Bytes.forEach((byte) => {
          binaryString += String.fromCharCode(byte);
        });
        let base64Encoded = btoa(binaryString);
        
        // URLセーフな文字に置換し、パディングを削除
        base64Encoded = base64Encoded
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
        
        return `${base64Encoded}${extension}`;
      } catch (error) {
        console.error('Failed to encode filename:', error);
        // エンコードに失敗した場合は英数字のみに変換し、拡張子を保持
        const safeName = name.substring(0, name.lastIndexOf('.')).replace(/[^a-zA-Z0-9-]/g, '_');
        const ext = name.substring(name.lastIndexOf('.'));
        return `${safeName}${ext}`;
      }
    };

    const encodedFileName = encodeFileName(originalFileName);
    console.log(`[handleUpload] Original filename: ${originalFileName}, Encoded: ${encodedFileName}`);

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

        const response = await fetch(finalFunctionUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            fileName: encodedFileName,
            originalFileName: originalFileName  // 元のファイル名も送信
          }),
        });

        const responseData = await response.json();
        if (!response.ok) {
          console.error('[handleUpload] Edge Function call failed:', response.status, responseData);
          throw new Error(responseData.error || `Edge Functionの実行に失敗 (status: ${response.status})`);
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
    console.log('[handleUpload] End.');
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
  
  useEffect(() => {
    if (sourceFiles.length > 0 && selectedSourceNames.length === sourceFiles.length) {
      setSelectAll(true);
    } else {
      setSelectAll(false);
    }
  }, [selectedSourceNames, sourceFiles]);

  const handleDeleteFile = async (fileName: string) => {
    // アップロード中のファイルは削除できない
    const uploadingFile = uploadQueue.find(item => item.originalFileName === fileName);
    if (uploadingFile) {
      setMessage({ type: 'error', text: `ファイル「${fileName}」はアップロード中のため削除できません。` });
      return;
    }

    if (!window.confirm(`ファイル「${fileName}」を本当に削除しますか？`)) {
      return;
    }
    
    // UIで表示されているファイル名から、実際のStorageファイル名（エンコードされた名前）を取得
    const targetFile = sourceFiles.find(file => file.name === fileName);
    if (!targetFile) {
      setMessage({ type: 'error', text: `ファイル「${fileName}」が見つかりません。` });
      return;
    }
    const storageFileName = targetFile.id; // エンコードされたファイル名
    
    setMessage({ type: 'info', text: `ファイル「${fileName}」を削除中です...` });
    try {
      // Step 1: Delete from Storage (エンコードされたファイル名を使用)
      const { error: storageError } = await supabase.storage.from('manuals').remove([storageFileName]);

      if (storageError) {
        console.error('Storage delete error:', storageError);
        setMessage({ type: 'error', text: `ストレージからのファイル「${fileName}」の削除に失敗しました: ${storageError.message}` });
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
        setMessage({ type: 'error', text: `DBからのファイル「${fileName}」のレコード削除に失敗しました: ${tableError.message}。ストレージからは削除済みです。` });
        await fetchUploadedFiles();
        return;
      }
      
      console.log(`Record for「${storageFileName}」deleted from manuals table.`);

      // Step 3: Fetch updated list and update UI
      await fetchUploadedFiles();
      onSelectionChange(selectedSourceNames.filter(name => name !== fileName));
      setMessage({ type: 'success', text: `ファイル「${fileName}」を完全に削除しました。` });

    } catch (err: unknown) {
      console.error('Generic delete error:', err);
      let deleteErrorMessage = 'ファイル削除中に予期せぬエラーが発生しました。';
      if (err instanceof Error) {
        deleteErrorMessage = err.message;
      }
      setMessage({ type: 'error', text: deleteErrorMessage });
    }
  };

  const handleRenameFile = async (oldName: string) => {
    // アップロード中のファイルは名前変更できない
    const uploadingFile = uploadQueue.find(item => item.originalFileName === oldName);
    if (uploadingFile) {
      setMessage({ type: 'error', text: `ファイル「${oldName}」はアップロード中のため名前変更できません。` });
      return;
    }

    const newNamePromptResult = window.prompt(`ファイル「${oldName}」の新しい名前を入力してください。`, oldName);
    console.log(`[handleRenameFile] Attempting to rename. Original name: '${oldName}', New name prompt result: '${newNamePromptResult}'`);

    if (newNamePromptResult === null) {
      setMessage({ type: 'info', text: 'ファイル名の変更がキャンセルされました。' });
      return;
    }

    const trimmedNewName = newNamePromptResult.trim();
    if (trimmedNewName === '') {
      setMessage({ type: 'error', text: '新しいファイル名を入力してください。' });
      return;
    }

    if (trimmedNewName === oldName) {
      setMessage({ type: 'info', text: 'ファイル名に変更はありませんでした。' });
      return;
    }

    // 重複チェック（同じ名前のファイルが既に存在するか）
    if (sourceFiles.some(file => file.name === trimmedNewName)) {
      setMessage({ type: 'error', text: `ファイル名「${trimmedNewName}」は既に存在します。` });
      return;
    }

    // UIで表示されているファイル名から、実際のStorageファイル名（エンコードされた名前）を取得
    const targetFile = sourceFiles.find(file => file.name === oldName);
    if (!targetFile) {
      setMessage({ type: 'error', text: `ファイル「${oldName}」が見つかりません。` });
      return;
    }
    const storageFileName = targetFile.id; // エンコードされたファイル名

    setMessage({ type: 'info', text: `ファイル「${oldName}」を「${trimmedNewName}」に変更しています...` });
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
        setMessage({ type: 'error', text: `ファイル名の変更に失敗しました: ${updateError.message}` });
      } else {
        setMessage({ type: 'success', text: `ファイル「${oldName}」を「${trimmedNewName}」に変更しました。` });
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
      setMessage({ type: 'error', text: renameErrorMessage });
    }
    console.log('[handleRenameFile] End.');
  };

  return (
    <div className="flex flex-col h-full p-4 space-y-4 bg-card text-card-foreground rounded-lg shadow">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">ソース</h2>
        {/* 右上のアイコンは一旦省略 (例: <PanelRightClose className="h-5 w-5" />) */}
        <Button variant="outline" size="sm" onClick={handleFileTrigger} disabled={loadingFiles}>
          <PlusIcon className="mr-2 h-4 w-4" />
          追加
        </Button>
        <Input 
          type="file" 
          ref={fileInputRef} 
          onChange={handleLocalFileChange} 
          className="hidden" 
          disabled={loadingFiles}
          accept=".pdf,.doc,.docx,.ppt,.pptx"
          multiple={true}
        />
      </div>

      {/* Select All Checkbox */}
      {sourceFiles.length > 0 && (
        <div className="flex items-center space-x-2 p-2 border-b">
          <Checkbox
            id="select-all-sources"
            checked={selectAll}
            onCheckedChange={handleSelectAllChange}
          />
          <label
            htmlFor="select-all-sources"
            className="text-sm font-medium leading-none"
          >
            すべてのソースを選択
          </label>
        </div>
      )}

      {/* File List (統合表示: 完了済み + アップロード中) */}
      <div className="flex-grow overflow-y-auto space-y-1 pr-1">
        {loadingFiles ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="mr-2 h-6 w-6 animate-spin text-muted-foreground" />
            <p className="text-muted-foreground">読み込み中...</p>
          </div>
        ) : (
          <>
            {/* アップロード中のファイル */}
            {uploadQueue.map((upload) => (
              <div key={upload.id} className={`flex items-center space-x-2 p-2 rounded-md border ${
                upload.status === 'completed' ? 'bg-green-50 border-green-200' :
                upload.status === 'error' ? 'bg-red-50 border-red-200' :
                'bg-blue-50 border-blue-200'
              }`}>
                {upload.status === 'uploading' || upload.status === 'processing' ? (
                  <Loader2 className="h-5 w-5 animate-spin text-blue-500 flex-shrink-0" />
                ) : upload.status === 'completed' ? (
                  <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
                )}
                
                <div className="flex-grow min-w-0">
                  <div className="text-sm truncate" title={upload.originalFileName}>
                    {upload.originalFileName}
                  </div>
                  <div className="text-xs text-gray-600">
                    {upload.status === 'uploading' ? 'アップロード中' :
                     upload.status === 'processing' ? '処理中' :
                     upload.status === 'completed' ? '完了' : 'エラー'}
                    {upload.message && ` - ${upload.message}`}
                  </div>
                  {upload.error && (
                    <div className="text-xs text-red-600">{upload.error}</div>
                  )}
                </div>
                
                {/* アップロード中はチェックボックス無効 */}
                <Checkbox
                  disabled={true}
                  className="ml-auto opacity-50"
                />
                
                {/* アップロード中はメニューも無効 */}
                <Button variant="ghost" size="icon" className="h-8 w-8 opacity-30" disabled>
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </div>
            ))}
            
            {/* 完了済みのファイル */}
            {sourceFiles.length > 0 ? (
              sourceFiles.map((file) => (
                <div key={file.id || file.name} className="flex items-center space-x-2 p-2 hover:bg-muted/50 rounded-md">
                  <FileText className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  <span className="flex-grow text-sm truncate" title={file.name}>{file.name}</span>
                  <Checkbox
                    id={`checkbox-${file.id || file.name}`}
                    checked={selectedSourceNames.includes(file.name)}
                    onCheckedChange={(checked) => handleSourceSelectionChange(file.name, !!checked)}
                    className="ml-auto"
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 opacity-50 hover:opacity-100">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>{file.name}</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => handleRenameFile(file.name)}>
                        名前を変更
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleDeleteFile(file.name)} className="text-red-600">
                        削除
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))
            ) : uploadQueue.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-sm text-muted-foreground">
                  アップロード済みのファイルはありません。「追加」ボタンからアップロードしてください。
                </p>
              </div>
            ) : null}
          </>
        )}
      </div>
      
      {/* Upload Status Message */}
      {message && (
        <div className="mt-auto pt-2">
            <Alert variant={message.type === 'error' ? "destructive" : "default"} className={
              message.type === 'success' ? 'bg-green-50 border-green-300 text-green-800' :
              message.type === 'error' ? 'bg-red-50 border-red-300 text-red-800' :
              'bg-blue-50 border-blue-300 text-blue-800'
            }>
              {message.type === 'success' && <CheckCircle2 className="h-4 w-4" />}
              {message.type === 'error' && <AlertCircle className="h-4 w-4" />}
              {message.type === 'info' && <Terminal className="h-4 w-4" />}
              <AlertTitle>
                {message.type === 'success' ? '成功' : message.type === 'error' ? 'エラー' : '情報'}
              </AlertTitle>
              <AlertDescription>{message.text}</AlertDescription>
            </Alert>
        </div>
      )}

      {(loadingFiles) && (
        <div className="flex items-center justify-center p-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="ml-2 text-muted-foreground">
            {loadingFiles && "ファイル一覧を読み込み中..."}
          </span>
        </div>
      )}
    </div>
  );
};

export default SourceManager; 