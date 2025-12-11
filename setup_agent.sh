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

def resolve_uid_safe(user_val: str) -> str:
    """
    UID(数値文字列)であればユーザー名に変換する。
    例外を出さないよう、pwdモジュールではなく id コマンドと条件分岐を使用。
    """
    if not user_val:
        return ""
    
    # 数値文字列かどうかチェック (isdigit)
    if str(user_val).isdigit():
        # コマンド: id -nu <uid>
        # 成功すればユーザー名が返る。失敗(存在しないUID)なら終了コードが0以外になる。
        res = subprocess.run(
            ["id", "-nu", str(user_val)], 
            capture_output=True, 
            text=True
        )
        if res.returncode == 0:
            return res.stdout.strip()
        else:
            # 変換できなければそのまま数値を返す
            return str(user_val)
            
    # 数値でなければそのまま返す
    return user_val

def extract_user_from_path_safe(path: str) -> str:
    """ /home/username/xxx から username を抽出する (例外なし版) """
    if not path:
        return ""
    if not path.startswith("/home/"):
        return ""
    
    parts = path.split("/")
    # parts -> ['', 'home', 'username', '...']
    if len(parts) >= 3:
        candidate = parts[2]
        # システム系ディレクトリや共有ディレクトリを除外
        ignore_users = [
            "ubuntu", "admin", "root", "share", "docker", "nvidia", 
            "libs", "data", "jovyan", "work", "library", "usr", "var", "bin"
        ]
        if candidate and candidate not in ignore_users:
            return candidate
    return ""

def get_docker_owner(pid: str) -> dict:
    """
    PIDからDockerコンテナの所有者と名前を特定する (try-except不使用版)
    """
    host_user = "unknown"
    container_name = ""
    
    # 0. ホストOS上のプロセス所有者を取得
    # psコマンドを実行し、終了コードを確認
    proc = subprocess.run(
        ["ps", "-o", "user=", "-p", str(pid)], 
        capture_output=True, 
        text=True
    )
    
    if proc.returncode == 0:
        raw_user = proc.stdout.strip()
        host_user = resolve_uid_safe(raw_user)
    
    # 1. cgroupからコンテナIDを取得
    container_id = None
    cgroup_path = f"/proc/{pid}/cgroup"
    
    # ファイルが存在するか確認 (openで落ちないように)
    if os.path.exists(cgroup_path):
        # ファイル読み込み（ここはOSレベルのIOエラー以外は安全と仮定）
        with open(cgroup_path, "r") as f:
            for line in f:
                if "docker" in line or "kubepods" in line:
                    parts = line.strip().split("/")
                    if parts:
                        cid = parts[-1]
                        if cid.endswith(".scope"): cid = cid[:-6]
                        if cid.startswith("docker-"): cid = cid[7:]
                        if len(cid) >= 12:
                            container_id = cid
                            break
    
    # コンテナでない場合はホストユーザーを返して終了
    if not container_id:
        final_user = host_user if host_user != "unknown" else "system"
        return {"user": final_user, "container": ""}

    # 2. docker inspectで詳細メタデータを取得
    cmd = ["docker", "inspect", "--format", "{{json .}}", container_id]
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    # コマンドが失敗したら終了
    if result.returncode != 0:
        return {"user": host_user, "container": "unknown-container"}
    
    # JSONパース (docker inspectが成功していれば通常は正しいJSONが返る前提)
    data = json.loads(result.stdout)
    
    # 辞書の .get() メソッドを多用してキーエラー回避
    container_name = data.get("Name", "").lstrip("/")
    config = data.get("Config", {})
    labels = config.get("Labels", {})
    if labels is None: labels = {} # None対策
    
    env_list = config.get("Env", [])
    if env_list is None: env_list = []
    
    # 環境変数のマップ化
    env_map = {}
    for e in env_list:
        if "=" in e:
            k, v = e.split("=", 1)
            env_map[k] = v

    # --- ヒューリスティック A: 環境変数 (研究室/Jupyter環境特有) ---
    target_envs = ["JUPYTERHUB_USER", "NB_USER", "SUDO_USER", "OWNER", "GIT_AUTHOR_NAME"]
    for key in target_envs:
        if key in env_map:
            val = env_map[key]
            # 無視リストに含まれない有効な値なら採用
            if val and val not in ["root", "jovyan", "ubuntu", "1000", "node", "app"]:
                return {"user": val, "container": container_name}

    # --- ヒューリスティック B: Bind Mounts ---
    
    # B-1. "Mounts" セクション
    mounts = data.get("Mounts", [])
    if mounts:
        for m in mounts:
            if m.get("Type") == "bind":
                src = m.get("Source", "")
                user = extract_user_from_path_safe(src)
                if user:
                    return {"user": user, "container": container_name}

    # B-2. "HostConfig.Binds" セクション
    host_config = data.get("HostConfig", {})
    if host_config:
        binds = host_config.get("Binds", [])
        if binds:
            for b in binds:
                if ":" in b:
                    src = b.split(":")[0]
                    user = extract_user_from_path_safe(src)
                    if user:
                        return {"user": user, "container": container_name}

    # --- ヒューリスティック C: HOME環境変数 ---
    home_env = env_map.get("HOME", "")
    user_from_home = extract_user_from_path_safe(home_env)
    if user_from_home:
         return {"user": user_from_home, "container": container_name}

    # --- ヒューリスティック D: Docker Labels ---
    if "com.docker.compose.project" in labels:
        return {"user": labels["com.docker.compose.project"], "container": container_name}
    if "maintainer" in labels:
        return {"user": labels["maintainer"], "container": container_name}

    # --- ヒューリスティック E: フォールバック ---
    
    # Config User
    config_user = config.get("User", "")
    if config_user:
        if ":" in config_user: 
            config_user = config_user.split(":")[0]
        resolved = resolve_uid_safe(config_user)
        if resolved not in ["root", "0", "1000"]:
            return {"user": resolved, "container": container_name}
    
    # ホストプロセスの所有者が root/unknown 以外なら採用
    if host_user not in ["root", "dockremap", "unknown"]:
        return {"user": host_user, "container": container_name}

    # 汎用ユーザー名
    for key in ["USER", "USERNAME", "LOGNAME"]:
         if key in env_map:
             return {"user": env_map[key], "container": container_name}

    return {"user": "system", "container": container_name}

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