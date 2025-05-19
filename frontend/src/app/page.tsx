'use client'; // このページがクライアントコンポーネントであることを示す

import AppLayout from '@/components/layout/AppLayout';
import ChatInterfaceMain from '@/components/ChatInterfaceMain'; // 作成したコンポーネントをインポート
// import SourcePanel from '@/components/placeholders/SourcePanel'; // 必要に応じて
// import MemoPanel from '@/components/placeholders/MemoPanel';   // 必要に応じて

export default function HomePage() { // 関数名を HomePage に変更 (または ChatPage のままも可)
  return (
    <AppLayout
      // sourceSlot={<SourcePanel />} // 左パネルに何か表示する場合はコメント解除
      chatSlot={<ChatInterfaceMain />}
      // memoSlot={<MemoPanel />}    // 右パネルに何か表示する場合はコメント解除
    />
  );
}
