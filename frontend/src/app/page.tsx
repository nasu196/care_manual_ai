'use client'; // このページがクライアントコンポーネントであることを示す

import { useState, useEffect } from 'react'; // ★ useEffect をインポート
import AppLayout from '@/components/layout/AppLayout';
import ChatInterfaceMain from '@/components/ChatInterfaceMain'; // 作成したコンポーネントをインポート
import SourceManager from '@/components/features/SourceManager'; // ★ SourceManager をインポート
// import SourcePanel from '@/components/placeholders/SourcePanel'; // 必要に応じて
// import MemoPanel from '@/components/placeholders/MemoPanel';   // 必要に応じて

const LOCAL_STORAGE_KEY_SELECTED_SOURCES = 'careManualAi_selectedSourceNames'; // ★ localStorageのキー

export default function HomePage() { // 関数名を HomePage に変更 (または ChatPage のままも可)
  const [selectedSourceNames, setSelectedSourceNames] = useState<string[]>([]); // ★ 初期値は空配列

  // ★ コンポーネントマウント時にlocalStorageから選択状態を読み込む
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedSelection = localStorage.getItem(LOCAL_STORAGE_KEY_SELECTED_SOURCES);
      if (storedSelection) {
        try {
          const parsedSelection = JSON.parse(storedSelection);
          if (Array.isArray(parsedSelection) && parsedSelection.every(item => typeof item === 'string')) {
            setSelectedSourceNames(parsedSelection);
          }
        } catch (error) {
          console.error('Failed to parse selectedSourceNames from localStorage:', error);
          localStorage.removeItem(LOCAL_STORAGE_KEY_SELECTED_SOURCES); // 不正な値は削除
        }
      }
    }
  }, []); // 空の依存配列でマウント時にのみ実行

  // ★ selectedSourceNamesが変更されたらlocalStorageに保存する
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(LOCAL_STORAGE_KEY_SELECTED_SOURCES, JSON.stringify(selectedSourceNames));
    }
  }, [selectedSourceNames]); // selectedSourceNamesが変更されるたびに実行

  // ★ SourceManager側で選択状態が変更されたときに呼び出される関数
  const handleSourceSelectionChange = (newSelectedSourceNames: string[]) => {
    setSelectedSourceNames(newSelectedSourceNames);
  };

  return (
    <AppLayout
      sourceSlot={ // ★ sourceSlot に SourceManager を明示的に指定
        <SourceManager 
          selectedSourceNames={selectedSourceNames} 
          onSelectionChange={handleSourceSelectionChange} // ★ props名をSourceManagerの実装に合わせる
        />
      }
      chatSlot={<ChatInterfaceMain selectedSourceNames={selectedSourceNames} />} // ★ ChatInterfaceMain に選択ソースを渡す
      // memoSlot={<MemoPanel />}    // 右パネルに何か表示する場合はコメント解除
    />
  );
}
