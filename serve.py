#!/usr/bin/env python3
"""ILDA Laser Sim 用の簡易ローカルサーバー。LAN内の他のPCからもアクセスできます。

- /api/state : 操作画面とOBS画面で共有する設定（.state.json に保存され、再起動しても残る）
- /api/events: 設定の変更をリアルタイムで配信（Server-Sent Events）
- /api/hmr   : ページのファイルが更新されたらブラウザ側が自動リロードするためのバージョン
- serve.py 自体を書き換えると、サーバーが自動で再起動します
"""
import http.server
import json
import os
import queue
import socket
import sys
import threading
import time
from urllib.parse import parse_qs, urlparse

sys.stdout.reconfigure(line_buffering=True)
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
ROOT = os.path.dirname(os.path.abspath(__file__))
STATE_FILE = os.path.join(ROOT, ".state.json")
os.chdir(ROOT)


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


# ---------- 共有設定（チャンネルごと） ----------
lock = threading.Lock()
dirty = False
try:
    with open(STATE_FILE, encoding="utf-8") as f:
        states = json.load(f)
except (OSError, ValueError):
    states = {}


subscribers = {}  # チャンネル -> 購読中のキュー


def publish(ch, entry):
    for q in list(subscribers.get(ch, ())):
        q.put(entry)


def save_state():
    global dirty
    with lock:
        if not dirty:
            return
        data, dirty = json.dumps(states, ensure_ascii=False), False
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(data)
    os.replace(tmp, STATE_FILE)


# ---------- HMR ----------
WATCH_EXT = (".html", ".js", ".css")


def hmr_version():
    return max((os.stat(n).st_mtime_ns for n in os.listdir(ROOT)
                if n.endswith(WATCH_EXT) and not n.startswith(".")), default=0)


class Handler(http.server.SimpleHTTPRequestHandler):
    def _channel(self):
        return parse_qs(urlparse(self.path).query).get("ch", ["default"])[0]

    def _json(self, obj):
        body = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/api/state"):
            with lock:
                return self._json(states.get(self._channel(), {"v": 0, "data": None}))
        if self.path.startswith("/api/events"):
            return self._events()
        if self.path.startswith("/api/hmr"):
            return self._json({"v": str(hmr_version())})
        if os.path.basename(urlparse(self.path).path).startswith("."):
            return self.send_error(404)
        super().do_GET()

    def do_POST(self):
        global dirty
        if not self.path.startswith("/api/state"):
            return self.send_error(404)
        data = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"null")
        with lock:
            ch = self._channel()
            v = states.get(ch, {"v": 0})["v"] + 1
            states[ch] = entry = {"v": v, "data": data}
            dirty = True
        publish(ch, entry)
        self._json({"v": v})

    def _events(self):
        ch, q = self._channel(), queue.Queue()
        subscribers.setdefault(ch, set()).add(q)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        try:
            self.wfile.write(b"retry: 1000\n\n")
            with lock:
                q.put(states.get(ch, {"v": 0, "data": None}))
            while True:
                try:
                    entry = q.get(timeout=15)
                    while not q.empty():  # 溜まっていたら最新だけ送る
                        entry = q.get_nowait()
                    self.wfile.write(f"data: {json.dumps(entry)}\n\n".encode())
                except queue.Empty:
                    self.wfile.write(b": ping\n\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            subscribers[ch].discard(q)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass


def background():
    """設定を1秒ごとに保存し、serve.py が変わったら再起動する。"""
    me = os.path.abspath(__file__)
    started = os.stat(me).st_mtime_ns
    while True:
        time.sleep(1)
        try:
            save_state()
            if os.stat(me).st_mtime_ns != started:
                print("serve.py が更新されたので再起動します…")
                os.execv(sys.executable, [sys.executable, me, *sys.argv[1:]])
        except Exception as e:
            print("background error:", e)


server = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
threading.Thread(target=background, daemon=True).start()
print("ILDA Laser Sim サーバー起動中")
print(f"  このPC     : http://localhost:{PORT}/")
if ip := lan_ip():
    print(f"  同じLAN内  : http://{ip}:{PORT}/")
print(f"  OBS用(UIなし): http://localhost:{PORT}/?obs=1")
print("ファイルを保存するとブラウザが自動でリロードされます（HMR）。")
print("終了するには Ctrl+C またはこのウィンドウを閉じてください。")
try:
    server.serve_forever()
except KeyboardInterrupt:
    save_state()
