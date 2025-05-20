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

const SourceManager: React.FC = () => {
  const [selectedLocalFile, setSelectedLocalFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  
  const [sourceFiles, setSourceFiles] = useState<SourceFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState<boolean>(false);

  const [selectAll, setSelectAll] = useState(false);
  const [selectedSourceNames, setSelectedSourceNames] = useState<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchUploadedFiles = async () => {
    setLoadingFiles(true);
    console.log('[fetchUploadedFiles] Fetching file list...');
    try {
      const { data, error } = await supabase.storage
        .from('manuals')
        .list('', { 
          limit: 100,
          offset: 0,
          sortBy: { column: 'name', order: 'asc' },
        });
      console.log('[fetchUploadedFiles] list() returned. Error:', error, 'Raw data:', data);

      if (error) {
        console.error('Error fetching uploaded files from root:', error);
        setMessage({ type: 'error', text: `ファイル一覧の取得に失敗しました: ${error.message}` });
        setSourceFiles([]);
      } else {
        const files = data?.filter(item => item.id !== null).map(item => ({ name: item.name, id: item.name })) || [];
        console.log('[fetchUploadedFiles] Mapped files for UI:', files);
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
      setSelectedLocalFile(event.target.files[0]);
      // 自動アップロードするか、別途アップロードボタンを設けるか検討。今回は選択即アップロードの準備。
      // すぐにアップロード処理を呼び出す例:
      handleUpload(event.target.files[0]); 
      event.target.value = ''; // 同じファイルを選択できるようにリセット
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

    setUploading(true);
    setMessage({ type: 'info', text: `ファイル「${file.name}」のアップロードを開始します...` });
    console.log(`[handleUpload] Uploading file: ${file.name}, size: ${file.size}, type: ${file.type}`);

    try {
      const fileName = file.name;
      const bucketName = 'manuals';

      console.log(`[handleUpload] Calling supabase.storage.from('${bucketName}').upload('${fileName}')`);
      const { error } = await supabase.storage
        .from(bucketName)
        .upload(`${fileName}`, file, {
          cacheControl: '3600',
          upsert: true,
        });
      console.log('[handleUpload] Supabase upload call returned. Error:', error);

      if (error) {
        console.error('[handleUpload] Upload error details:', error);
        setMessage({ type: 'error', text: `アップロードに失敗しました: ${error.message}` });
      } else {
        console.log('[handleUpload] Upload successful.');
        setMessage({
          type: 'success',
          text: `ファイル「${file.name}」が正常にアップロードされました。`,
        });
        setSelectedLocalFile(null); 
        await fetchUploadedFiles();
      }
    } catch (err) {
      console.error('[handleUpload] Unexpected error during upload catch block:', err);
      setMessage({ type: 'error', text: '予期せぬエラーが発生しました。' });
    } finally {
      setUploading(false);
      console.log('[handleUpload] End.');
    }
  };

  const handleSelectAllChange = (checked: boolean) => {
    setSelectAll(checked);
    if (checked) {
      setSelectedSourceNames(sourceFiles.map(file => file.name));
    } else {
      setSelectedSourceNames([]);
    }
  };

  const handleSourceSelectionChange = (fileName: string, checked: boolean) => {
    if (checked) {
      setSelectedSourceNames(prev => [...prev, fileName]);
    } else {
      setSelectedSourceNames(prev => prev.filter(name => name !== fileName));
    }
  };
  
  // selectedSourceNames が更新されたら selectAll の状態を更新
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
    setUploading(true);
    // メッセージは処理完了後に設定するため、ここではクリアまたは変更しない
    // setMessage({ type: 'info', text: `ファイル「${fileName}」を削除しています...` });
    try {
      const { error } = await supabase.storage.from('manuals').remove([fileName]);
      if (error) {
        console.error('Delete error:', error);
        setMessage({ type: 'error', text: `ファイル「${fileName}」の削除に失敗しました: ${error.message}` });
      } else {
        // 先にファイル一覧を確実に更新する
        await fetchUploadedFiles(); // ファイル一覧を再取得 (await を追加)
        setSelectedSourceNames(prev => prev.filter(name => name !== fileName)); // 選択状態からも削除
        setMessage({ type: 'success', text: `ファイル「${fileName}」を削除しました。` }); // 更新後にメッセージ表示
      }
    } catch (err) {
      console.error('Unexpected error during delete:', err);
      setMessage({ type: 'error', text: 'ファイル削除中に予期せぬエラーが発生しました。' });
    }
    setUploading(false);
  };

  const handleRenameFile = async (oldName: string) => {
    const newName = window.prompt(`ファイル「${oldName}」の新しい名前を入力してください。`, oldName);
    if (newName && newName !== oldName) {
      // setMessage({ type: 'info', text: `ファイル「${oldName}」を「${newName}」に変更しています...` });
      // setUploading(true);
      // try {
      //   const { error } = await supabase.storage.from('manuals').move(oldName, newName);
      //   if (error) {
      //     console.error('Rename error:', error);
      //     setMessage({ type: 'error', text: `ファイル名の変更に失敗しました: ${error.message}` });
      //   } else {
      //     setMessage({ type: 'success', text: `ファイル「${oldName}」を「${newName}」に変更しました。` });
      //     fetchUploadedFiles();
      //     // 選択状態も更新 (必要であれば)
      //     setSelectedSourceNames(prev => prev.map(name => name === oldName ? newName : name)); 
      //   }
      // } catch (err) {
      //   console.error('Unexpected error during rename:', err);
      //   setMessage({ type: 'error', text: 'ファイル名変更中に予期せぬエラーが発生しました。' });
      // } 
      // setUploading(false);
      console.log(`Rename trigger: ${oldName} to ${newName}`);
      alert(`「名前を変更」機能は現在開発中です。\n旧ファイル名: ${oldName}\n新ファイル名: ${newName}`);
    } else if (newName === oldName) {
      setMessage({ type: 'info', text: 'ファイル名は変更されませんでした。' });
    } else {
      setMessage({ type: 'info', text: 'ファイル名の変更がキャンセルされました。' });
    }
  };

  return (
    <div className="flex flex-col h-full p-4 space-y-4 bg-card text-card-foreground rounded-lg shadow">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">ソース</h2>
        {/* 右上のアイコンは一旦省略 (例: <PanelRightClose className="h-5 w-5" />) */}
        <Button variant="outline" size="sm" onClick={handleFileTrigger} disabled={uploading}>
          <PlusIcon className="mr-2 h-4 w-4" />
          追加
        </Button>
        <Input 
          type="file" 
          ref={fileInputRef} 
          onChange={handleLocalFileChange} 
          className="hidden" 
          disabled={uploading}
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
    </div>
  );
};

export default SourceManager; 