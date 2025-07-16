#!/bin/bash

# frontendディレクトリへのパス
FRONTEND_DIR="frontend"

# 現在のブランチを取得
BRANCH=$(git branch --show-current)

echo "Current branch: $BRANCH"

if [ "$BRANCH" = "main" ]; then
    # mainブランチの場合は本番環境用の設定を使用
    if [ -f "$FRONTEND_DIR/.env.production" ]; then
        cp "$FRONTEND_DIR/.env.production" "$FRONTEND_DIR/.env"
        echo "Switched to PRODUCTION environment (copied $FRONTEND_DIR/.env.production to $FRONTEND_DIR/.env)"
    else
        echo "Error: $FRONTEND_DIR/.env.production file not found!"
        exit 1
    fi
else
    # develop等その他のブランチの場合は開発環境用の設定を使用
    if [ -f "$FRONTEND_DIR/.env.development" ]; then
        cp "$FRONTEND_DIR/.env.development" "$FRONTEND_DIR/.env"
        echo "Switched to DEVELOPMENT environment (copied $FRONTEND_DIR/.env.development to $FRONTEND_DIR/.env)"
    else
        echo "Error: $FRONTEND_DIR/.env.development file not found! Please create it with your development settings."
        exit 1
    fi
fi

echo "Environment setup complete!"