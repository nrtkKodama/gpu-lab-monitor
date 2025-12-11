#!/bin/bash
set -e

# ルート権限チェック
if [ "$EUID" -ne 0 ]; then
  echo "❌ エラー: sudo で実行してください。"
  exit 1
fi

APP_DIR="/opt/gpu-monitor"
VENV_DIR="$APP_DIR/venv"

echo "=========================================="
echo "🚀 GPU Lab Monitor 最終修復セットアップ"
echo "=========================================="

# ---------------------------------------------------------
# 【完全修復】すべての設定ファイルのリポジトリURLを置換
# ---------------------------------------------------------
echo "🔧 [0/6] 新旧すべての設定ファイルを old-releases に書き換えます..."

# 1. 新しい形式 (ubuntu.sources) の修正
if [ -f /etc/apt/sources.list.d/ubuntu.sources ]; then
    echo "   -> ubuntu.sources を修正中..."
    sed -i 's/jp.archive.ubuntu.com/old-releases.ubuntu.com/g' /etc/apt/sources.list.d/ubuntu.sources
    sed -i 's/archive.ubuntu.com/old-releases.ubuntu.com/g' /etc/apt/sources.list.d/ubuntu.sources
    sed -i 's/security.ubuntu.com/old-releases.ubuntu.com/g' /etc/apt/sources.list.d/ubuntu.sources
fi

# 2. 古い形式 (sources.list) の修正 (念のため再実行)
if [ -f /etc/apt/sources.list ]; then
    echo "   -> sources.list を修正中..."
    sed -i 's/jp.archive.ubuntu.com/old-releases.ubuntu.com/g' /etc/apt/sources.list
    sed -i 's/archive.ubuntu.com/old-releases.ubuntu.com/g' /etc/apt/sources.list
    sed -i 's/security.ubuntu.com/old-releases.ubuntu.com/g' /etc/apt/sources.list
fi

# 3. その他の .list ファイルも全て修正
find /etc/apt/sources.list.d/ -name "*.list" -type f -exec sed -i 's/jp.archive.ubuntu.com/old-releases.ubuntu.com/g' {} + 2>/dev/null || true
find /etc/apt/sources.list.d/ -name "*.list" -type f -exec sed -i 's/archive.ubuntu.com/old-releases.ubuntu.com/g' {} + 2>/dev/null || true
find /etc/apt/sources.list.d/ -name "*.list" -type f -exec sed -i 's/security.ubuntu.com/old-releases.ubuntu.com/g' {} + 2>/dev/null || true

echo "📦 [1/6] パッケージリストを更新中..."
apt-get update

# ---------------------------------------------------------
# 以下、インストール手順
# ---------------------------------------------------------

echo "⬇️  [2/6] 必要なパッケージをインストール中..."
apt-get install -y python3 python3-pip python3-venv

# ディレクトリ作成
echo "📂 [3/6] アプリケーションディレクトリを作成中..."
mkdir -p "$APP_DIR"

# 仮想環境(venv)の作成
echo "🐍 [4/6] Python仮想環境を作成中..."
if [ ! -d "$VENV_DIR" ]; then
    python3 -m venv "$VENV_DIR"
else
    echo "   -> 既存の仮想環境を使用します"
fi

# pipパッケージのインストール
echo "⬇️  [5/6] Pythonライブラリをインストール中..."
"$VENV_DIR/bin/pip" install --upgrade pip -q
"$VENV_DIR/bin/pip" install fastapi "uvicorn[standard]" -q

# monitor.py の作成
echo "📝 [6/6] monitor.py を配置中..."
cat << 'EOF' > "$APP_DIR/monitor.py"
import subprocess
import csv
import io
import json
import uvicorn
import pwd
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Dict, Any

app = FastAPI()

# CORS設定: ブラウザや管理サーバーからのアクセスを許可
# 注意: 古いバージョンのfastapi/starletteではallow_private_networkが未対応のため削除済み
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

def resolve_uid(user_val: str) -> str:
    """UID(数値文字列)であればユーザー名に変換する"""
    if not user_val:
        return ""
    try:
        # 数値かどうかチェック
        uid = int(user_val)
        # pwdモジュールでユーザー名を取得
        return pwd.getpwuid(uid).pw_name
    except (ValueError, KeyError, OverflowError):
        # 数値でない、またはユーザーが存在しない場合はそのまま返す
        return user_val

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
            raw_user = proc.stdout.strip()
            # UIDの場合は名前に変換
            host_user = resolve_uid(raw_user)
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
        
        # User指定が "1001" や "1001:1001" の場合があるので解決する
        if config_user:
            if ":" in config_user:
                config_user = config_user.split(":")[0]
            config_user = resolve_uid(config_user)

        # --- ヒューリスティック 1: 環境変数 (研究室でよく使われる変数を優先) ---
        env_map = {}
        for e in env_list:
            if "=" in e:
                k, v = e.split("=", 1)
                env_map[k] = v
        
        # チェックする環境変数の優先順位
        target_envs = ["JUPYTERHUB_USER", "NB_USER", "SUDO_USER", "USER", "USERNAME", "OWNER", "LOGNAME", "GIT_AUTHOR_NAME"]
        for key in target_envs:
            if key in env_map:
                val = env_map[key]
                # デフォルト値っぽいものは無視
                if val and val not in ["root", "jovyan", "ubuntu", "1000", "node", "app"]:
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

# Systemdサービスの作成
echo "⚙️ [6/6] 自動起動設定を更新中..."
cat << EOF > /etc/systemd/system/gpu-monitor.service
[Unit]
Description=GPU Monitoring API Agent
After=network.target docker.service

[Service]
User=root
WorkingDirectory=$APP_DIR
ExecStart=$VENV_DIR/bin/python monitor.py
Restart=always

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable gpu-monitor
systemctl restart gpu-monitor

if command -v ufw > /dev/null; then
    ufw allow 8000/tcp > /dev/null
fi

echo "✅ セットアップ完了（ubuntu.sources も含めて全て修正しました）。"
echo "IPアドレス: $(hostname -I | awk '{print $1}')"