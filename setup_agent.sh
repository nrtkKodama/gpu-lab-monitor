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
import json
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
    # allow_private_network=True,
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
    """
    PIDからDockerコンテナの所有者と名前を特定する
    環境変数、ラベル、ホストプロセス所有者などを複合的にチェックして「真のユーザー」を探します。
    """
    # 0. ホストOS上のプロセス所有者を取得 (フォールバックとして有用)
    host_user = "unknown"
    try:
        # ps -o user= -p PID
        proc = subprocess.run(["ps", "-o", "user=", "-p", str(pid)], capture_output=True, text=True)
        if proc.returncode == 0:
            host_user = proc.stdout.strip()
    except:
        pass

    try:
        # 1. cgroupからコンテナIDを取得
        container_id = None
        with open(f"/proc/{pid}/cgroup", "r") as f:
            for line in f:
                if "docker" in line or "kubepods" in line:
                    parts = line.strip().split("/")
                    if parts:
                        cid = parts[-1]
                        # systemd scopeやdocker-プレフィックスの除去
                        if cid.endswith(".scope"): cid = cid[:-6]
                        if cid.startswith("docker-"): cid = cid[7:]
                        
                        if len(cid) >= 12:
                            container_id = cid
                            break
        
        # コンテナでない場合、ホストユーザーを返す
        if not container_id:
            return {"user": host_user if host_user != "unknown" else "system", "container": ""}

        # 2. docker inspectで詳細メタデータを取得
        # Name, Config.User, Config.Env, Config.Labels を一括取得
        cmd = ["docker", "inspect", "--format", "{{json .}}", container_id]
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode != 0:
            return {"user": host_user, "container": "unknown-container"}
            
        data = json.loads(result.stdout)
        
        name = data.get("Name", "").lstrip("/")
        config = data.get("Config", {})
        labels = config.get("Labels", {}) or {}
        env_list = config.get("Env", []) or []
        config_user = config.get("User", "")

        # --- ヒューリスティック 1: 環境変数 (研究室でよく使われる変数を優先) ---
        env_map = {}
        for e in env_list:
            if "=" in e:
                k, v = e.split("=", 1)
                env_map[k] = v
        
        # チェックする環境変数の優先順位
        target_envs = ["JUPYTERHUB_USER", "NB_USER", "SUDO_USER", "USER", "USERNAME", "OWNER"]
        for key in target_envs:
            if key in env_map:
                val = env_map[key]
                # デフォルト値っぽいものは無視
                if val and val not in ["root", "jovyan", "ubuntu", "1000", "node"]:
                    return {"user": val, "container": name}

        # --- ヒューリスティック 2: Docker Labels ---
        # docker-composeのプロジェクト名はユーザー名であることが多い
        if "com.docker.compose.project" in labels:
            return {"user": labels["com.docker.compose.project"], "container": name}
        if "maintainer" in labels:
            return {"user": labels["maintainer"], "container": name}
        if "user" in labels:
            return {"user": labels["user"], "container": name}

        # --- ヒューリスティック 3: ホストプロセスの所有者 ---
        # root以外のユーザーがコンテナを起動している場合、それが最も正確
        if host_user not in ["root", "dockremap", "unknown"]:
            return {"user": host_user, "container": name}

        # --- ヒューリスティック 4: Config User (フォールバック) ---
        if config_user and config_user not in ["root", "0", "1000", "jovyan"]:
            return {"user": config_user, "container": name}

        # 最終手段
        return {"user": "system", "container": name}
            
    except Exception:
        # エラー時はホストユーザーを返す
        return {"user": host_user if host_user != "unknown" else "system", "container": ""}

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
                    # Docker情報の特定を試みる (高精度版)
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
