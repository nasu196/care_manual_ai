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
import { PremiumStatus } from './DeveloperPanel';

interface SourceFile {
  id: string; // Supabase Storage オブジェクトは id を持たないため、name を id として使うか、別途定義が必要
  name: string;
  originalName: string;
  recordId: string; // データベースレコードのID追加
  uploadedAt: string; // アップロード日時を追加
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
  onRecordSelectionChange?: (selectedRecordIds: string[]) => void;
  selectedRecordIds?: string[]; // ★ 追加: 親からのrecordId選択状態
  isMobileView?: boolean;
  premiumStatus?: PremiumStatus; // ★ 追加: プレミアムプランの状態
}

const SourceManager: React.FC<SourceManagerProps> = ({ 
  selectedSourceNames, 
  onSelectionChange, 
  onRecordSelectionChange,
  selectedRecordIds: propSelectedRecordIds = [], // ★ プロパティから受け取る
  isMobileView,
  premiumStatus = { isPremium: false, fileLimit: 3, fileSizeLimit: 30 } // ★ デフォルト値
}) => {
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
  
  // recordIdベースの選択状態を内部で管理（親の状態と同期）
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>(propSelectedRecordIds);
  const [isInitialized, setIsInitialized] = useState(false); // 初期化フラグ
  
  // ★ 参照元データ表示用のstate
  const [isSourceModalOpen, setIsSourceModalOpen] = useState(false);
  const [selectedFileForSource, setSelectedFileForSource] = useState<string>('');
  const [sourceTextData, setSourceTextData] = useState<string>('');
  const [loadingSourceData, setLoadingSourceData] = useState(false);

  // ★ メッセージ設定ヘルパー関数（自動消去機能付き）
  const setMessageWithAutoHide = useCallback((msg: { type: 'success' | 'error' | 'info'; text: string } | null, autoHideDelay: number = 5000) => {
    // 既存のタイマーをクリア
    if (messageTimerRef.current) {
      clearTimeout(messageTimerRef.current);
      messageTimerRef.current = null;
    }
    
    setMessage(msg);
    
    // ★ 全てのメッセージタイプで自動消去（エラーメッセージも含む）
    if (msg) {
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

  // ★ 親からのselectedRecordIdsと内部状態を同期
  useEffect(() => {
    setSelectedRecordIds(propSelectedRecordIds);
  }, [propSelectedRecordIds]);

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

      const apiUrl = `${supabaseUrl}/rest/v1/manuals?select=id,file_name,original_file_name,uploaded_at&order=uploaded_at.desc`;

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

      const files = (data as Array<{id: string, file_name: string, original_file_name: string, uploaded_at: string}>)?.map((item) => ({ 
        name: item.original_file_name || item.file_name, 
        originalName: item.original_file_name || item.file_name,
        id: item.file_name,
        recordId: item.id, // データベースレコードのID追加
        uploadedAt: item.uploaded_at // アップロード日時を追加
      })) || [];
      setSourceFiles(files);

      // ファイルリスト更新時に、存在しないrecordIdを選択状態から除去
      const validRecordIds = files.map(file => file.recordId);
      setSelectedRecordIds(prev => prev.filter(id => validRecordIds.includes(id)));

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

  // 初回のみ親コンポーネントのselectedSourceNamesをselectedRecordIdsに変換
  useEffect(() => {
    if (!isInitialized && sourceFiles.length > 0) {
      // 初回のみ親からの選択状態を反映（重複排除）
      const uniqueSelectedNames = [...new Set(selectedSourceNames)];
      
      const recordIds: string[] = [];
      
      // 各ファイル名について、最初に見つかったレコードのみを選択
      uniqueSelectedNames.forEach(fileName => {
        const file = sourceFiles.find(f => f.name === fileName);
        if (file) {
          recordIds.push(file.recordId);
        }
      });
      
      setSelectedRecordIds(recordIds);
      setIsInitialized(true);
      
      // 親コンポーネントにも通知
      if (recordIds.length > 0) {
        onRecordSelectionChange?.(recordIds);
      }
    }
  }, [selectedSourceNames, sourceFiles, isInitialized, onRecordSelectionChange, selectedRecordIds]);

  // 選択状態を親コンポーネントと同期
  useEffect(() => {
    const allFilesSelected = sourceFiles.length > 0 && sourceFiles.every(file => selectedRecordIds.includes(file.recordId));
    setSelectAll(allFilesSelected);
  }, [selectedRecordIds, sourceFiles]);

  const handleFileTrigger = () => {
    fileInputRef.current?.click();
  };

  const handleLocalFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setMessageWithAutoHide(null);
    if (event.target.files && event.target.files.length > 0) {
      const files = Array.from(event.target.files);
      
      // ★ ファイル制限チェック
      for (const file of files) {
        // ファイルサイズチェック
        const fileSizeMB = file.size / (1024 * 1024);
        if (fileSizeMB > premiumStatus.fileSizeLimit) {
          setMessageWithAutoHide({ 
            type: 'error', 
            text: `ファイル "${file.name}" のサイズ (${fileSizeMB.toFixed(1)}MB) が制限 (${premiumStatus.fileSizeLimit}MB) を超えています。` 
          });
          return;
        }

        // ファイル数制限チェック
        if (sourceFiles.length >= premiumStatus.fileLimit) {
          setMessageWithAutoHide({ 
            type: 'error', 
            text: `ファイル数の制限 (${premiumStatus.fileLimit}ファイル) に達しています。` 
          });
          return;
        }
      }
      
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



      // ★ Supabase Edge Function APIでアップロード（4.5MB制限回避）
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!supabaseUrl) {
        throw new Error('Supabase URL not configured');
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
          if (errorJson.error) {
            errorMessage = errorJson.error;
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

      // Edge Functionからのレスポンスをパース
      const uploadResult = await uploadResponse.json();
      const storagePath = uploadResult.storagePath; // `userId/encodedFileName` 形式のパス
      const recordId = uploadResult.recordId; // 作成されたレコードID

      if (!storagePath || !recordId) {
        console.error('[handleUpload] storagePath or recordId not found in upload-manual API response:', uploadResult);
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

      try {
        // ★ Vercel Functions PDF処理APIを呼び出し
        const requestUrl = '/api/process-pdf';
        const headers = {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        };
        // process-pdf には storagePath と recordId を渡す
        const body = JSON.stringify({ 
          fileName: storagePath, 
          originalFileName, 
          recordId // 特定のレコードを更新するため
        });

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
            responseData = { error: 'PDF処理APIからの空のレスポンス' };
          }
        } catch (parseError) {
          console.error(`[handleUpload] Failed to parse PDF processing API response:`, parseError);
          throw new Error(`PDF処理APIのレスポンス解析に失敗: ${parseError instanceof Error ? parseError.message : '不明なエラー'}`);
        }

        if (!response.ok) {
          console.error('[handleUpload] PDF processing API call failed:', response.status, responseData);
          const errorMessage = responseData?.error || responseData?.message || `PDF処理APIの実行に失敗 (status: ${response.status})`;
          throw new Error(errorMessage);
        }


        updateUploadStatus(uploadId, {
          status: 'completed',
          message: `完了`
        });



        // アップロード成功通知を表示
        setMessageWithAutoHide({ 
          type: 'success', 
          text: `「${uploadResult.originalFileName}」をアップロードしました。` 
        }, 10000); // 10秒間表示

        // アップロード成功後、そのファイルを選択状態にする（重複チェック）
        const uniqueSelectedNames = [...new Set(selectedSourceNames)];
        if (!uniqueSelectedNames.includes(uploadResult.originalFileName)) {
          onSelectionChange([...uniqueSelectedNames, uploadResult.originalFileName]);
        }
        
        // recordIdも選択状態に追加
        const uniqueSelectedRecordIds = [...new Set(selectedRecordIds)];
        if (!uniqueSelectedRecordIds.includes(recordId)) {
          onRecordSelectionChange?.([...uniqueSelectedRecordIds, recordId]);
        }

        // ★ まずファイルリストを更新
        await fetchUploadedFiles();
        
        // 更新フラグは削除され、アップロード後にファイルリストを再取得するのみ

        // 3秒後にキューから削除
        setTimeout(() => {
          removeFromUploadQueue(uploadId);
        }, 3000);

      } catch (funcError: unknown) {
        console.error('Error calling PDF processing API:', funcError);
        let errorMessage = 'PDF処理中に不明なエラーが発生しました。';
        if (funcError instanceof Error) {
          errorMessage = funcError.message;
        }
        updateUploadStatus(uploadId, {
          status: 'error',
          error: errorMessage,
          message: `処理エラー`
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
      // ★ エラーの場合も10秒後にキューから削除
      setTimeout(() => {
        removeFromUploadQueue(uploadId);
      }, 10000);
    }
  };

  const handleSelectAllChange = (checked: boolean) => {
    setSelectAll(checked);
    if (checked) {
      const allRecordIds = sourceFiles.map(file => file.recordId);
      setSelectedRecordIds(allRecordIds);
      // 全選択時もファイル名の重複を除去
      const allFileNames = sourceFiles.map(file => file.name);
      const uniqueFileNames = [...new Set(allFileNames)];
      onSelectionChange(uniqueFileNames);
      onRecordSelectionChange?.(allRecordIds);
    } else {
      setSelectedRecordIds([]);
      onSelectionChange([]);
      onRecordSelectionChange?.([]);
    }
  };

  const handleSourceSelectionChange = (recordId: string, checked: boolean) => {
    let newSelectedIds: string[];
    if (checked) {
      newSelectedIds = [...selectedRecordIds, recordId];
    } else {
      newSelectedIds = selectedRecordIds.filter(id => id !== recordId);
    }
    setSelectedRecordIds(newSelectedIds);
    
    // 親コンポーネントに新しい選択状態を通知（重複除去）
    const newSelectedNames = sourceFiles
      .filter(file => newSelectedIds.includes(file.recordId))
      .map(file => file.name);
    // 重複除去して通知
    const uniqueSelectedNames = [...new Set(newSelectedNames)];
    onSelectionChange(uniqueSelectedNames);
    onRecordSelectionChange?.(newSelectedIds);
  };
  
  const handleDeleteFile = async (recordId: string) => {
    // レコードIDからファイル情報を取得
    const targetFile = sourceFiles.find(file => file.recordId === recordId);
    if (!targetFile) {
      setMessageWithAutoHide({ type: 'error', text: `ファイルが見つかりません。` });
      return;
    }
    
    const fileName = targetFile.name;
    const storageFileName = targetFile.id; // エンコードされたファイル名

    // アップロード中のファイルは削除できない
    const uploadingFile = uploadQueue.find(item => item.originalFileName === fileName);
    if (uploadingFile) {
      setMessageWithAutoHide({ type: 'error', text: `ファイル「${fileName}」はアップロード中のため削除できません。` });
      return;
    }

    if (!window.confirm(`ファイル「${fileName}」を本当に削除しますか？`)) {
      return;
    }

    
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


      
            // ★ Edge Function経由でファイル削除（recordIDベース）
      const deleteFunctionUrl = `${supabaseUrl}/functions/v1/delete-file-function`;
      const deleteResponse = await fetch(deleteFunctionUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          recordId: recordId,        // 削除対象のレコードID
          fileName: storageFileName  // ストレージファイル名（互換性のため残す）
        }),
      });

      if (!deleteResponse.ok) {
        const errorData = await deleteResponse.json().catch(() => ({ message: deleteResponse.statusText }));
        console.error('Delete function error:', errorData);
        setMessageWithAutoHide({ type: 'error', text: `ファイル「${fileName}」の削除に失敗しました: ${errorData.message || deleteResponse.statusText}` });
        return;
      }


      // Fetch updated list and update UI
      await fetchUploadedFiles();
      
      // 選択状態から削除されたファイルを除外
      const updatedSelectedIds = selectedRecordIds.filter(id => id !== recordId);
      setSelectedRecordIds(updatedSelectedIds);
      
      // 親コンポーネントに新しい選択状態を通知（重複除去）
      const newSelectedNames = sourceFiles
        .filter(file => updatedSelectedIds.includes(file.recordId))
        .map(file => file.name);
      const uniqueSelectedNames = [...new Set(newSelectedNames)];
      onSelectionChange(uniqueSelectedNames);
      onRecordSelectionChange?.(updatedSelectedIds);
      
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

  // リネーム機能
  const handleRenameFile = async (recordId: string, newName: string) => {
    const targetFile = sourceFiles.find(file => file.recordId === recordId);
    if (!targetFile) {
      setMessageWithAutoHide({ type: 'error', text: `ファイルが見つかりません。` });
      return;
    }

    const oldName = targetFile.originalName;
    
    if (newName.trim() === '') {
      setMessageWithAutoHide({ type: 'error', text: 'ファイル名を空にすることはできません。' });
      return;
    }

    if (newName === oldName) {
      return; // 変更なし
    }

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

      // original_file_nameを更新
      const response = await fetch(`${supabaseUrl}/rest/v1/manuals?id=eq.${recordId}`, {
        method: 'PATCH',
        headers: {
          'apikey': supabaseAnonKey,
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          original_file_name: newName,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: response.statusText }));
        console.error('Rename error:', errorData);
        throw new Error(errorData.message || 'ファイル名の変更に失敗しました。');
      }

      // ファイルリストを更新
      await fetchUploadedFiles();

      setMessageWithAutoHide({ 
        type: 'success', 
        text: `ファイル名を「${oldName}」から「${newName}」に変更しました。` 
      });

    } catch (err: unknown) {
      console.error('Error renaming file:', err);
      let errorMessage = 'ファイル名の変更中に予期せぬエラーが発生しました。';
      if (err instanceof Error) {
        errorMessage = err.message;
      }
      setMessageWithAutoHide({ type: 'error', text: errorMessage });
    }
  };

  // ★ 参照元データ取得関数
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
      const recordId = targetFile.recordId; // データベースレコードのID

      // manual_chunksからテキストデータを直接取得（recordIdを使用）
      const chunksApiUrl = `${supabaseUrl}/rest/v1/manual_chunks?select=chunk_text,chunk_order&manual_id=eq.${recordId}&order=chunk_order.asc`;
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
      setMessageWithAutoHide({ type: 'error', text: '参照元データ取得中に予期せぬエラーが発生しました。' });
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
      <div className="px-3 md:px-4 pt-2 md:pt-4 pb-1.5 md:pb-2 border-b">
        <div className="flex justify-between items-center mb-1.5 md:mb-2">
          <h2 className="text-base md:text-lg font-semibold text-green-700">参照元の管理</h2>
          <Button onClick={handleFileTrigger} size="icon" variant="outline">
            <PlusIcon className="h-5 w-5" />
            <span className="sr-only">ファイル追加</span>
          </Button>
        </div>
        
        {/* ★ プレミアム制限表示 */}
        <div className="flex justify-between items-center text-xs text-gray-600">
          <span>
            ファイル数: {sourceFiles.length} / {premiumStatus.fileLimit === Infinity ? '無制限' : premiumStatus.fileLimit}
          </span>
          <span>
            サイズ制限: {premiumStatus.fileSizeLimit}MB
          </span>
        </div>
        
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
              全ての参照元を選択/解除
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
          <h3 className="text-md font-semibold text-green-700">アップロード中のファイル:</h3>
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
            <p className="font-semibold">利用可能な参照元ファイルがありません。</p>
            <p className="text-sm">「ファイル追加」ボタンからアップロードしてください。</p>
          </div>
        )}
        {!loadingFiles && sourceFiles.map((file) => (
          <div
            key={file.recordId}
            className={`flex items-center justify-between p-3 rounded-md transition-colors
                        ${selectedRecordIds.includes(file.recordId) ? "bg-primary/10" : "bg-gray-50 hover:bg-gray-100"}
                        `}
          >
            <div className="flex items-center space-x-3 flex-grow min-w-0">
              <Checkbox
                id={`source-${file.recordId}`}
                checked={selectedRecordIds.includes(file.recordId)}
                onCheckedChange={(checked) => handleSourceSelectionChange(file.recordId, !!checked)}
                className={isMobileView && selectedRecordIds.includes(file.recordId) ? "text-primary focus:ring-primary" : ""}
              />
              <FileText className={`h-5 w-5 ${selectedRecordIds.includes(file.recordId) ? "text-primary" : "text-gray-500"}`} />
              <div className="flex items-center gap-2 flex-grow min-w-0">
                <div className="flex flex-col min-w-0 flex-grow">
                  <label 
                    htmlFor={`source-${file.recordId}`} 
                    className="text-base md:text-sm font-medium truncate cursor-pointer"
                    title={file.originalName || file.name}
                  >
                    {file.originalName || file.name}
                  </label>
                  <span className="text-xs text-gray-500 truncate">
                    {new Date(file.uploadedAt).toLocaleDateString('ja-JP', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                </div>
              </div>
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
                  参照元元データを表示
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    const newName = prompt('新しいファイル名を入力してください:', file.originalName || file.name);
                    if (newName !== null) {
                      handleRenameFile(file.recordId, newName);
                    }
                  }}
                >
                  名前を変更
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleDeleteFile(file.recordId)}
                  className="text-red-600 hover:!bg-red-50 hover:!text-red-700"
                >
                  削除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
      </div>

      {/* 参照元データ表示モーダル */}
      <Dialog open={isSourceModalOpen} onOpenChange={setIsSourceModalOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>参照元元データ - {selectedFileForSource}</DialogTitle>
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