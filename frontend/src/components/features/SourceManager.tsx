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

// ★ propsの型定義を追加
interface SourceManagerProps {
  selectedSourceNames: string[];
  onSelectionChange: (selectedNames: string[]) => void;
}

const SourceManager: React.FC<SourceManagerProps> = ({ selectedSourceNames, onSelectionChange }) => { // ★ propsを受け取るように変更
  const [selectedLocalFile, setSelectedLocalFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);
  const [processingFile, setProcessingFile] = useState<boolean>(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  
  const [sourceFiles, setSourceFiles] = useState<SourceFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState<boolean>(false);

  const [selectAll, setSelectAll] = useState(false);
  // const [selectedSourceNames, setSelectedSourceNames] = useState<string[]>([]); // ★ page.tsxからpropsとして受け取るため削除

  const fileInputRef = useRef<HTMLInputElement>(null);

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
      const file = event.target.files[0];
      setSelectedLocalFile(file);
      handleUpload(file);
      event.target.value = '';
    } else {
      setSelectedLocalFile(null);
    }
  };

  const handleUpload = async (fileToUpload: File | null) => {
    const file = fileToUpload || selectedLocalFile;
    console.log('[handleUpload] Start. File to upload:', file);

    if (!file) {
      setMessage({ type: 'error', text: 'アップロードするファイルを選択してください。' });
      console.log('[handleUpload] No file selected.');
      return;
    }

    const originalFileName = file.name;
    
    // 日本語ファイル名対応: Base64エンコーディングを使用
    const encodeFileName = (name: string): string => {
      try {
        // ファイル名と拡張子を分離
        const lastDotIndex = name.lastIndexOf('.');
        const fileName = lastDotIndex !== -1 ? name.substring(0, lastDotIndex) : name;
        const extension = lastDotIndex !== -1 ? name.substring(lastDotIndex) : '';
        
        // ファイル名部分をBase64エンコード（URLセーフ）
        const encodedName = btoa(encodeURIComponent(fileName))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
        
        return `${encodedName}${extension}`;
      } catch (error) {
        console.error('Failed to encode filename:', error);
        // エンコードに失敗した場合は英数字のみに変換
        return name.replace(/[^a-zA-Z0-9.-]/g, '_');
      }
    };

    const encodedFileName = encodeFileName(originalFileName);
    console.log(`[handleUpload] Original filename: ${originalFileName}, Encoded: ${encodedFileName}`);

    setUploading(true);
    setProcessingFile(false);
    setMessage({ type: 'info', text: `ファイル「${originalFileName}」のアップロードを開始します...` });
    console.log(`[handleUpload] Uploading file: ${encodedFileName}, size: ${file.size}, type: ${file.type}`);

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
        setMessage({ type: 'error', text: `アップロードに失敗しました: ${uploadError.message}` });
        setUploading(false);
        return;
      }
      
      setUploading(false);
      let currentMessage = `ファイル「${originalFileName}」が正常にアップロードされました。`;
      setMessage({ type: 'success', text: currentMessage });
      setSelectedLocalFile(null);
      await fetchUploadedFiles();

      setProcessingFile(true);
      currentMessage += ` 続けてファイルの処理を開始します...`;
      setMessage({ type: 'info', text: currentMessage });

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
        setMessage({
          type: 'success',
          text: `ファイル「${originalFileName}」のアップロードと処理が全て完了しました。`,
        });

        // ★ アップロード成功後、そのファイルを選択状態にする（元のファイル名で）
        if (!selectedSourceNames.includes(originalFileName)) {
          onSelectionChange([...selectedSourceNames, originalFileName]);
        }
        await fetchUploadedFiles(); // ★ Edge Function 成功後に再度ファイルリストを読み込む

      } catch (funcError: unknown) {
        console.error('Error calling Edge Function:', funcError);
        let errorMessage = 'サーバー処理中に不明なエラーが発生しました。';
        if (funcError instanceof Error) {
          errorMessage = funcError.message;
        }
        setMessage({
          type: 'error',
          text: `ファイル「${originalFileName}」の処理中にエラー: ${errorMessage}`,
        });
      } finally {
        setProcessingFile(false);
      }
    } catch (err: unknown) {
      console.error('Outer catch error during upload:', err);
      let outerErrorMessage = 'アップロード処理中に予期せぬエラーが発生しました。';
      if (err instanceof Error) {
        outerErrorMessage = err.message;
      }
      setMessage({ type: 'error', text: outerErrorMessage });
      setUploading(false);
      setProcessingFile(false);
    }
    console.log('[handleUpload] End.');
  };

  const handleSelectAllChange = (checked: boolean) => {
    setSelectAll(checked);
    if (checked) {
      // setSelectedSourceNames(sourceFiles.map(file => file.name)); // ★ onSelectionChange を呼び出すように変更
      onSelectionChange(sourceFiles.map(file => file.name));
    } else {
      // setSelectedSourceNames([]); // ★ onSelectionChange を呼び出すように変更
      onSelectionChange([]);
    }
  };

  const handleSourceSelectionChange = (fileName: string, checked: boolean) => {
    if (checked) {
      // setSelectedSourceNames(prev => [...prev, fileName]); // ★ onSelectionChange を呼び出すように変更
      onSelectionChange([...selectedSourceNames, fileName]);
    } else {
      // setSelectedSourceNames(prev => prev.filter(name => name !== fileName)); // ★ onSelectionChange を呼び出すように変更
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
    
    setUploading(true);
    setMessage({ type: 'info', text: `ファイル「${fileName}」を削除中です...` });
    try {
      // Step 1: Delete from Storage (エンコードされたファイル名を使用)
      const { error: storageError } = await supabase.storage.from('manuals').remove([storageFileName]);

      if (storageError) {
        console.error('Storage delete error:', storageError);
        setMessage({ type: 'error', text: `ストレージからのファイル「${fileName}」の削除に失敗しました: ${storageError.message}` });
        setUploading(false);
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
        setUploading(false);
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
    setUploading(false);
  };

  const handleRenameFile = async (oldName: string) => {
    const newNamePromptResult = window.prompt(`ファイル「${oldName}」の新しい名前を入力してください。`, oldName);
    console.log(`[handleRenameFile] Attempting to rename. Original name: '${oldName}', New name prompt result: '${newNamePromptResult}'`);

    if (newNamePromptResult === null) {
      setMessage({ type: 'info', text: 'ファイル名の変更がキャンセルされました。' });
      return;
    }
    const trimmedNewName = newNamePromptResult.trim();
    if (trimmedNewName === '') {
      setMessage({ type: 'error', text: 'ファイル名が空です。変更はキャンセルされました。' });
      return;
    }
    if (trimmedNewName === oldName) {
      setMessage({ type: 'info', text: 'ファイル名は変更されませんでした（同じ名前です）。' });
      return;
    }
    
    // UIで表示されているファイル名から、実際のStorageファイル名（エンコードされた名前）を取得
    const targetFile = sourceFiles.find(file => file.name === oldName);
    if (!targetFile) {
      setMessage({ type: 'error', text: `ファイル「${oldName}」が見つかりません。` });
      return;
    }
    const storageFileName = targetFile.id; // エンコードされたファイル名

    setUploading(true);
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
    setUploading(false);
    console.log('[handleRenameFile] End.');
  };

  return (
    <div className="flex flex-col h-full p-4 space-y-4 bg-card text-card-foreground rounded-lg shadow">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">ソース</h2>
        {/* 右上のアイコンは一旦省略 (例: <PanelRightClose className="h-5 w-5" />) */}
        <Button variant="outline" size="sm" onClick={handleFileTrigger} disabled={uploading || processingFile}>
          <PlusIcon className="mr-2 h-4 w-4" />
          追加
        </Button>
        <Input 
          type="file" 
          ref={fileInputRef} 
          onChange={handleLocalFileChange} 
          className="hidden" 
          disabled={uploading || processingFile}
          accept=".pdf,.doc,.docx,.ppt,.pptx"
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

      {/* File List */}
      <div className="flex-grow overflow-y-auto space-y-1 pr-1">
        {loadingFiles ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="mr-2 h-6 w-6 animate-spin text-muted-foreground" />
            <p className="text-muted-foreground">読み込み中...</p>
          </div>
        ) : sourceFiles.length > 0 ? (
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
                  {/* <DropdownMenuItem onClick={() => console.log('Details:', file.name)}>
                    詳細
                  </DropdownMenuItem> */}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-muted-foreground">
              アップロード済みのファイルはありません。「追加」ボタンからアップロードしてください。
            </p>
          </div>
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

      {(uploading || loadingFiles || processingFile) && (
        <div className="flex items-center justify-center p-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="ml-2 text-muted-foreground">
            {uploading && "Storageへアップロード中..."}
            {loadingFiles && "ファイル一覧を読み込み中..."}
            {processingFile && "サーバーでファイルを処理中..."}
          </span>
        </div>
      )}
    </div>
  );
};

export default SourceManager; 