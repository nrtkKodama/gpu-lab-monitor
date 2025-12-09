#!/bin/bash
# ========================================================
# GPU Monitor Tunnel Setup Script (Key-Auth Edition)
# ========================================================
# 1. 依存パッケージのインストール
# 2. SSH鍵の自動生成 (存在しない場合)
# 3. 各サーバーへの公開鍵登録 (ssh-copy-id)
# 4. Systemdサービスの登録と起動

SSH_USER="hamalab"
SSH_PASS="miharukasu"
INSTALL_DIR="$HOME/.gpu-monitor-tunnels"
SCRIPT_PATH="$INSTALL_DIR/run_tunnels.sh"
SERVICE_NAME="gpu-tunnels"

# 実行ユーザー確認
if [ "$(id -u)" -eq 0 ]; then
    echo "[WARNING] rootユーザーで実行されています。通常ユーザーでの実行を推奨します。"
    echo "続行するには Enter を押してください..."
    read dummy
fi

echo '[INFO] Installing dependencies...'
sudo apt update && sudo apt install -y autossh sshpass

echo '[INFO] creating install directory...'
mkdir -p "$INSTALL_DIR"

# --- SSH Key Generation ---
if [ ! -f ~/.ssh/id_ed25519 ]; then
    echo '[INFO] Generating SSH Key (ED25519)...'
    ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N "" -q
    echo 'Key generated.'
else
    echo '[INFO] SSH Key already exists. Skipping generation.'
fi

# --- Copy ID to Remote Servers ---
echo '[INFO] Registering public keys to remote servers...'
echo 'This may take a moment. If prompted, please verify host fingerprints.'
export SSHPASS="$SSH_PASS"

# Register key for Typhoon
sshpass -e ssh-copy-id -o StrictHostKeyChecking=no -p 22 hamalab@192.168.31.100
# Register key for Graveler
sshpass -e ssh-copy-id -o StrictHostKeyChecking=no -p 22 hamalab@192.168.31.110
# Register key for Zekrom
sshpass -e ssh-copy-id -o StrictHostKeyChecking=no -p 22 hamalab@192.168.31.120
# Register key for BigMouse
sshpass -e ssh-copy-id -o StrictHostKeyChecking=no -p 22 hamalab@192.168.31.142
# Register key for DL-BOX
sshpass -e ssh-copy-id -o StrictHostKeyChecking=no -p 22 hamalab@192.168.31.150
# Register key for Raijin
sshpass -e ssh-copy-id -o StrictHostKeyChecking=no -p 22 hamalab@133.34.30.196
# Register key for Cervo
sshpass -e ssh-copy-id -o StrictHostKeyChecking=no -p 222 hamalab@133.34.30.196
# Register key for Rotom
sshpass -e ssh-copy-id -o StrictHostKeyChecking=no -p 322 hamalab@133.34.30.196
# Register key for Chatot
sshpass -e ssh-copy-id -o StrictHostKeyChecking=no -p 22 hamalab@133.34.30.199
# Register key for Kyurem
sshpass -e ssh-copy-id -o StrictHostKeyChecking=no -p 22 hamalab@192.168.31.180

echo '[INFO] Key registration complete.'

echo '[INFO] Generating tunnel runner script...'
cat << EOF > "$SCRIPT_PATH"
#!/bin/bash
# Auto-generated runner script (Key Authentication)
export AUTOSSH_GATETIME=0
export AUTOSSH_POLL=60

# Kill old tunnels
pkill -u \$(whoami) -f "autossh.*-L 180"
sleep 2

# Start Tunnels (Native autossh without sshpass)
COMMON_OPTS="-M 0 -f -N -o StrictHostKeyChecking=no -o ServerAliveInterval=60 -o ServerAliveCountMax=3"

autossh \$COMMON_OPTS -L 18001:localhost:8000 -p 22 hamalab@192.168.31.100
echo "Started tunnel for Typhoon on port 18001"
autossh \$COMMON_OPTS -L 18002:localhost:8000 -p 22 hamalab@192.168.31.110
echo "Started tunnel for Graveler on port 18002"
autossh \$COMMON_OPTS -L 18003:localhost:8000 -p 22 hamalab@192.168.31.120
echo "Started tunnel for Zekrom on port 18003"
autossh \$COMMON_OPTS -L 18004:localhost:8000 -p 22 hamalab@192.168.31.142
echo "Started tunnel for BigMouse on port 18004"
autossh \$COMMON_OPTS -L 18005:localhost:8000 -p 22 hamalab@192.168.31.150
echo "Started tunnel for DL-BOX on port 18005"
autossh \$COMMON_OPTS -L 18006:localhost:8000 -p 22 hamalab@133.34.30.196
echo "Started tunnel for Raijin on port 18006"
autossh \$COMMON_OPTS -L 18007:localhost:8000 -p 222 hamalab@133.34.30.196
echo "Started tunnel for Cervo on port 18007"
autossh \$COMMON_OPTS -L 18008:localhost:8000 -p 322 hamalab@133.34.30.196
echo "Started tunnel for Rotom on port 18008"
autossh \$COMMON_OPTS -L 18009:localhost:8000 -p 22 hamalab@133.34.30.199
echo "Started tunnel for Chatot on port 18009"
autossh \$COMMON_OPTS -L 18010:localhost:8000 -p 22 hamalab@192.168.31.180
echo "Started tunnel for Kyurem on port 18010"
EOF

chmod 700 "$SCRIPT_PATH"

echo '[INFO] Creating Systemd Service...'
ACTUAL_USER=${SUDO_USER:-$USER}

cat << EOF | sudo tee /etc/systemd/system/$SERVICE_NAME.service
[Unit]
Description=Persistent SSH Tunnels for GPU Monitor
After=network-online.target
Wants=network-online.target

[Service]
User=$ACTUAL_USER
ExecStart=$SCRIPT_PATH
Type=oneshot
RemainAfterExit=yes
KillMode=process

[Install]
WantedBy=multi-user.target
EOF

echo '[INFO] Enabling and starting service...'
sudo systemctl daemon-reload
sudo systemctl enable $SERVICE_NAME
sudo systemctl restart $SERVICE_NAME

echo "✅ Setup Complete! Check status with: sudo systemctl status $SERVICE_NAME"