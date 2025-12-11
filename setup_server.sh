#!/bin/bash

# 色の設定
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
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

# ユーザーの決定
REAL_USER=${SUDO_USER:-$USER}
APP_DIR=$(pwd)

# ==========================================
# 2. 初期装備（Node.js, npm）のチェックとインストール
# ==========================================
echo "1. 環境依存関係のチェック中..."

# コマンドの存在確認関数
check_command() {
    if command -v "$1" >/dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# ユーザー環境またはシステム環境にNodeがあるか確認
# NVMを使っているユーザーも考慮して、sudo -u でチェック
USER_HAS_NODE=$(sudo -u ${REAL_USER} which node 2>/dev/null)
SYSTEM_HAS_NODE=$(which node 2>/dev/null)

if [ -z "$USER_HAS_NODE" ] && [ -z "$SYSTEM_HAS_NODE" ]; then
    echo -e "${YELLOW}Node.js / npm が見つかりません。インストールを開始します...${NC}"
    
    # OS判定とインストール
    if [ -f /etc/debian_version ]; then
        # Debian/Ubuntu系
        echo "Ubuntu/Debian系システムを検出しました。"
        # curlがない場合は入れる
        if ! check_command curl; then
            apt-get update && apt-get install -y curl
        fi
        
        # NodeSourceからLTS版(安定版)をインストール
        echo "Node.js (LTS) のセットアップスクリプトを実行中..."
        curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
        apt-get install -y nodejs

    elif [ -f /etc/redhat-release ]; then
        # CentOS/RHEL系
        echo "CentOS/RHEL系システムを検出しました。"
        if ! check_command curl; then
            yum install -y curl
        fi
        
        echo "Node.js (LTS) のセットアップスクリプトを実行中..."
        curl -fsSL https://rpm.nodesource.com/setup_lts.x | bash -
        yum install -y nodejs
    else
        echo -e "${RED}未対応のOSです。手動でNode.jsをインストールしてください。${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}Node.js と npm のインストールが完了しました。${NC}"
else
    echo -e "${GREEN}Node.js は既にインストールされています。${NC}"
fi

# ==========================================
# 3. プロジェクト依存関係 (node_modules) のチェック
# ==========================================
echo "2. プロジェクトの依存パッケージをチェック中..."

if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}node_modules が見つかりません。npm install を実行します...${NC}"
    # 権限エラーを防ぐため、所有者ユーザーとして実行
    sudo -u ${REAL_USER} npm install
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}npm install 完了${NC}"
    else
        echo -e "${RED}npm install に失敗しました${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}node_modules は存在します。スキップします。${NC}"
fi

# ==========================================
# 4. パスの解決 (NVM対応強化版)
# ==========================================

# 再度パスを取得（新規インストールされた場合のため）
USER_NODE_EXEC=$(sudo -u ${REAL_USER} which node 2>/dev/null)
USER_NPM_EXEC=$(sudo -u ${REAL_USER} which npm 2>/dev/null)

# ユーザー環境で見つからない場合はシステムパス(root)を採用
if [ -z "$USER_NODE_EXEC" ]; then
    USER_NODE_EXEC=$(which node)
fi
if [ -z "$USER_NPM_EXEC" ]; then
    USER_NPM_EXEC=$(which npm)
fi

# それでも無い場合はエラー（インストール失敗など）
if [ -z "$USER_NPM_EXEC" ]; then
    echo -e "${RED}致命的エラー: npm コマンドへのパスが解決できませんでした。${NC}"
    exit 1
fi

NODE_BIN_DIR=$(dirname "$USER_NODE_EXEC")

echo -e "\n設定情報:"
echo -e "  ユーザー名: ${GREEN}${REAL_USER}${NC}"
echo -e "  ディレクトリ: ${GREEN}${APP_DIR}${NC}"
echo -e "  npmパス: ${GREEN}${USER_NPM_EXEC}${NC}"
echo -e "  Nodeディレクトリ: ${GREEN}${NODE_BIN_DIR}${NC}"
echo ""

# ==========================================
# 5. サービスファイルの作成
# ==========================================
echo "3. サービスファイル (${SERVICE_FILE}) を作成中..."

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

# ==========================================
# 6. サービスの有効化と起動
# ==========================================
echo "4. Systemdのリロードとサービスの有効化..."

systemctl daemon-reload
systemctl enable ${SERVICE_NAME}

echo "5. サービスを再起動中..."
systemctl restart ${SERVICE_NAME}

# ==========================================
# 7. ステータスの確認
# ==========================================
echo "6. ステータスを確認します..."
sleep 3 

if systemctl is-active --quiet ${SERVICE_NAME}; then
    echo -e "${GREEN}成功！サービスは正常に稼働しています。${NC}"
    echo -e "ステータス詳細:"
    systemctl status ${SERVICE_NAME} --no-pager
    
    # IPアドレスのヒント表示
    HOST_IP=$(hostname -I | awk '{print $1}')
    echo ""
    echo -e "ブラウザで確認してください: ${GREEN}http://localhost:3000${NC}"
    echo -e "(または http://${HOST_IP}:3000)"
else
    echo -e "${RED}警告: サービスの起動に失敗した可能性があります。${NC}"
    systemctl status ${SERVICE_NAME} --no-pager
    echo "ログを確認するには: sudo journalctl -u ${SERVICE_NAME} -f"
fi