#!/bin/bash

# ==========================================
# 設定項目 (環境に合わせて書き換えてください)
# ==========================================
# Reactアプリのディレクトリパス
FRONTEND_DIR="/home/hamalab/gpu-lab-monitor"
BACKEND_DIR="/opt/gpu-monitor"
VENV_DIR="$BACKEND_DIR/venv"

BACKEND_PORT=8000
FRONTEND_PORT=3000
# ==========================================

set -e

if [ "$EUID" -ne 0 ]; then
  echo "❌ エラー: sudo で実行してください。"
  exit 1
fi

echo "=========================================="
echo "🚀 GPU Lab Monitor セットアップ (修正版)"
echo "   Backend: $BACKEND_PORT | Frontend: $FRONTEND_PORT"
echo "=========================================="

# 1. 必要なツールのインストール
echo "📦 [1/9] システムパッケージとNgrokをインストール中..."
apt-get install -y -qq python3 python3-pip python3-venv nodejs npm curl jq

# Ngrokのインストール (未インストールの場合のみ)
if ! command -v ngrok &> /dev/null; then
    echo "   -> Ngrokをインストールします..."
    curl -s https://ngrok-agent.s3.amazonaws.com/ngrok.asc | tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null
    echo "deb https://ngrok-agent.s3.amazonaws.com buster main" | tee /etc/apt/sources.list.d/ngrok.list
    apt-get update -qq && apt-get install ngrok -y -qq
fi

# ★修正ポイント: ngrokの実際のパスを取得
NGROK_BIN=$(which ngrok)
if [ -z "$NGROK_BIN" ]; then
    echo "❌ エラー: ngrok のインストールに失敗しました。"
    exit 1
fi
echo "   -> Ngrok path detected: $NGROK_BIN"

# 2. Ngrokの認証
if [ ! -f /root/.config/ngrok/ngrok.yml ]; then
    echo ""
    echo "🔑 【重要】Ngrok Authtokenを入力してください。"
    echo "   (https://dashboard.ngrok.com/get-started/your-authtoken から取得)"
    read -p "Token > " NGROK_TOKEN
    if [ -n "$NGROK_TOKEN" ]; then
        ngrok config add-authtoken "$NGROK_TOKEN"
    fi
fi

# 3. バックエンド (Python) の構築
echo "🐍 [2/9] Backend (Port $BACKEND_PORT) を構築中..."
mkdir -p "$BACKEND_DIR"
if [ ! -d "$VENV_DIR" ]; then python3 -m venv "$VENV_DIR"; fi

"$VENV_DIR/bin/pip" install --upgrade pip -q
"$VENV_DIR/bin/pip" install fastapi "uvicorn[standard]" -q

# monitor.py
cat << EOF > "$BACKEND_DIR/monitor.py"
import subprocess, csv, io, uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

def safe_int(v):
    try: return int(v)
    except: return 0
def safe_float(v):
    try: return float(v)
    except: return 0.0

@app.get("/metrics")
def get_metrics():
    try:
        cmd = ["nvidia-smi", "--query-gpu=index,name,utilization.gpu,utilization.memory,memory.total,memory.used,memory.free,temperature.gpu,power.draw,power.limit", "--format=csv,noheader,nounits"]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0: return {"status": "error", "message": "nvidia-smi failed"}

        gpus = []
        reader = csv.reader(io.StringIO(res.stdout))
        for row in reader:
            if len(row) < 10: continue
            index = safe_int(row[0])
            proc_cmd = ["nvidia-smi", "--query-compute-apps=pid,process_name,used_memory", "--format=csv,noheader,nounits", "-i", str(index)]
            proc_res = subprocess.run(proc_cmd, capture_output=True, text=True)
            processes = []
            if proc_res.returncode == 0 and proc_res.stdout.strip():
                for p_row in csv.reader(io.StringIO(proc_res.stdout)):
                    if len(p_row) < 3: continue
                    processes.append({
                        "pid": safe_int(p_row[0]), "processName": p_row[1].strip(), "usedMemory": safe_int(p_row[2]),
                        "user": "system", "containerName": ""
                    })
            gpus.append({
                "index": index, "name": row[1].strip(),
                "utilization": {"gpu": safe_int(row[2]), "memory": safe_int(row[3])},
                "memory": {"total": safe_float(row[4]), "used": safe_float(row[5]), "free": safe_float(row[6])},
                "temperature": safe_int(row[7]), "power": {"draw": safe_float(row[8]), "limit": safe_float(row[9])},
                "processes": processes
            })
        return {"status": "online", "gpus": gpus}
    except Exception as e: return {"status": "error", "message": str(e), "gpus": []}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=$BACKEND_PORT)
EOF

# 4. フロントエンド設定 (Proxy注入)
echo "⚛️  [3/9] Frontend (Port $FRONTEND_PORT) 設定調整..."
if [ -d "$FRONTEND_DIR" ]; then
    cd "$FRONTEND_DIR"
    # vite.config.ts を上書きして Proxy を設定
    cat << TS_EOF > vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Ngrok(3000) -> Frontend(3000) -> Proxy -> Backend(8000)
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: $FRONTEND_PORT,
    proxy: {
      '/metrics': {
        target: 'http://localhost:$BACKEND_PORT',
        changeOrigin: true,
        secure: false,
      }
    }
  }
})
TS_EOF
    echo "   -> npm install を実行中..."
    npm install --silent
fi

# 5. Systemd: Backend
echo "⚙️ [4/9] サービス登録 (Backend)..."
cat << EOF > /etc/systemd/system/gpu-backend.service
[Unit]
Description=GPU Backend (Port $BACKEND_PORT)
After=network.target

[Service]
User=root
WorkingDirectory=$BACKEND_DIR
ExecStart=$VENV_DIR/bin/python monitor.py
Restart=always

[Install]
WantedBy=multi-user.target
EOF

# 6. Systemd: Frontend
echo "⚙️ [5/9] サービス登録 (Frontend)..."
cat << EOF > /etc/systemd/system/gpu-frontend.service
[Unit]
Description=GPU Frontend (Port $FRONTEND_PORT)
After=network.target

[Service]
User=root
WorkingDirectory=$FRONTEND_DIR
Environment=CI=true
ExecStart=/usr/bin/npm start
Restart=always

[Install]
WantedBy=multi-user.target
EOF

# 7. Systemd: Ngrok (★修正済み)
echo "☁️  [6/9] サービス登録 (Ngrok Tunnel)..."
# ここで $NGROK_BIN 変数（検出した正しいパス）を使用
cat << EOF > /etc/systemd/system/ngrok-tunnel.service
[Unit]
Description=Ngrok Tunnel for GPU Monitor
After=network.target

[Service]
User=root
ExecStart=$NGROK_BIN http $FRONTEND_PORT --log=stdout
Restart=always

[Install]
WantedBy=multi-user.target
EOF

# 8. 全起動
echo "🚀 [7/9] 全サービス再起動..."
systemctl daemon-reload
systemctl enable gpu-backend gpu-frontend ngrok-tunnel
systemctl restart gpu-backend gpu-frontend ngrok-tunnel

# ファイアウォール許可
if command -v ufw > /dev/null; then
    echo "🛡️ ファイアウォール設定..."
    ufw allow $BACKEND_PORT/tcp > /dev/null
    ufw allow $FRONTEND_PORT/tcp > /dev/null
    ufw reload > /dev/null
fi

echo "⏳ [8/9] Ngrok URL取得待機中 (5秒)..."
sleep 5

# 9. URL表示
echo "🔎 [9/9] URL取得中..."
NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[0].public_url')

echo ""
echo "====================================================="
echo "🎉 セットアップ完了！"
echo "====================================================="
echo ""
if [ "$NGROK_URL" != "null" ] && [ -n "$NGROK_URL" ]; then
    echo "🌍 あなたのGPUモニターURL:"
    echo "   $NGROK_URL"
    echo ""
    echo "   (このURLにアクセスすると、Github Pagesを使わずに直接見られます)"
else
    echo "⚠️ URL取得失敗: ngrok-tunnelサービスの状態を確認してください。"
    echo "   確認コマンド: sudo systemctl status ngrok-tunnel"
fi
echo ""
echo "====================================================="
