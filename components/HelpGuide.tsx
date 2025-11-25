import React from 'react';
import { Terminal, Settings, Save, Server, Shield, Globe, HelpCircle } from 'lucide-react';

const HelpGuide: React.FC<{onClose: () => void}> = ({ onClose }) => {
  return (
    <div className="bg-gray-800 rounded-xl p-8 max-w-4xl mx-auto shadow-2xl border border-gray-700 text-gray-300 leading-relaxed">
      <div className="flex justify-between items-start mb-8 border-b border-gray-700 pb-4">
        <h1 className="text-3xl font-bold text-white">システムセットアップ & デプロイガイド</h1>
        <button onClick={onClose} className="text-gray-400 hover:text-white">✕ 閉じる</button>
      </div>

      <div className="space-y-8">
        <section>
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <HelpCircle size={20} className="text-pink-400"/> よくある質問: パスワードは不要？
          </h2>
          <div className="bg-gray-700/50 p-4 rounded-lg border-l-4 border-pink-500">
            <h3 className="font-bold text-white mb-2">Q. IPアドレスだけで、ログインなしで監視できるのですか？</h3>
            <p className="mb-2">
              <strong>A. はい、可能です。</strong><br/>
              このシステムはSSHでログインするのではなく、各サーバーが自分の情報をWebサーバーとして公開する「エージェント方式」を採用しているためです。
            </p>
            <ul className="list-disc list-inside text-sm space-y-1 text-gray-300">
              <li>Webサイトを閲覧するのにパスワードが不要なのと同様に、各サーバーの状況（API）にアクセスするだけなので認証は必須ではありません。</li>
              <li>情報の「閲覧」のみが可能で、サーバーの再起動や停止などの「操作」はできないため、セキュリティリスクは限定的です。</li>
              <li>※研究室外からアクセスさせたい場合などは、VPNを通すか、別途Basic認証などをPythonスクリプトに追加することを推奨します。</li>
            </ul>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <Server size={20} className="text-blue-400"/> 1. アーキテクチャ概要
          </h2>
          <p className="mb-2">
            このアプリケーションはフロントエンド(React)です。実際のGPUデータを取得するには、各監視対象サーバーで軽量なバックエンドAPIを実行する必要があります。
          </p>
          <div className="bg-gray-900 p-4 rounded-lg font-mono text-xs overflow-x-auto border border-gray-700">
            [GPU Server 1] (Agent Running on :8000) <br/>
            &nbsp;&nbsp;↳ nvidia-smiの結果を JSON で配信 (http://192.168.1.xxx:8000/metrics) <br/>
            <br/>
            [Dashboard PC] (This App) <br/>
            &nbsp;&nbsp;↳ ブラウザが直接 各GPU Server のURLを叩いてデータを取得・表示 <br/>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <Terminal size={20} className="text-green-400"/> 2. サーバー側エージェントのセットアップ
          </h2>
          <p className="mb-4">
            各GPUサーバーで以下のPythonスクリプト(例: <code>monitor.py</code>)を実行してください。
            これにより、<code>nvidia-smi</code> と <code>docker</code> の情報をJSONで配信します。
          </p>
          <pre className="bg-black text-green-400 p-4 rounded-lg font-mono text-sm overflow-x-auto">
{`from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import subprocess
import json

app = FastAPI()

# CORS設定: ブラウザからの直接アクセスを許可
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/metrics")
def get_metrics():
    # 本来はここで nvidia-smi コマンドなどを実行してパースします
    # セキュリティ向上のため、ここにトークンチェックを入れることも可能です
    return {
        "status": "online",
        "gpus": [
            # nvidia-smiの出力結果をここにマッピング
        ]
    }

# 実行コマンド: uvicorn monitor:app --host 0.0.0.0 --port 8000`}
          </pre>
        </section>

        <section>
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <Shield size={20} className="text-orange-400"/> 3. 再起動後の永続化 (Systemd)
          </h2>
          <p className="mb-4">
            サーバー再起動後も自動的に監視エージェントが立ち上がるように、<code>systemd</code>を設定します。
            ファイル: <code>/etc/systemd/system/gpu-monitor.service</code>
          </p>
          <pre className="bg-gray-900 p-4 rounded-lg font-mono text-sm text-gray-300 border border-gray-700">
{`[Unit]
Description=GPU Monitoring API Agent
After=network.target docker.service

[Service]
User=root
WorkingDirectory=/opt/gpu-monitor
ExecStart=/usr/local/bin/uvicorn monitor:app --host 0.0.0.0 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target`}
          </pre>
          <p className="mt-2 text-sm text-gray-400">
            設定後、<code>sudo systemctl enable gpu-monitor && sudo systemctl start gpu-monitor</code> を実行してください。
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <Globe size={20} className="text-indigo-400"/> 4. Webデプロイ時の注意 (Mixed Content)
          </h2>
          <div className="bg-yellow-900/30 border border-yellow-700/50 p-4 rounded-lg">
            <h3 className="font-bold text-yellow-500 mb-2">⚠️ HTTPSとHTTPの混在について</h3>
            <p className="text-sm mb-2">
              GitHub Pages (HTTPS) から 学内のGPUサーバー (HTTP) へ直接通信することは、ブラウザのセキュリティ制限によりブロックされます。
            </p>
            <p className="text-sm font-bold mt-2">推奨されるデプロイ方法:</p>
            <ul className="list-disc list-inside text-sm ml-2 mt-1 space-y-1">
              <li><strong>方法A (推奨):</strong> 監視対象サーバーの1つでこのReactアプリをビルドし、同じネットワーク内で HTTP として配信する。</li>
              <li><strong>方法B:</strong> ローカルPCで <code>npm start</code> して利用する。</li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
};

export default HelpGuide;