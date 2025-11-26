#!/bin/bash

# 色の設定
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# サービス名
SERVICE_NAME="gpu-dashboard"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

echo "=== Systemd Service Auto Setup for ${SERVICE_NAME} ==="

# 1. 前提条件のチェック
if [ ! -f "package.json" ]; then
    echo -e "${RED}エラー: package.json が見つかりません。${NC}"
    echo "アプリケーションのルートディレクトリ（npm startを実行する場所）でこのスクリプトを実行してください。"
    exit 1
fi

# sudo権限の確認
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}このスクリプトは管理者権限(sudo)で実行する必要があります。${NC}"
    echo "例: sudo ./setup_service.sh"
    exit 1
fi

# 設定値の自動取得
# SUDO_USER変数が空の場合はrootで実行されているとみなし、rootを使用（通常はsudo実行時の元のユーザーを取得）
REAL_USER=${SUDO_USER:-$USER}
APP_DIR=$(pwd)

# npmとnodeのパス解決 (NVM対応の強化)
# まず元のユーザーとして npm/node のパスを探す（.bashrcなどを読み込ませるため -i は使わないが、whichで探す）
# 注意: NVMの場合、sudo経由だとパスが見えないことがあるため、直接検索を試みる

# 1. sudo -u でユーザーのパスから探す試行
USER_NODE_EXEC=$(sudo -u ${REAL_USER} which node 2>/dev/null)
USER_NPM_EXEC=$(sudo -u ${REAL_USER} which npm 2>/dev/null)

# 2. 見つからない場合、現在の環境(root)から探す
if [ -z "$USER_NODE_EXEC" ]; then
    USER_NODE_EXEC=$(which node)
fi
if [ -z "$USER_NPM_EXEC" ]; then
    USER_NPM_EXEC=$(which npm)
fi

if [ -z "$USER_NPM_EXEC" ]; then
    echo -e "${RED}エラー: npm コマンドが見つかりません。Node.jsはインストールされていますか？${NC}"
    exit 1
fi

# Nodeのバイナリがあるディレクトリを取得（ここをPATHに追加することでバージョン不整合を防ぐ）
NODE_BIN_DIR=$(dirname "$USER_NODE_EXEC")

echo -e "設定情報:"
echo -e "  ユーザー名: ${GREEN}${REAL_USER}${NC}"
echo -e "  ディレクトリ: ${GREEN}${APP_DIR}${NC}"
echo -e "  npmパス: ${GREEN}${USER_NPM_EXEC}${NC}"
echo -e "  Nodeディレクトリ: ${GREEN}${NODE_BIN_DIR}${NC} (PATHに追加します)"
echo ""

# 2. サービスファイルの作成
echo "1. サービスファイル (${SERVICE_FILE}) を作成中..."

cat <<EOF > ${SERVICE_FILE}
[Unit]
Description=GPU Lab Monitor Dashboard
After=network.target

[Service]
# アプリを実行するユーザー名
User=${REAL_USER}

# アプリのディレクトリパス
WorkingDirectory=${APP_DIR}

# 実行コマンド
ExecStart=${USER_NPM_EXEC} start

# 環境変数
Environment=PORT=3000
Environment=NODE_ENV=production
# 【重要】Node.jsのバイナリがあるディレクトリをPATHの先頭に追加
Environment=PATH=${NODE_BIN_DIR}:/usr/bin:/usr/local/bin:/bin:${PATH}

Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

if [ $? -eq 0 ]; then
    echo -e "${GREEN}サービスファイルの作成完了${NC}"
else
    echo -e "${RED}サービスファイルの作成に失敗しました${NC}"
    exit 1
fi

# 3. サービスの有効化と起動
echo "2. Systemdのリロードとサービスの有効化..."

systemctl daemon-reload
systemctl enable ${SERVICE_NAME}

echo "3. サービスを再起動中..."
systemctl restart ${SERVICE_NAME}

# 4. ステータスの確認
echo "4. ステータスを確認します..."
sleep 3 # 起動待ち時間を少し延長

if systemctl is-active --quiet ${SERVICE_NAME}; then
    echo -e "${GREEN}成功！サービスは正常に稼働しています。${NC}"
    echo -e "ステータス詳細:"
    systemctl status ${SERVICE_NAME} --no-pager
    
    # IPアドレスのヒント表示（簡易的）
    HOST_IP=$(hostname -I | awk '{print $1}')
    echo ""
    echo -e "ブラウザで確認してください: ${GREEN}http://localhost:3000${NC}"
else
    echo -e "${RED}警告: サービスの起動に失敗した可能性があります。${NC}"
    systemctl status ${SERVICE_NAME} --no-pager
    echo "ログを確認するには: sudo journalctl -u ${SERVICE_NAME} -f"
fi