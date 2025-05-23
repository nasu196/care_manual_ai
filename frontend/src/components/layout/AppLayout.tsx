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
type PanelType = typeof PANELS[number];

const AppLayout = ({ sourceSlot, chatSlot, memoSlot }: AppLayoutProps) => {
  // const title = headerTitle || '持続化補助金＜創業型＞公募要領'; // タイトルの設定
  const [title, setTitle] = useState('Care Manual AI'); // 固定タイトルに変更（一時的）

  // ★ メモ表示状態を取得
  const isMemoViewExpanded = useMemoStore((state) => state.isMemoViewExpanded);

  const [isMobileView, setIsMobileView] = useState(false);
  const [activeMobilePanel, setActiveMobilePanel] = useState<PanelType>('chat');
  
  const [currentPanelWidth, setCurrentPanelWidth] = useState(0); // ★ 現在のパネル幅を保持するstate
  const [translateX, setTranslateX] = useState(0); // ★ 初期値を0に変更

  console.log('[AppLayout] Initial state: isMobileView:', isMobileView, 'activeMobilePanel:', activeMobilePanel, 'translateX:', translateX, 'currentPanelWidth:', currentPanelWidth);

  useEffect(() => {
    const checkMobileView = () => {
      const mobile = window.innerWidth < MOBILE_BREAKPOINT;
      setIsMobileView(mobile);
      const currentWidth = window.innerWidth; // 現在のウィンドウ幅を取得
      setCurrentPanelWidth(currentWidth); // パネル幅stateを更新

      const newIndex = PANELS.indexOf(activeMobilePanel);
      if (mobile) {
        setTranslateX(newIndex * -currentWidth);
        console.log('[AppLayout] checkMobileView (mobile): panelWidth:', currentWidth, 'newIndex:', newIndex, 'translateX:', newIndex * -currentWidth);
      } else {
        setTranslateX(newIndex * -currentWidth); // PC表示でもtranslateXを計算（スライドには使われないが整合性のため）
        console.log('[AppLayout] Switched to PC view. activeMobilePanel:', activeMobilePanel, 'panelWidth:', currentWidth, 'translateX:', newIndex * -currentWidth);
      }
    };
    checkMobileView();
    window.addEventListener('resize', checkMobileView);
    return () => window.removeEventListener('resize', checkMobileView);
  }, [activeMobilePanel]); 

  useEffect(() => {
    if (isMobileView) {
      if (currentPanelWidth > 0) { // currentPanelWidthが設定されてから計算
        const newIndex = PANELS.indexOf(activeMobilePanel);
        setTranslateX(newIndex * -currentPanelWidth);
        console.log('[AppLayout] activeMobilePanel or isMobileView changed (mobile): activeMobilePanel:', activeMobilePanel, 'newIndex:', newIndex, 'panelWidth:', currentPanelWidth, 'newTranslateX (px):', newIndex * -currentPanelWidth);
      }
    } else {
      if (currentPanelWidth > 0) { // PC表示でも念のためcurrentPanelWidthを考慮
        const newIndex = PANELS.indexOf(activeMobilePanel);
        setTranslateX(newIndex * -currentPanelWidth); 
        console.log('[AppLayout] activeMobilePanel or isMobileView changed (PC): activeMobilePanel:', activeMobilePanel, 'newIndex:', newIndex, 'panelWidth:', currentPanelWidth, 'translateX set to (px):', newIndex * -currentPanelWidth);
      }
    }
  }, [activeMobilePanel, isMobileView, currentPanelWidth]); // currentPanelWidthも依存配列に追加

  const handleTitleChange = (newTitle: string) => {
    setTitle(newTitle);
  };

  // TabsのonValueChangeで直接activeMobilePanelを更新するため、この関数は不要
  // const handleTabSelect = (panel: PanelType) => {
  //   setActiveMobilePanel(panel);
  // };

  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => {
      const currentIndex = PANELS.indexOf(activeMobilePanel);
      console.log('[AppLayout] onSwipedLeft: currentIndex:', currentIndex); // ★ スワイプ左ログ
      if (currentIndex < PANELS.length - 1) {
        setActiveMobilePanel(PANELS[currentIndex + 1]);
      }
    },
    onSwipedRight: () => {
      const currentIndex = PANELS.indexOf(activeMobilePanel);
      console.log('[AppLayout] onSwipedRight: currentIndex:', currentIndex); // ★ スワイプ右ログ
      if (currentIndex > 0) {
        setActiveMobilePanel(PANELS[currentIndex - 1]);
      }
    },
    trackMouse: true, // マウスでのスワイプも有効にする場合
    preventScrollOnSwipe: true, // スワイプ中の縦スクロールを防止
  });

  console.log('[AppLayout] Rendering: isMobileView:', isMobileView, 'activeMobilePanel:', activeMobilePanel, 'translateX:', translateX); // ★ レンダリング直前ログ

  if (isMobileView) {
    return (
      <div className="flex flex-col h-screen bg-muted/40 overflow-hidden">
        <TopHeader title={title} onTitleChange={handleTitleChange} />
        
        <Tabs 
          value={activeMobilePanel} 
          onValueChange={(value) => setActiveMobilePanel(value as PanelType)} 
          className="w-full bg-white border-b"
        >
          <TabsList className="grid w-full grid-cols-3 h-12 rounded-none bg-white">
            {PANELS.map(panel => (
              <TabsTrigger 
                key={panel} 
                value={panel}
                className="h-full text-sm font-medium rounded-none border-transparent 
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
            className="flex h-full absolute top-0 left-0 w-[300%]" // 3パネル分なので300%
            style={{
              transform: `translateX(${translateX}px)`, 
              transition: 'transform 0.3s ease-in-out', 
            }}
          >
            {console.log('[AppLayout] Mobile panel container style - transform:', `translateX(${translateX}px)`)}
            <div className="w-1/3 h-full overflow-auto bg-white">
              {sourceSlot ? React.cloneElement(sourceSlot as React.ReactElement, { isMobileView }) : <SourceManager isMobileView={isMobileView} />}
            </div>
            <div className="w-1/3 h-full overflow-auto bg-white">  {/* チャット、背景を白に */}
              {chatSlot}
            </div>
            <div className="w-1/3 h-full overflow-auto bg-white"> {/* ★ p-3 を削除 (メモパネルも統一) */}
              {memoSlot || <MemoStudio />}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // PC表示 (既存のレイアウトをTailwindで少し調整)
  return (
    <div className="flex flex-col h-screen bg-muted/40">
      <TopHeader title={title} onTitleChange={handleTitleChange} />
      
      {/* 3カラムFlexエリア - アニメーションのためGridからFlexに変更 */}
      <div className="flex-grow flex gap-x-2 p-2">
        {/* 左カラム: ソース (動的幅: 通常25%、メモ表示時16.7%) */}
        <div 
          className={`bg-white rounded-lg shadow h-full overflow-hidden transition-all duration-300 ease-in-out 
                      ${isMemoViewExpanded ? 'w-1/6' : 'w-1/4'}`}
        >
          {sourceSlot ? React.cloneElement(sourceSlot as React.ReactElement, { isMobileView }) : <SourceManager isMobileView={isMobileView} />}
        </div>

        {/* 中央カラム: チャット (動的幅: 通常41.7%、メモ表示時33.3%) */}
        <div 
          className={`bg-white rounded-lg shadow h-full overflow-hidden transition-all duration-300 ease-in-out 
                      ${isMemoViewExpanded ? 'w-2/6' : 'w-2/4'}`} // 背景を白に
        >
          {chatSlot}
        </div>

        {/* 右カラム: メモ (動的幅: 通常33.3%、メモ表示時50%) */}
        <div 
          className={`bg-white rounded-lg shadow h-full overflow-hidden transition-all duration-300 ease-in-out 
                      ${isMemoViewExpanded ? 'w-3/6' : 'w-1/4'}`} // 背景を白に
        >
          {memoSlot || <MemoStudio />}
        </div>
      </div>
    </div>
  );
};

export default AppLayout; 