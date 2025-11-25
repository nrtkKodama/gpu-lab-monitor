#!/bin/bash

# エラーが発生したら中断する
set -e

# ルート権限のチェック
if [ "$EUID" -ne 0 ]; then
  echo "❌ エラー: このスクリプトはroot権限（sudo）で実行してください。"
  exit 1
fi

echo "=========================================="
echo "🚀 GPU Lab Monitor エージェントセットアップ"
echo "=========================================="

# 1. 必要なパッケージのインストール
echo "📦 [1/5] システムパッケージとPythonライブラリをインストール中..."
apt-get update -qq
apt-get install -y -qq python3 python3-pip

# pipでのインストール (UbuntuのバージョンによるPEP 668エラー回避のため --break-system-packages を試行)
echo "   -> Pythonライブラリ (FastAPI, Uvicorn) をインストール中..."
if ! pip3 install fastapi "uvicorn[standard]" > /dev/null 2>&1; then
    # 最近のUbuntuなどで外部管理エラーが出る場合のフォールバック
    pip3 install fastapi "uvicorn[standard]" --break-system-packages
fi

# 2. ディレクトリとファイルの作成
echo "📂 [2/5] アプリケーションディレクトリを作成中 (/opt/gpu-monitor)..."
mkdir -p /opt/gpu-monitor

echo "📝    -> monitor.py を作成中..."
cat << 'EOF' > /opt/gpu-monitor/monitor.py
import subprocess
import csv
import io
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Dict, Any

app = FastAPI()

# CORS設定: ブラウザや管理サーバーからのアクセスを許可
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
        # 1. cgroupからコンテナIDを取得
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

        # 2. docker inspectで詳細を取得
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
        # nvidia-smiでGPU情報をCSV形式で取得
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
            
            # 各GPUで実行中のプロセス情報を取得
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
                    # Docker情報の特定を試みる
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
    uvicorn.run(app, host="0.0.0.0", port=8000)
EOF

# 3. Systemdサービスの作成
echo "⚙️ [3/5] 自動起動設定 (Systemd) を構成中..."
cat << 'EOF' > /etc/systemd/system/gpu-monitor.service
[Unit]
Description=GPU Monitoring API Agent
After=network.target docker.service

[Service]
User=root
WorkingDirectory=/opt/gpu-monitor
ExecStart=/usr/bin/python3 monitor.py
Restart=always

[Install]
WantedBy=multi-user.target
EOF

echo "   -> サービスを起動中..."
systemctl daemon-reload
systemctl enable gpu-monitor
systemctl restart gpu-monitor

# 4. ファイアウォールの設定
echo "🛡 [4/5] ファイアウォール設定 (ポート8000開放)..."
if command -v ufw > /dev/null; then
    ufw allow 8000/tcp > /dev/null
    echo "   -> UFW設定完了"
else
    echo "   -> UFWが見つかりませんでした。iptables等を使用している場合は手動でTCP 8000を開放してください。"
fi

# 5. 動作確認
echo "✅ [5/5] 動作確認中..."
sleep 2 # 起動待ち

if curl -s http://localhost:8000/metrics | grep -q "online"; then
    echo ""
    echo "🎉 セットアップが正常に完了しました！"
    echo "-----------------------------------------------------"
    echo "IPアドレスを確認し、管理者PCのダッシュボードに追加してください:"
    hostname -I | awk '{print $1}'
    echo "-----------------------------------------------------"
else
    echo ""
    echo "⚠️ 警告: サービスはインストールされましたが、応答確認に失敗しました。"
    echo "以下のコマンドでステータスを確認してください:"
    echo "sudo systemctl status gpu-monitor"
fi
