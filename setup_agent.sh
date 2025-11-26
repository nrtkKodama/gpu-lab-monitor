#!/bin/bash

# エラーが発生したら即座に停止
set -e

# ルート権限チェック
if [ "$EUID" -ne 0 ]; then
  echo "❌ エラー: このスクリプトはroot権限（sudo）で実行してください。"
  exit 1
fi

APP_DIR="/opt/gpu-monitor"
VENV_DIR="$APP_DIR/venv"

echo "=========================================="
echo "🚀 GPU Lab Monitor エージェントセットアップ (Venv版)"
echo "=========================================="

# 1. システムパッケージのインストール
echo "📦 [1/6] 必要なシステムパッケージをインストール中..."
apt-get update -qq
# python3-venv を追加
apt-get install -y -qq python3 python3-pip python3-venv

# 2. ディレクトリ作成
echo "📂 [2/6] アプリケーションディレクトリを作成中 ($APP_DIR)..."
mkdir -p "$APP_DIR"

# 3. 仮想環境(venv)の作成
echo "🐍 [3/6] Python仮想環境を作成中..."
if [ ! -d "$VENV_DIR" ]; then
    python3 -m venv "$VENV_DIR"
    echo "   -> 仮想環境を作成しました: $VENV_DIR"
else
    echo "   -> 既存の仮想環境を使用します"
fi

# 4. pipパッケージのインストール (仮想環境内)
echo "⬇️  [4/6] ライブラリをインストール中 (FastAPI, Uvicorn)..."
# 仮想環境内のpipを使用することでシステム環境を汚さない
"$VENV_DIR/bin/pip" install --upgrade pip -q
"$VENV_DIR/bin/pip" install fastapi "uvicorn[standard]" -q

# 5. monitor.py の作成 (※CORSバグ修正済み版)
echo "📝 [5/6] monitor.py を配置中..."
cat << 'EOF' > "$APP_DIR/monitor.py"
import subprocess
import csv
import io
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Dict, Any

app = FastAPI()

# CORS設定: 互換性のため allow_private_network は除外
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

def safe_float(value: Any) -> float:
    try:
        return float(value)
    except (ValueError, TypeError):
        return 0.0

def safe_int(value: Any) -> int:
    try:
        return int(value)
    except (ValueError, TypeError):
        return 0

def get_docker_owner(pid: str) -> Dict[str, str]:
    """PIDからDockerコンテナの所有者と名前を特定する"""
    try:
        with open(f"/proc/{pid}/cgroup", "r") as f:
            cgroup_content = f.read()
            
        container_id = None
        for line in cgroup_content.splitlines():
            if "docker" in line:
                parts = line.split("/")
                if len(parts) > 0:
                    container_id = parts[-1]
                    break
        
        if not container_id:
            return {"user": "system", "container": ""}

        result = subprocess.run(
            ["docker", "inspect", "--format", "{{.Name}}|{{.Config.User}}", container_id],
            capture_output=True, text=True
        )
        
        if result.returncode == 0:
            name, user = result.stdout.strip().split("|")
            return {"user": user or "root", "container": name.lstrip("/")}
            
    except Exception:
        pass
        
    return {"user": "system", "container": ""}

@app.get("/")
def root():
    return {"status": "GPU Monitor Agent is Running. Access /metrics for data."}

@app.get("/metrics")
def get_metrics():
    try:
        cmd = [
            "nvidia-smi", 
            "--query-gpu=index,name,utilization.gpu,utilization.memory,memory.total,memory.used,memory.free,temperature.gpu,power.draw,power.limit", 
            "--format=csv,noheader,nounits"
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        
        if res.returncode != 0:
            return {"status": "error", "message": "nvidia-smi failed"}

        reader = csv.reader(io.StringIO(res.stdout))
        gpus = []
        
        for row in reader:
            if len(row) < 10: continue
            index = safe_int(row[0])
            
            proc_cmd = [
                "nvidia-smi", 
                "--query-compute-apps=gpu_uuid,pid,process_name,used_memory", 
                "--format=csv,noheader,nounits",
                "-i", str(index)
            ]
            proc_res = subprocess.run(proc_cmd, capture_output=True, text=True)
            processes = []
            
            if proc_res.returncode == 0 and proc_res.stdout.strip():
                proc_reader = csv.reader(io.StringIO(proc_res.stdout))
                for p_row in proc_reader:
                    if len(p_row) < 4: continue
                    pid = p_row[1].strip()
                    docker_info = get_docker_owner(pid)
                    
                    processes.append({
                        "pid": safe_int(pid),
                        "type": "C",
                        "processName": p_row[2].strip(),
                        "usedMemory": safe_int(p_row[3]),
                        "user": docker_info["user"],
                        "containerName": docker_info["container"]
                    })

            gpus.append({
                "index": index,
                "name": row[1].strip(),
                "utilization": {
                    "gpu": safe_int(row[2]),
                    "memory": safe_int(row[3])
                },
                "memory": {
                    "total": safe_float(row[4]),
                    "used": safe_float(row[5]),
                    "free": safe_float(row[6])
                },
                "temperature": safe_int(row[7]),
                "power": {
                    "draw": safe_float(row[8]),
                    "limit": safe_float(row[9])
                },
                "processes": processes
            })

        return {"status": "online", "gpus": gpus}
        
    except Exception as e:
        return {"status": "error", "message": str(e), "gpus": []}

if __name__ == "__main__":
    # 仮想環境内であれば uvicorn はそのまま呼び出せるが
    # スクリプト直接実行時はライブラリ呼び出しになる
    uvicorn.run(app, host="0.0.0.0", port=8000)
EOF

# 6. Systemdサービスの作成 (仮想環境のPythonを指定)
echo "⚙️ [6/6] 自動起動設定を更新中..."
cat << EOF > /etc/systemd/system/gpu-monitor.service
[Unit]
Description=GPU Monitoring API Agent
After=network.target docker.service

[Service]
User=root
WorkingDirectory=$APP_DIR
# 重要: 仮想環境内のPythonバイナリを使用
ExecStart=$VENV_DIR/bin/python monitor.py
Restart=always

[Install]
WantedBy=multi-user.target
EOF

echo "   -> サービスを再起動中..."
systemctl daemon-reload
systemctl enable gpu-monitor
systemctl restart gpu-monitor

# ファイアウォール確認
if command -v ufw > /dev/null; then
    ufw allow 8000/tcp > /dev/null
fi

# 動作確認
echo "✅ セットアップ完了。動作確認中..."
sleep 2

if curl -s http://localhost:8000/metrics | grep -q "online"; then
    echo ""
    echo "🎉 成功！Venv環境で正常に動作しています。"
    echo "-----------------------------------------------------"
    echo "IPアドレス: $(hostname -I | awk '{print $1}')"
    echo "-----------------------------------------------------"
else
    echo ""
    echo "⚠️ 警告: 応答がありません。ログを確認してください:"
    echo "sudo journalctl -u gpu-monitor -n 20 --no-pager"
fi
