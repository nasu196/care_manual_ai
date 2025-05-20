import React, { useState, ChangeEvent, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Terminal, CloudUpload, FileText, AlertCircle, CheckCircle2, Files, Loader2, RefreshCcw } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient'; // Supabaseクライアントをインポート

const SourceManager: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]); // アップロード済みファイルリスト
  const [loadingFiles, setLoadingFiles] = useState<boolean>(false); // ファイルリスト取得中のローディング

  // Supabase Storageからアップロード済みファイル一覧を取得する関数
  const fetchUploadedFiles = async () => {
    console.log('[fetchUploadedFiles] Fetching files from BUCKET ROOT...'); // ログ変更
    setLoadingFiles(true);
    setMessage(null); // 古いメッセージをクリア
    try {
      const { data, error } = await supabase.storage
        .from('manuals')
        .list('', { // ★★★ パスを 'public' から '' (ルート) に変更 ★★★
          limit: 100,
          offset: 0,
          sortBy: { column: 'name', order: 'asc' },
        });

      console.log('[fetchUploadedFiles] Supabase response (from root):', { data, error });

      if (error) {
        console.error('Error fetching uploaded files from root:', error);
        setMessage({ type: 'error', text: `ファイル一覧の取得に失敗しました(ルート): ${error.message}` });
        setUploadedFiles([]);
      } else {
        // dataにはファイルとフォルダが含まれる。今回は名前だけ表示するので、そのまま表示。
        // 必要であれば、file.type や file.metadata でファイルかフォルダか区別可能
        const itemNames = data?.map(item => item.name) || [];
        console.log('[fetchUploadedFiles] Fetched item names (from root):', itemNames);
        setUploadedFiles(itemNames);
      }
    } catch (err) {
      console.error('Unexpected error fetching files:', err);
      setMessage({ type: 'error', text: 'ファイル一覧取得中に予期せぬエラーが発生しました。' });
      setUploadedFiles([]);
    } finally {
      setLoadingFiles(false);
    }
  };

  // コンポーネントマウント時とアップロード成功時にファイル一覧を再取得
  useEffect(() => {
    console.log('[useEffect] Initial fetch or message type success.'); // ★デバッグログ追加
    fetchUploadedFiles();
  }, [message?.type === 'success']); // message.typeが'success'の時だけ再実行 (アップロード成功時)

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setMessage(null);
    if (event.target.files && event.target.files.length > 0) {
      setSelectedFile(event.target.files[0]);
    } else {
      setSelectedFile(null);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setMessage({ type: 'error', text: 'アップロードするファイルを選択してください。' });
      return;
    }

    setUploading(true);
    setMessage({ type: 'info', text: 'アップロードを開始します...' });

    try {
      // ファイル名にタイムスタンプを付加して一意性を高める (オプション)
      // const fileName = `${Date.now()}_${selectedFile.name}`;
      const fileName = selectedFile.name; // まずは元のファイル名を使用

      // Supabase Storageのバケット名を指定します。事前に作成しておく必要があります。
      const bucketName = 'manuals'; // 仮のバケット名

      const { data, error } = await supabase.storage
        .from(bucketName)
        .upload(`public/${fileName}`, selectedFile, { // public/ フォルダ配下に保存
          cacheControl: '3600',
          upsert: false, // 同名ファイルが存在する場合、上書きしない (trueで上書き)
        });

      if (error) {
        console.error('Upload error:', error);
        setMessage({ type: 'error', text: `アップロードに失敗しました: ${error.message}` });
      } else {
        setMessage({
          type: 'success',
          text: `ファイル「${selectedFile.name}」が正常にアップロードされました。パス: ${data?.path}`,
        });
        setSelectedFile(null); // アップロード成功後、選択を解除
        // fetchUploadedFiles(); // アップロード成功時に直接呼ぶ代わりにuseEffectの依存配列で対応
      }
    } catch (err) {
      console.error('Unexpected error during upload:', err);
      setMessage({ type: 'error', text: '予期せぬエラーが発生しました。コンソールを確認してください。' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="p-6 bg-gray-50 min-h-full">
      <h2 className="text-2xl font-semibold text-gray-800 mb-6">ソース管理</h2>

      <div className="bg-white p-6 rounded-lg shadow-md mb-6">
        <h3 className="text-lg font-medium text-gray-700 mb-4 flex items-center">
          <CloudUpload className="mr-2 h-5 w-5 text-blue-500" />
          マニュアルファイルアップロード
        </h3>
        <div className="space-y-4">
          <div>
            <label htmlFor="file-upload" className="block text-sm font-medium text-gray-700 mb-1">
              ファイルを選択してください (PDF, TXT, DOCX など)
            </label>
            <Input
              id="file-upload"
              type="file"
              onChange={handleFileChange}
              className="file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              disabled={uploading}
            />
          </div>

          {selectedFile && (
            <div className="p-3 bg-gray-100 rounded-md text-sm text-gray-700 flex items-center">
              <FileText className="mr-2 h-4 w-4 text-gray-500" />
              選択中のファイル: <strong>{selectedFile.name}</strong> ({(selectedFile.size / 1024).toFixed(2)} KB)
            </div>
          )}

          <Button onClick={handleUpload} disabled={!selectedFile || uploading} className="w-full sm:w-auto">
            {uploading ? (
              <>
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                アップロード中...
              </>
            ) : (
              'アップロード'
            )}
          </Button>
        </div>
      </div>

      {message && (
        <Alert variant={message.type === 'error' ? "destructive" : "default"} className={
          message.type === 'success' ? 'bg-green-50 border-green-300 text-green-800' :
          message.type === 'error' ? 'bg-red-50 border-red-300 text-red-800' :
          'bg-blue-50 border-blue-300 text-blue-800'
        }>
          {message.type === 'success' && <CheckCircle2 className="h-4 w-4" />}
          {message.type === 'error' && <AlertCircle className="h-4 w-4" />}
          {message.type === 'info' && <Terminal className="h-4 w-4" />} {/* InfoアイコンがないためTerminalで代用 */}
          <AlertTitle>
            {message.type === 'success' ? '成功' : message.type === 'error' ? 'エラー' : '情報'}
          </AlertTitle>
          <AlertDescription>
            {message.text}
          </AlertDescription>
        </Alert>
      )}

      {/* アップロード済みファイル一覧表示機能 */}
      <div className="mt-8 bg-white p-6 rounded-lg shadow-md">
        <h3 className="text-lg font-medium text-gray-700 mb-4 flex items-center">
          <Files className="mr-2 h-5 w-5 text-green-500" />
          アップロード済みファイル (Supabase Storage)
        </h3>
        {loadingFiles ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="mr-2 h-6 w-6 animate-spin text-blue-500" />
            <p className="text-gray-600">ファイル一覧を読み込み中...</p>
          </div>
        ) : uploadedFiles.length > 0 ? (
          <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700 max-h-60 overflow-y-auto">
            {uploadedFiles.map((fileName, index) => (
              <li key={index} className="hover:bg-gray-100 p-1 rounded-md">
                <FileText className="inline-block mr-2 h-4 w-4 text-gray-400" />
                {fileName}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">アップロード済みのファイルはありません。</p>
        )}
        <Button onClick={fetchUploadedFiles} disabled={loadingFiles} variant="outline" size="sm" className="mt-4">
          {loadingFiles ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCcw className="mr-2 h-4 w-4" />
          )}
          一覧を再取得
        </Button>
      </div>
    </div>
  );
};

export default SourceManager; 