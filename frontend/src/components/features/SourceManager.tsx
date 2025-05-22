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
        .select('file_name')
        .order('file_name', { ascending: true });

      console.log('[fetchUploadedFiles] select() from manuals table returned. Error:', error, 'Raw data:', data);

      if (error) {
        console.error('Error fetching file list from manuals table:', error);
        setMessage({ type: 'error', text: `ファイル一覧の取得に失敗しました: ${error.message}` });
        setSourceFiles([]);
      } else {
        const files = data?.map(item => ({ name: item.file_name, id: item.file_name })) || [];
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

    const fileName = file.name;
    const allowedCharsRegex = /^[\w\-\.]+$/;
    if (!allowedCharsRegex.test(fileName)) {
      setMessage({
        type: 'error',
        text: `ファイル名「${fileName}」には使用できない文字が含まれています。半角の英数字、ハイフン(-)、アンダースコア(_)、ピリオド(.)のみ使用できます。アップロードを中止しました。`
      });
      setSelectedLocalFile(null);
      return;
    }

    setUploading(true);
    setProcessingFile(false);
    setMessage({ type: 'info', text: `ファイル「${fileName}」のアップロードを開始します...` });
    console.log(`[handleUpload] Uploading file: ${fileName}, size: ${file.size}, type: ${file.type}`);

    try {
      const bucketName = 'manuals';
      const { error: uploadError } = await supabase.storage
        .from(bucketName)
        .upload(`${fileName}`, file, {
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
      let currentMessage = `ファイル「${file.name}」が正常にアップロードされました。`;
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
        console.log(`[handleUpload] Calling Edge Function: ${finalFunctionUrl} for file: ${file.name}`);

        const response = await fetch(finalFunctionUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: file.name }),
        });

        const responseData = await response.json();
        if (!response.ok) {
          console.error('[handleUpload] Edge Function call failed:', response.status, responseData);
          throw new Error(responseData.error || `Edge Functionの実行に失敗 (status: ${response.status})`);
        }

        console.log('[handleUpload] Edge Function call successful:', responseData);
        setMessage({
          type: 'success',
          text: `ファイル「${file.name}」のアップロードと処理が全て完了しました。`,
        });

        // ★ アップロード成功後、そのファイルを選択状態にする
        if (!selectedSourceNames.includes(file.name)) {
          onSelectionChange([...selectedSourceNames, file.name]);
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
          text: `ファイル「${file.name}」の処理中にエラー: ${errorMessage}`,
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
    setUploading(true); // Consider renaming this state if it's used for more than just uploads
    setMessage({ type: 'info', text: `ファイル「${fileName}」を削除中です...` });
    try {
      // Step 1: Delete from Storage
      const { error: storageError } = await supabase.storage.from('manuals').remove([fileName]);

      if (storageError) {
        console.error('Storage delete error:', storageError);
        setMessage({ type: 'error', text: `ストレージからのファイル「${fileName}」の削除に失敗しました: ${storageError.message}` });
        setUploading(false);
        return;
      }

      console.log(`File「${fileName}」deleted from storage.`);

      // Step 2: Delete from manuals table
      const { error: tableError } = await supabase
        .from('manuals')
        .delete()
        .eq('file_name', fileName);

      if (tableError) {
        console.error('Table delete error:', tableError);
        // Storageからは削除成功したがテーブルからは失敗した場合のリカバリは難しい。
        // ユーザーにはエラーを通知し、手動での確認を促すか、あるいはより複雑な補償トランザクションを検討する必要がある。
        // ここでは、エラーメッセージに両方の状況を含めることを検討する。
        setMessage({ type: 'error', text: `DBからのファイル「${fileName}」のレコード削除に失敗しました: ${tableError.message}。ストレージからは削除済みです。` });
        // この場合でもリストは再読み込みして、テーブルの現状を反映する
        await fetchUploadedFiles();
        setUploading(false);
        return;
      }
      
      console.log(`Record for「${fileName}」deleted from manuals table.`);

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
    const allowedCharsRegex = /^[\w\-\.]+$/;
    if (!allowedCharsRegex.test(trimmedNewName)) {
      setMessage({
        type: 'error',
        text: 'ファイル名には半角の英数字、ハイフン(-)、アンダースコア(_)、ピリオド(.)のみ使用できます。'
      });
      return;
    }
    setUploading(true);
    setMessage({ type: 'info', text: `ファイル「${oldName}」を「${trimmedNewName}」に変更しています...` });
    console.log(`[handleRenameFile] Calling supabase.storage.from('manuals').move('${oldName}', '${trimmedNewName}')`);
    try {
      const { data, error } = await supabase.storage.from('manuals').move(oldName, trimmedNewName);
      console.log('[handleRenameFile] Supabase move call returned. Error:', JSON.stringify(error, null, 2), 'Data:', JSON.stringify(data, null, 2));
      if (error) {
        console.error('[handleRenameFile] Detailed rename error object from Supabase:', error);
        setMessage({ type: 'error', text: `ファイル名の変更に失敗しました: ${error.message}` });
      } else {
        setMessage({ type: 'success', text: `ファイル「${oldName}」を「${trimmedNewName}」に変更しました。` });
        await fetchUploadedFiles();
        
        // ★ 選択状態の更新ロジック修正
        const newSelectedNames = selectedSourceNames.map(name => 
          name === oldName ? trimmedNewName : name
        );
        if (JSON.stringify(newSelectedNames) !== JSON.stringify(selectedSourceNames)) {
          onSelectionChange(newSelectedNames);
        }
        // setSelectedSourceNames(prev =>
        //   prev.map(name => name === oldName ? trimmedNewName : name)
        // );
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