import React, { useState, useEffect, ReactNode } from 'react';
// import SourcePanel from '@/components/placeholders/SourcePanel'; // Remove if SourceManager is the new default
import SourceManager from '@/components/features/SourceManager'; // パスを修正
import MemoStudio from '@/components/admin/MemoStudio';
import TopHeader from './TopHeader'; // TopHeaderをインポート
import { useMemoStore } from '@/store/memoStore'; // ★ memoStoreをインポート
import { useSwipeable } from 'react-swipeable'; // ★ インポート
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"; // ★ インポート

interface AppLayoutProps {
  sourceSlot?: ReactNode;
  chatSlot: ReactNode; // 中央のチャットは必須とする
  memoSlot?: ReactNode;
  // headerTitle?: string; // 必要であればタイトルをpropsで渡せるようにする
}

const MOBILE_BREAKPOINT = 768; // Tailwindのmdブレークポイント (768px)
const PANELS = ['source', 'chat', 'memo'] as const; // ★ パネルの順番を定義
const PANELS_NO_EDIT = ['chat', 'memo'] as const; // ★ 編集権限なしの場合のパネル
type PanelType = 'source' | 'chat' | 'memo';

const AppLayout = ({ sourceSlot, chatSlot, memoSlot }: AppLayoutProps) => {
  // const title = headerTitle || '持続化補助金＜創業型＞公募要領'; // タイトルの設定
  const title = 'Care Manual AI'; // 固定タイトルに変更（一時的）

  // ★ メモ表示状態を取得
  const isMemoViewExpanded = useMemoStore((state) => state.isMemoViewExpanded);
  const isAnyModalOpen = useMemoStore((state) => state.isAnyModalOpen); // ★ 追加
  // ★ 編集権限を取得
  const hasEditPermission = useMemoStore((state) => state.hasEditPermission);

  const [isMobileView, setIsMobileView] = useState(false);
  const [activeMobilePanel, setActiveMobilePanel] = useState<PanelType>('chat');
  
  const [currentPanelWidth, setCurrentPanelWidth] = useState(0); // ★ 現在のパネル幅を保持するstate
  const [translateX, setTranslateX] = useState(0); // ★ 初期値を0に変更

  // 現在有効なパネルリストを取得
  const currentPanels = hasEditPermission ? PANELS : PANELS_NO_EDIT;

  // 編集権限変更時にアクティブパネルが無効になった場合の処理
  useEffect(() => {
    const currentPanelsList = Array.from(currentPanels);
    if (!currentPanelsList.includes(activeMobilePanel)) {
      setActiveMobilePanel('chat');
    }
  }, [hasEditPermission, currentPanels, activeMobilePanel]);



  useEffect(() => {
    const checkMobileView = () => {
      const mobile = window.innerWidth < MOBILE_BREAKPOINT;
      setIsMobileView(mobile);
      const currentWidth = window.innerWidth; // 現在のウィンドウ幅を取得
      setCurrentPanelWidth(currentWidth); // パネル幅stateを更新

      const currentPanelsList = Array.from(currentPanels);
      const newIndex = currentPanelsList.indexOf(activeMobilePanel);
      if (mobile) {
        setTranslateX(newIndex * -currentWidth);
      } else {
        setTranslateX(newIndex * -currentWidth); // PC表示でもtranslateXを計算（スライドには使われないが整合性のため）
      }
    };
    checkMobileView();
    window.addEventListener('resize', checkMobileView);
    return () => window.removeEventListener('resize', checkMobileView);
  }, [activeMobilePanel, currentPanels]);

  useEffect(() => {
    if (isMobileView) {
      if (currentPanelWidth > 0) { // currentPanelWidthが設定されてから計算
        const currentPanelsList = Array.from(currentPanels);
        const newIndex = currentPanelsList.indexOf(activeMobilePanel);
        const newTranslateX = newIndex * -currentPanelWidth;
        if (!isAnyModalOpen) { // モーダル非表示時のみtranslateXを更新
          setTranslateX(newTranslateX);
        }
      }
    } else {
      // PC表示のロジック (モーダル影響なし)
      if (currentPanelWidth > 0) { 
        const currentPanelsList = Array.from(currentPanels);
        const newIndex = currentPanelsList.indexOf(activeMobilePanel);
        setTranslateX(newIndex * -currentPanelWidth); 
      }
    }
  }, [activeMobilePanel, isMobileView, currentPanelWidth, currentPanels, isAnyModalOpen]); // isAnyModalOpenを依存配列に追加

  // TabsのonValueChangeで直接activeMobilePanelを更新するため、この関数は不要
  // const handleTabSelect = (panel: PanelType) => {
  //   setActiveMobilePanel(panel);
  // };

  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => {
      const currentPanelsList = Array.from(currentPanels);
      const currentIndex = currentPanelsList.indexOf(activeMobilePanel);
      if (currentIndex < currentPanelsList.length - 1) {
        setActiveMobilePanel(currentPanelsList[currentIndex + 1] as PanelType);
      }
    },
    onSwipedRight: () => {
      const currentPanelsList = Array.from(currentPanels);
      const currentIndex = currentPanelsList.indexOf(activeMobilePanel);
      if (currentIndex > 0) {
        setActiveMobilePanel(currentPanelsList[currentIndex - 1] as PanelType);
      }
    },
    trackMouse: true, // マウスでのスワイプも有効にする場合
    preventScrollOnSwipe: true, // スワイプ中の縦スクロールを防止
  });



  if (isMobileView) {
    return (
      <div className="flex flex-col h-screen bg-muted/40 overflow-hidden">
        <TopHeader title={title} />
        
        <Tabs 
          value={activeMobilePanel} 
          onValueChange={(value) => setActiveMobilePanel(value as PanelType)} 
          className="w-full bg-white border-b"
        >
          <TabsList className={`grid w-full h-12 rounded-none bg-white ${hasEditPermission ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {currentPanels.map(panel => (
              <TabsTrigger 
                key={panel} 
                value={panel}
                className="h-full text-base font-medium rounded-none border-transparent 
                           text-muted-foreground  
                           data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none
                           hover:bg-accent hover:text-accent-foreground 
                           focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1"
              >
                {panel === 'source' ? 'ソース' : panel === 'chat' ? 'AIチャット' : 'メモ管理'}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/* スワイプとアニメーションのためのコンテナ */}
        <div className="flex-grow relative overflow-hidden" {...swipeHandlers}>
          <div 
            className={`flex h-full absolute top-0 left-0 ${hasEditPermission ? 'w-[300%]' : 'w-[200%]'}`} // 編集権限に応じて幅を変更
            style={{
              transform: `translateX(${translateX}px)`,
              transition: isAnyModalOpen && isMobileView ? 'none' : 'transform 0.3s ease-in-out',
            }}
          >
            {hasEditPermission && (
              <div className="w-1/3 h-full overflow-auto bg-white">
                {sourceSlot || <SourceManager selectedSourceNames={[]} onSelectionChange={() => {}} isMobileView={isMobileView} />}
              </div>
            )}
            <div className={`${hasEditPermission ? 'w-1/3' : 'w-1/2'} h-full overflow-auto bg-white`}>  {/* チャット、背景を白に */}
              {chatSlot}
            </div>
            <div className={`${hasEditPermission ? 'w-1/3' : 'w-1/2'} h-full overflow-auto bg-white`}> {/* ★ p-3 を削除 (メモパネルも統一) */}
              {memoSlot || <MemoStudio selectedSourceNames={[]} />}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // PC表示 (既存のレイアウトをTailwindで少し調整)
  return (
    <div className="flex flex-col h-screen max-h-screen bg-muted/40 overflow-hidden">
      <TopHeader title={title} />
      
      {/* 3カラムFlexエリア - 画面の高さを確実に制限 */}
      <div className="flex-grow flex gap-x-2 p-2 min-h-0 max-h-full overflow-hidden">
        {/* 左カラム: ソース (動的幅: 通常25%、メモ表示時16.7%) - 編集権限がある場合のみ表示 */}
        {hasEditPermission && (
          <div 
            className={`bg-white rounded-lg shadow h-full max-h-full overflow-hidden transition-all duration-300 ease-in-out 
                        ${isMemoViewExpanded ? 'w-1/6' : 'w-1/4'}`}
          >
            {sourceSlot || <SourceManager selectedSourceNames={[]} onSelectionChange={() => {}} isMobileView={isMobileView} />}
          </div>
        )}

        {/* 中央カラム: チャット (動的幅: 編集権限有り時: 通常41.7%、メモ表示時33.3% / 編集権限なし時: 通常60%、メモ表示時40%) */}
        <div 
          className={`bg-white rounded-lg shadow h-full max-h-full overflow-hidden transition-all duration-300 ease-in-out 
                      ${hasEditPermission 
                        ? (isMemoViewExpanded ? 'w-2/6' : 'w-2/4')
                        : (isMemoViewExpanded ? 'w-2/5' : 'w-3/5')
                      }`}
        >
          {chatSlot}
        </div>

        {/* 右カラム: メモ (動的幅: 編集権限有り時: 通常33.3%、メモ表示時50% / 編集権限なし時: 通常40%、メモ表示時60%) */}
        <div 
          className={`bg-white rounded-lg shadow h-full max-h-full overflow-hidden transition-all duration-300 ease-in-out 
                      ${hasEditPermission 
                        ? (isMemoViewExpanded ? 'w-3/6' : 'w-1/4')
                        : (isMemoViewExpanded ? 'w-3/5' : 'w-2/5')
                      }`}
        >
          {memoSlot || <MemoStudio selectedSourceNames={[]} />}
        </div>
      </div>
    </div>
  );
};

export default AppLayout; 