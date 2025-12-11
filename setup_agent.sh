#!/bin/bash
set -e

# ルート権限チェック
if [ "$EUID" -ne 0 ]; then
  echo "❌ エラー: sudo で実行してください。"
  exit 1
fi

APP_DIR="/opt/gpu-monitor"
VENV_DIR="$APP_DIR/venv"

# OSのコードネーム取得 (focal, jammy, noble, oracular など)
. /etc/os-release
CODENAME=$VERSION_CODENAME

echo "=========================================="
echo "🚀 GPU Lab Monitor スマートセットアップ"
echo "Target OS: Ubuntu $VERSION_ID ($CODENAME)"
echo "=========================================="

# ---------------------------------------------------------
# 関数: sources.list を生成する
# ---------------------------------------------------------
generate_sources() {
    local domain=$1
    echo "   -> リポジトリ設定を $domain に書き換えています..."
    
    # 既存の設定を退避
    if [ ! -f /etc/apt/sources.list.bak ]; then
        cp /etc/apt/sources.list /etc/apt/sources.list.bak
    fi

    # 新しいリストを作成
    cat << EOF > /etc/apt/sources.list
deb http://${domain}/ubuntu/ ${CODENAME} main restricted universe multiverse
deb http://${domain}/ubuntu/ ${CODENAME}-updates main restricted universe multiverse
deb http://${domain}/ubuntu/ ${CODENAME}-backports main restricted universe multiverse
deb http://security.ubuntu.com/ubuntu/ ${CODENAME}-security main restricted universe multiverse
EOF

    # securityリポジトリの調整 (EOLの場合はsecurityもold-releasesに向ける)
    if [ "$domain" == "old-releases.ubuntu.com" ]; then
        sed -i 's/security.ubuntu.com/old-releases.ubuntu.com/g' /etc/apt/sources.list
    fi

    # 競合を防ぐため sources.list.d 内の余計な設定を無効化
    if [ -d /etc/apt/sources.list.d ]; then
        find /etc/apt/sources.list.d/ -name "*.list" -type f -exec mv {} {}.disabled 2>/dev/null || true
        find /etc/apt/sources.list.d/ -name "*.sources" -type f -exec mv {} {}.disabled 2>/dev/null || true
    fi
}

# ---------------------------------------------------------
# ステップ 1: リポジトリの自動修復ロジック
# ---------------------------------------------------------
echo "🔧 [1/6] パッケージリポジトリを最適化中..."

# 試行1: 現役サーバー設定 (archive.ubuntu.com)
echo "   [試行 1] 標準リポジトリ (archive.ubuntu.com) で接続テスト..."
generate_sources "archive.ubuntu.com"

# 更新を試みる。エラーが出たら変数に格納（スクリプトは停止させない）
if apt-get update -o Acquire::Retries=1; then
    echo "   ✅ 接続成功！このOSは現役サポート期間内です。"
else
    echo "   ⚠️ 標準リポジトリへの接続に失敗しました (404 Not Found の可能性)。"
    echo "   🔄 [試行 2] EOLリポジトリ (old-releases.ubuntu.com) に切り替えます..."
    
    # 試行2: EOLサーバー設定 (old-releases.ubuntu.com)
    generate_sources "old-releases.ubuntu.com"
    
    if apt-get update -o Acquire::Retries=1; then
        echo "   ✅ 接続成功！このOSはサポート終了済み(EOL)のため、アーカイブを使用します。"
    else
        echo "   ⚠️ 警告: 全てのリポジトリ更新に失敗しました。外部接続を確認してください。"
        echo "   ✋ エラーを無視してインストールを強行します..."
    fi
fi

# ---------------------------------------------------------
# ステップ 2: パッケージインストール
# ---------------------------------------------------------
echo "⬇️  [2/6] 必要なパッケージをインストール中..."
# エラーがあっても無視して進む (|| true)
apt-get install -y python3 python3-pip python3-venv || true

# ---------------------------------------------------------
# ステップ 3: アプリケーション配置
# ---------------------------------------------------------
echo "📂 [3/6] ディレクトリと仮想環境の準備..."
mkdir -p "$APP_DIR"

if [ ! -d "$VENV_DIR" ]; then
    python3 -m venv "$VENV_DIR"
else
    echo "   -> 既存の仮想環境を使用します"
fi

echo "⬇️  [4/6] Pythonライブラリをインストール中..."
"$VENV_DIR/bin/pip" install --upgrade pip -q
"$VENV_DIR/bin/pip" install fastapi "uvicorn[standard]" -q

echo "📝 [5/6] monitor.py を作成中..."
# バグ修正済みコード (allow_private_network 削除版)
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
    環境変数、マウントパス、ラベル、ホストプロセス所有者などを複合的にチェックして「真のユーザー」を探します。
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

        # 環境変数のマップ化
        env_map = {}
        for e in env_list:
            if "=" in e:
                k, v = e.split("=", 1)
                env_map[k] = v

        # --- ヒューリスティック 1: 研究室特有の環境変数 ---
        target_envs = ["JUPYTERHUB_USER", "NB_USER", "SUDO_USER", "USER", "USERNAME", "OWNER", "LOGNAME", "GIT_AUTHOR_NAME"]
        for key in target_envs:
            if key in env_map:
                val = env_map[key]
                # 無視リストに含まれない有効な値なら採用
                if val and val not in ["root", "jovyan", "ubuntu", "1000", "node", "app"]:
                    return {"user": val, "container": name}

        # --- ヒューリスティック 2: Bind Mounts (強力) ---
        # マウント元が /home/ユーザー名 であれば、そのユーザーとみなす
        mounts = data.get("Mounts", [])
        for m in mounts:
            if m.get("Type") == "bind":
                src = m.get("Source", "")
                if src.startswith("/home/"):
                    parts = src.split("/")
                    # /home/user -> ['', 'home', 'user']
                    if len(parts) >= 3:
                        candidate = parts[2]
                        if candidate and candidate not in ["ubuntu", "admin", "root", "share", "docker", "nvidia"]:
                            return {"user": candidate, "container": name}

        # --- ヒューリスティック 3: HOME環境変数 ---
        # コンテナ内のHOMEが /home/tanaka のような場合
        home_env = env_map.get("HOME", "")
        if home_env.startswith("/home/"):
             parts = home_env.split("/")
             if len(parts) >= 3:
                candidate = parts[2]
                if candidate not in ["jovyan", "ubuntu", "root", "node"]:
                    return {"user": candidate, "container": name}

        # --- ヒューリスティック 4: Docker Labels ---
        # docker-composeのプロジェクト名はユーザー名であることが多い
        if "com.docker.compose.project" in labels:
            return {"user": labels["com.docker.compose.project"], "container": name}
        if "maintainer" in labels:
            return {"user": labels["maintainer"], "container": name}
        if "user" in labels:
            return {"user": labels["user"], "container": name}

        # --- ヒューリスティック 5: ホストプロセスの所有者 ---
        # root以外のユーザーがコンテナを起動している場合、それが最も正確
        if host_user not in ["root", "dockremap", "unknown"]:
            return {"user": host_user, "container": name}

        # --- ヒューリスティック 6: フォールバック ---
        # ここまで来たら Config User か、以前無視した汎用ユーザー(jovyan等)を使う
        if config_user and config_user not in ["root", "0", "1000"]:
            return {"user": config_user, "container": name}
            
        # 最終手段: Jovyanなどが環境変数にあればそれを使う
        for key in ["JUPYTERHUB_USER", "NB_USER", "USER"]:
            if key in env_map and env_map[key]:
                return {"user": env_map[key], "container": name}

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


# ---------------------------------------------------------
# ステップ 4: サービス登録
# ---------------------------------------------------------
echo "⚙️ [6/6] 自動起動設定..."

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

echo ""
echo "✅ セットアップ完了！"
echo "-----------------------------------------------------"
echo "IPアドレス: $(hostname -I | awk '{print $1}')"
echo "-----------------------------------------------------"