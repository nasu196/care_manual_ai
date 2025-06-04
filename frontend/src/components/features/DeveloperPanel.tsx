'use client';

import React, { useState, useEffect } from 'react';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Settings, Crown, User } from 'lucide-react';

export interface PremiumStatus {
  isPremium: boolean;
  fileLimit: number;
  fileSizeLimit: number; // MB
}

interface DeveloperPanelProps {
  onPremiumStatusChange: (status: PremiumStatus) => void;
}

export const DeveloperPanel: React.FC<DeveloperPanelProps> = ({ onPremiumStatusChange }) => {
  const [isPremium, setIsPremium] = useState(false);

  useEffect(() => {
    const premiumStatus: PremiumStatus = {
      isPremium,
      fileLimit: isPremium ? Infinity : 3,
      fileSizeLimit: isPremium ? 100 : 30, // 有料: 100MB, 無料: 30MB
    };
    onPremiumStatusChange(premiumStatus);
  }, [isPremium, onPremiumStatusChange]);

  // 本番環境では何も表示しない
  if (process.env.NODE_ENV === 'production') {
    return null;
  }

  const handleToggle = (checked: boolean) => {
    setIsPremium(checked);
  };

  // 表示用のpremiumStatusオブジェクト
  const premiumStatus: PremiumStatus = {
    isPremium,
    fileLimit: isPremium ? Infinity : 3,
    fileSizeLimit: isPremium ? 100 : 30, // 有料: 100MB, 無料: 30MB
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center space-x-2 text-sm">
          <Settings className="h-4 w-4" />
          <span>開発用 - プラン切り替え</span>
        </CardTitle>
        <CardDescription className="text-xs">
          検証用のプラン切り替えスイッチ
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            {isPremium ? (
              <>
                <Crown className="h-4 w-4 text-yellow-500" />
                <span className="text-sm font-medium">有料プラン</span>
              </>
            ) : (
              <>
                <User className="h-4 w-4 text-gray-500" />
                <span className="text-sm font-medium">無料プラン</span>
              </>
            )}
          </div>
          <Switch
            checked={isPremium}
            onCheckedChange={handleToggle}
          />
        </div>
        
        <div className="space-y-2 pt-2 border-t">
          <div className="flex justify-between items-center text-xs">
            <span>ファイル数制限:</span>
            <Badge variant={isPremium ? "default" : "secondary"}>
              {premiumStatus.fileLimit === Infinity ? "無制限" : `${premiumStatus.fileLimit}ファイル`}
            </Badge>
          </div>
          <div className="flex justify-between items-center text-xs">
            <span>ファイルサイズ制限:</span>
            <Badge variant={isPremium ? "default" : "secondary"}>
              {premiumStatus.fileSizeLimit}MB
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}; 