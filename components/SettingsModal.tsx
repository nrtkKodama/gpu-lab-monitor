import React, { useState, useEffect } from 'react';
import { ServerConfig } from '../types';
import { getBackendUrl, setBackendUrl } from '../services/mockData';
import { Download, Upload, Copy, Check, Terminal, Save, X, XCircle, ArrowRightLeft, ShieldCheck, Key, Play, Cloud } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  servers: ServerConfig[];
  onImport: (servers: ServerConfig[]) => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, servers, onImport }) => {
  const [sshUser, setSshUser] = useState('hamalab');
  const [sshPass, setSshPass] = useState('');
  const [backendUrl, setBackendUrlState] = useState('');
  const [copied, setCopied] = useState(false);
  const [scriptCopied, setScriptCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setBackendUrlState(getBackendUrl());
    }
  }, [isOpen]);

  const handleSaveBackendUrl = () => {
    setBackendUrl(backendUrl.trim());
    alert("バックエンドURL設定を保存しました。");
  };

  if (!isOpen) return null;

  // ローカルポートの開始番号
  const START_PORT = 18001;

  const generateSshConfig = () => {
    if (servers.length === 0) return "# サーバーが登録されていません";
    
    let config = "# ==========================================\n";
    config += "# GPU Monitor SSH Tunnel Config\n";
    config += "# Copy this to your ~/.ssh/config\n";
    config += "# ==========================================\n\n";

    return config + servers.map((s, idx) => {
      const hostAlias = s.name.replace(/\s+/g, '-');
      let remoteHost = s.originalIp || s.ip;
      if (remoteHost.includes(':')) remoteHost = remoteHost.split(':')[0];

      const localPort = START_PORT + idx;
      const sshPort = s.sshPort || 22;

      return `Host ${hostAlias}
    HostName ${remoteHost}
    User ${sshUser}
    Port ${sshPort}
    LocalForward ${localPort} localhost:8000
`;
    }).join('\n');
  };

  const generateAutoConnectScript = () => {
    if (servers.length === 0) return "# サーバーが登録されていません";
    
    // パスワードのエスケープ処理
    const escapedPass = sshPass.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$');
    
    const lines = [
        "#!/bin/bash",
        "# ========================================================",
        "# GPU Monitor Tunnel Setup Script (Key-Auth Edition)",
        "# ========================================================",
        "# 1. 依存パッケージのインストール",
        "# 2. SSH鍵の自動生成 (存在しない場合)",
        "# 3. 各サーバーへの公開鍵登録 (ssh-copy-id)",
        "# 4. Systemdサービスの登録と起動",
        "",
        `SSH_USER="${sshUser}"`,
        `SSH_PASS="${escapedPass}"`,
        `INSTALL_DIR="$HOME/.gpu-monitor-tunnels"`,
        `SCRIPT_PATH="$INSTALL_DIR/run_tunnels.sh"`,
        `SERVICE_NAME="gpu-tunnels"`,
        "",
        "# 実行ユーザー確認",
        "if [ \"$(id -u)\" -eq 0 ]; then",
        "    echo \"[WARNING] rootユーザーで実行されています。通常ユーザーでの実行を推奨します。\"",
        "    echo \"続行するには Enter を押してください...\"",
        "    read dummy",
        "fi",
        "",
        "echo '[INFO] Installing dependencies...'",
        "sudo apt update && sudo apt install -y autossh sshpass",
        "",
        "echo '[INFO] creating install directory...'",
        "mkdir -p \"$INSTALL_DIR\"",
        "",
        "# --- SSH Key Generation ---",
        "if [ ! -f ~/.ssh/id_ed25519 ]; then",
        "    echo '[INFO] Generating SSH Key (ED25519)...'",
        "    ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N \"\" -q",
        "    echo 'Key generated.'",
        "else",
        "    echo '[INFO] SSH Key already exists. Skipping generation.'",
        "fi",
        "",
        "# --- Copy ID to Remote Servers ---",
        "echo '[INFO] Registering public keys to remote servers...'",
        "echo 'This may take a moment. If prompted, please verify host fingerprints.'",
        "export SSHPASS=\"$SSH_PASS\"",
        ""
    ];

    // 公開鍵登録ループ
    servers.forEach((s) => {
        let remoteHost = s.originalIp || s.ip;
        if (remoteHost.includes(':')) remoteHost = remoteHost.split(':')[0];
        const sshPort = s.sshPort || 22;
        
        lines.push(`# Register key for ${s.name}`);
        lines.push(`sshpass -e ssh-copy-id -o StrictHostKeyChecking=no -p ${sshPort} ${sshUser}@${remoteHost}`);
    });

    lines.push("");
    lines.push("echo '[INFO] Key registration complete.'");
    lines.push("");

    // ランナースクリプト生成 (sshpassを除去し、純粋なautosshにする)
    lines.push("echo '[INFO] Generating tunnel runner script...'");
    lines.push("cat << EOF > \"$SCRIPT_PATH\"");
    lines.push("#!/bin/bash");
    lines.push("# Auto-generated runner script (Key Authentication)");
    lines.push("export AUTOSSH_GATETIME=0");
    lines.push("export AUTOSSH_POLL=60");
    lines.push("");
    lines.push("# Kill old tunnels");
    lines.push("pkill -u \\$(whoami) -f \"autossh.*-L 180\"");
    lines.push("sleep 2");
    lines.push("");
    lines.push("# Start Tunnels (Native autossh without sshpass)");
    lines.push(`COMMON_OPTS="-M 0 -f -N -o StrictHostKeyChecking=no -o ServerAliveInterval=60 -o ServerAliveCountMax=3"`);
    lines.push("");

    // トンネル起動ループ
    servers.forEach((s, idx) => {
        let remoteHost = s.originalIp || s.ip;
        if (remoteHost.includes(':')) remoteHost = remoteHost.split(':')[0];
        const localPort = START_PORT + idx;
        const sshPort = s.sshPort || 22;
        
        // ここで sshpass は使わず、autossh を直接叩く
        lines.push(`autossh \\$COMMON_OPTS -L ${localPort}:localhost:8000 -p ${sshPort} ${sshUser}@${remoteHost}`);
        lines.push(`echo "Started tunnel for ${s.name} on port ${localPort}"`);
    });
    
    lines.push("EOF");
    lines.push("");
    
    // chmod 700 (実行可能) に設定
    lines.push("chmod 700 \"$SCRIPT_PATH\"", "");

    // Systemd Service Generation
    lines.push("echo '[INFO] Creating Systemd Service...'");
    lines.push("ACTUAL_USER=${SUDO_USER:-$USER}");
    lines.push("");
    lines.push(`cat << EOF | sudo tee /etc/systemd/system/$SERVICE_NAME.service`);
    lines.push("[Unit]");
    lines.push("Description=Persistent SSH Tunnels for GPU Monitor");
    lines.push("After=network-online.target");
    lines.push("Wants=network-online.target");
    lines.push("");
    lines.push("[Service]");
    lines.push("User=$ACTUAL_USER");
    lines.push(`ExecStart=$SCRIPT_PATH`);
    lines.push("Type=oneshot");
    lines.push("RemainAfterExit=yes");
    lines.push("KillMode=process");
    lines.push("");
    lines.push("[Install]");
    lines.push("WantedBy=multi-user.target");
    lines.push("EOF");
    lines.push("");

    // Enable and Start
    lines.push("echo '[INFO] Enabling and starting service...'");
    lines.push("sudo systemctl daemon-reload");
    lines.push(`sudo systemctl enable $SERVICE_NAME`);
    lines.push(`sudo systemctl restart $SERVICE_NAME`);
    lines.push("");
    lines.push(`echo "✅ Setup Complete! Check status with: sudo systemctl status $SERVICE_NAME"`);

    return lines.join("\n");
  };

  const handleCopy = (text: string, setCopiedState: (v: boolean) => void) => {
    navigator.clipboard.writeText(text);
    setCopiedState(true);
    setTimeout(() => setCopiedState(false), 2000);
  };

  const handleConvertToTunnelMode = () => {
    if (servers.length === 0) return;
    
    if (!confirm(
        "現在のサーバー設定を「SSHトンネルモード」に変換しますか？\n\n" +
        "これにより、登録されているIPアドレスが全て 'localhost:18xxx' に書き換わります。\n" +
        "※元のIPアドレスは保持され、接続時に優先的に試行されます。"
    )) {
      return;
    }

    const newConfigs = servers.map((s, idx) => {
      const localPort = START_PORT + idx;
      
      const isLocalhost = s.ip.includes('localhost') || s.ip.includes('127.0.0.1');
      const originalIp = isLocalhost ? s.originalIp : s.ip;

      return {
        id: s.id,
        name: s.name,
        ip: `localhost:${localPort}`,
        originalIp: originalIp,
        sshPort: s.sshPort || 22
      };
    });

    onImport(newConfigs);
    alert("設定を更新しました。優先順位: [1. 元のIP] -> [2. トンネル(localhost)] の順で接続を試みます。");
    onClose();
  };

  const handleExport = () => {
    const dataStr = JSON.stringify(servers, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const exportFileDefaultName = `gpu-monitor-servers-${new Date().toISOString().slice(0, 10)}.json`;

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileReader = new FileReader();
    const files = event.target.files;
    setError(null);
    
    if (files && files.length > 0) {
      fileReader.readAsText(files[0], "UTF-8");
      fileReader.onload = (e) => {
        try {
          const result = e.target?.result;
          if (typeof result === 'string') {
            const parsed = JSON.parse(result);
            if (Array.isArray(parsed)) {
              const valid = parsed.every(item => item.name && item.ip);
              if (valid) {
                onImport(parsed);
                alert(`${parsed.length} 件のサーバー設定をインポートしました。`);
                onClose();
              } else {
                setError("JSON形式が不正です。");
              }
            } else {
              setError("JSONは配列形式（[]）である必要があります。");
            }
          }
        } catch (err) {
            setError("JSONファイルの読み込みに失敗しました。");
        }
      };
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-gray-800 rounded-xl w-full max-w-3xl border border-gray-700 shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-6 border-b border-gray-700 flex justify-between items-center">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Save size={24} className="text-purple-400" />
            設定 & バックアップ
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-8 custom-scrollbar">
          
          {/* Backend Connection Config */}
          <section>
            <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                <Cloud size={20} className="text-blue-400"/>
                リモート接続設定 (GitHub Pages用)
            </h3>
            <div className="bg-gray-700/30 rounded-lg p-5 border border-gray-600/50">
               <p className="text-sm text-gray-300 mb-4">
                 外部ネットワーク（スマートフォン等）から GitHub Pages で閲覧する場合、
                 研究室内のサーバーをインターネットに公開し、そのURLをここに設定してください。
                 <br/><span className="text-xs text-gray-500">(例: Cloudflare Tunnel や ngrok のURL)</span>
               </p>
               <div className="flex gap-2">
                 <input 
                   type="text" 
                   placeholder="https://my-lab-monitor.trycloudflare.com"
                   className="flex-1 bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 font-mono"
                   value={backendUrl}
                   onChange={(e) => setBackendUrlState(e.target.value)}
                 />
                 <button 
                   onClick={handleSaveBackendUrl}
                   className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-bold"
                 >
                   保存
                 </button>
               </div>
               <p className="text-xs text-orange-400 mt-2">
                 ※ 空欄の場合は、ブラウザがアプリと同じ場所にあるサーバー(localhost:3000)へ接続を試みます。
               </p>
            </div>
          </section>

          <hr className="border-gray-700" />

          {/* SSH Config Section */}
          <section>
             <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                <Terminal size={20} className="text-orange-400"/>
                SSHポートフォワーディング (全自動セットアップ)
            </h3>
            <div className="bg-gray-700/30 rounded-lg p-5 border border-gray-600/50">
              <p className="text-sm text-gray-300 mb-4">
                 OS起動時に自動でトンネルを確立するセットアップスクリプトを生成します。<br/>
                 <span className="text-green-400 font-bold">New: 鍵生成とサーバー登録も自動で行います。</span>
              </p>

              <div className="flex flex-col sm:flex-row gap-4 mb-6">
                  <div className="flex-1">
                    <label className="text-xs text-gray-400 block mb-1">SSH Username</label>
                    <input 
                        type="text" 
                        value={sshUser}
                        onChange={(e) => setSshUser(e.target.value)}
                        className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 font-mono"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-gray-400 block mb-1">SSH Password (For Key Registration)</label>
                    <div className="relative">
                        <input 
                            type="password" 
                            value={sshPass}
                            onChange={(e) => setSshPass(e.target.value)}
                            placeholder="鍵登録のために一度だけ使います"
                            className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 font-mono pr-8"
                        />
                        <Key size={14} className="absolute right-3 top-2.5 text-gray-500"/>
                    </div>
                  </div>
              </div>

              {/* Tabs or Split View for Configs */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Standard Config */}
                  <div className="relative group">
                      <div className="text-xs font-bold text-gray-400 mb-1 flex justify-between">
                          <span>~/.ssh/config</span>
                          <span className="text-gray-600 font-normal">Optional</span>
                      </div>
                      <pre className="bg-black/80 p-3 rounded-lg text-xs font-mono text-gray-300 h-40 overflow-y-auto border border-gray-700 whitespace-pre-wrap">
                          {generateSshConfig()}
                      </pre>
                      <button 
                          onClick={() => handleCopy(generateSshConfig(), setCopied)}
                          className="absolute top-7 right-2 p-1.5 bg-gray-700/80 hover:bg-gray-600 rounded text-gray-300 hover:text-white transition-all backdrop-blur-sm"
                          title="Copy Config"
                      >
                          {copied ? <Check size={14} className="text-green-400"/> : <Copy size={14}/>}
                      </button>
                  </div>

                  {/* Auto Script */}
                  <div className="relative group">
                      <div className="text-xs font-bold text-blue-400 mb-1 flex justify-between">
                          <span className="flex items-center gap-1"><Play size={10}/> setup_tunnels.sh</span>
                          <span className="text-gray-500 font-normal">Full Auto Installer</span>
                      </div>
                      <pre className="bg-blue-900/10 p-3 rounded-lg text-xs font-mono text-blue-100 h-40 overflow-y-auto border border-blue-900/30 whitespace-pre-wrap">
                          {generateAutoConnectScript()}
                      </pre>
                      <button 
                          onClick={() => handleCopy(generateAutoConnectScript(), setScriptCopied)}
                          className="absolute top-7 right-2 p-1.5 bg-blue-900/50 hover:bg-blue-700 rounded text-blue-200 hover:text-white transition-all backdrop-blur-sm"
                          title="Copy Script"
                      >
                          {scriptCopied ? <Check size={14} className="text-green-400"/> : <Copy size={14}/>}
                      </button>
                  </div>
              </div>

              <div className="bg-black/20 p-4 rounded-lg border border-gray-600/30 mt-4">
                 <h4 className="text-sm font-bold text-blue-400 mb-2 flex items-center gap-2">
                   <ArrowRightLeft size={16}/> アプリ設定の自動更新
                 </h4>
                 <p className="text-xs text-gray-400 mb-3">
                   トンネル接続確立後、以下のボタンを押すとアプリの設定を <code>localhost</code> 経由に更新します。
                 </p>
                 <button 
                    onClick={handleConvertToTunnelMode}
                    className="w-full py-2 bg-orange-700/80 hover:bg-orange-600 text-white rounded text-sm font-bold transition-colors flex items-center justify-center gap-2"
                 >
                    <ShieldCheck size={16}/>
                    Update IPs to Localhost (Tunnel Mode)
                 </button>
              </div>
            </div>
          </section>

          <hr className="border-gray-700" />

          {/* Backup / Restore Section */}
          <section>
            <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                <Download size={20} className="text-green-400"/>
                設定データの保存・復元
            </h3>
            <div className="bg-gray-700/30 rounded-lg p-4 border border-gray-600/50">
              <div className="flex flex-col sm:flex-row gap-4">
                  <button 
                      onClick={handleExport}
                      className="flex-1 flex items-center justify-center gap-2 bg-gray-700 hover:bg-gray-600 text-white py-3 px-4 rounded-lg border border-gray-600 transition-colors font-medium"
                  >
                      <Download size={18} />
                      Export JSON
                  </button>
                  
                  <div className="flex-1 relative group">
                      <input 
                          type="file" 
                          accept=".json"
                          onChange={handleImport}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                      />
                      <button className="w-full flex items-center justify-center gap-2 bg-blue-600 group-hover:bg-blue-500 text-white py-3 px-4 rounded-lg transition-colors font-medium shadow-lg shadow-blue-900/20">
                          <Upload size={18} />
                          Import JSON
                      </button>
                  </div>
              </div>
              {error && (
                <div className="mt-3 p-2 bg-red-900/30 text-red-300 text-sm rounded border border-red-800/50 flex items-center gap-2">
                  <XCircle size={14} /> {error}
                </div>
              )}
            </div>
          </section>

        </div>
      </div>
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(31, 41, 55, 0.5); 
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(75, 85, 99, 0.8); 
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(107, 114, 128, 1); 
        }
      `}</style>
    </div>
  );
};

export default SettingsModal;