#!/usr/bin/env python3
"""Open a folder of .md/.txt articles in Page Turner, served from this machine.

The folder is the library: "Add from clipboard" writes a new .md file into it,
Delete moves a file to the macOS Trash, and reading positions are kept in
reading-positions.json beside the articles. Only top-level files are listed.

Answers the same /api/files requests as the Vercel function, so the app needs
no second code path. Standard library only.
"""

import argparse
import datetime
import fcntl
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
import subprocess
import sys
import time
from urllib.parse import parse_qs, urlsplit
from urllib.request import ProxyHandler, Request, build_opener

REPO = Path(__file__).resolve().parent.parent
ARTICLES = ('.md', '.txt')
POS_FILE = 'reading-positions.json'
BODY_LIMIT = 8 * 1024 * 1024
VERSION = 1


def article_path(folder, name, allow_positions=False):
    """Resolve a bare filename inside the folder, or raise ValueError."""
    if not isinstance(name, str) or not name or name != Path(name).name or name.startswith('.'):
        raise ValueError('Expected a plain file name.')
    if not (name.lower().endswith(ARTICLES) or (allow_positions and name == POS_FILE)):
        raise ValueError('Only .md and .txt files are stored here.')
    return folder / name


def decode(data, partial=False):
    """UTF-8, or Mac Roman for files written by `pbpaste` from AppleScript (no UTF-8 locale there).

    `partial` is for a slice of a file: a character cut off at the end is not a sign of Mac Roman.
    """
    try:
        return data.decode('utf-8')
    except UnicodeDecodeError as problem:
        if partial and problem.start >= len(data) - 3:
            return data[:problem.start].decode('utf-8', errors='replace')
        return data.decode('mac_roman')


def read_text(path):
    return decode(path.read_bytes())


def title_of(path):
    try:
        with path.open('rb') as source:
            head = decode(source.read(400), partial=True)
    except (OSError, UnicodeDecodeError):
        return ''
    line = next((l for l in head.split('\n') if l.strip()), '')
    return line.lstrip('#').strip()[:110]


def listing(folder):
    files = []
    for entry in folder.iterdir():
        if entry.name.startswith('.') or not entry.name.lower().endswith(ARTICLES) or not entry.is_file():
            continue
        stat = entry.stat()
        files.append({
            'name': entry.name,
            'title': title_of(entry) or entry.stem.replace('-', ' '),
            'size': stat.st_size,
            'uploadedAt': datetime.datetime.fromtimestamp(stat.st_mtime, datetime.timezone.utc).isoformat(),
        })
    return files


def write_atomic(path, content):
    temporary = path.with_name(f'.{path.name}.{os.getpid()}.tmp')
    temporary.write_text(content, encoding='utf-8')
    temporary.replace(path)


def move_to_trash(path):
    if Path('/usr/bin/trash').exists():  # macOS 15+
        result = subprocess.run(['/usr/bin/trash', str(path)], capture_output=True, text=True)
        if result.returncode == 0:
            return
    script = f'tell application "Finder" to delete POSIX file {json.dumps(str(path))}'
    result = subprocess.run(['osascript', '-e', script], capture_output=True, text=True)
    if result.returncode != 0:
        raise OSError(result.stderr.strip() or 'Could not move the file to the Trash.')


class Handler(BaseHTTPRequestHandler):
    server_version = 'PageTurnerFolder/1.0'

    def log_message(self, *_args):
        pass

    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def reply(self, status, data, mime='application/json; charset=utf-8'):
        body = data if isinstance(data, bytes) else json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def check_host(self):
        port = self.server.server_port
        allowed = {f'127.0.0.1:{port}', f'localhost:{port}'}
        if self.headers.get('Host') not in allowed:
            raise PermissionError('Open the URL printed by openpageturner.')
        origin = self.headers.get('Origin')
        if origin and origin not in {f'http://{h}' for h in allowed}:
            raise PermissionError('Cross-origin requests are not allowed.')
        if self.headers.get('Sec-Fetch-Site') == 'cross-site':
            raise PermissionError('Cross-site requests are not allowed.')

    def handle_errors(self, action):
        try:
            self.check_host()
            action()
        except PermissionError as problem:
            self.reply(403, {'error': str(problem)})
        except ValueError as problem:
            self.reply(400, {'error': str(problem)})
        except FileNotFoundError:
            self.reply(404, {'error': 'File not found'})
        except OSError as problem:
            self.reply(500, {'error': str(problem)})

    def read_json(self):
        length = int(self.headers.get('Content-Length') or 0)
        if length > BODY_LIMIT:
            raise ValueError('That article is too large.')
        if not length:
            return {}
        if 'json' not in (self.headers.get('Content-Type') or ''):
            raise ValueError('Expected JSON.')
        try:
            return json.loads(self.rfile.read(length))
        except json.JSONDecodeError:
            raise ValueError('Expected JSON.')

    # ---- GET: the app, its assets, and /api/files ----
    def do_GET(self):
        self.handle_errors(self.get)

    def do_HEAD(self):
        self.handle_errors(self.get)

    def get(self):
        url = urlsplit(self.path)
        query = parse_qs(url.query)
        folder = self.server.folder
        if url.path == '/api/_ping':
            return self.reply(200, {'folder': str(folder), 'version': VERSION})
        if url.path == '/api/files':
            name = (query.get('filename') or [''])[0]
            if name:
                path = article_path(folder, name, allow_positions=True)
                content = read_text(path)
                return self.reply(200, {'filename': name, 'content': content})
            return self.reply(200, {'files': listing(folder)})
        if url.path.startswith('/api/'):
            return self.reply(404, {'error': 'Not found'})
        self.send_app(url.path)

    def send_app(self, path):
        build = self.server.build
        target = (build / path.lstrip('/')).resolve()
        if path in ('', '/') or build not in target.parents or not target.is_file():
            target = build / 'index.html'  # client-side routes fall back to the app
        data = target.read_bytes()
        mime = mimetypes.guess_type(target.name)[0] or 'application/octet-stream'
        if target.name == 'index.html':
            marker = json.dumps({'name': folder_label(self.server.folder)}).replace('<', '\\u003c')
            data = data.replace(b'<head>', f'<head><script>window.__PAGE_TURNER_FOLDER__={marker}</script>'.encode(), 1)
            mime = 'text/html; charset=utf-8'
        self.reply(200, data, mime)

    # ---- POST: save an article (or the positions file) ----
    def do_POST(self):
        self.handle_errors(self.post)

    def post(self):
        url = urlsplit(self.path)
        if url.path == '/api/stop':
            self.reply(200, {'stopping': True})
            self.server.shutdown_requested = True
            return
        if url.path != '/api/files':
            return self.reply(404, {'error': 'Not found'})
        body = self.read_json()
        content = body.get('content')
        if not isinstance(content, str):
            raise ValueError('Content is required')
        path = article_path(self.server.folder, body.get('filename'), allow_positions=True)
        write_atomic(path, content)
        self.reply(200, {'success': True, 'filename': path.name})

    # ---- DELETE: move an article to the Trash ----
    def do_DELETE(self):
        self.handle_errors(self.delete)

    def delete(self):
        url = urlsplit(self.path)
        if url.path != '/api/files':
            return self.reply(404, {'error': 'Not found'})
        self.read_json()
        name = (parse_qs(url.query).get('filename') or [''])[0]
        path = article_path(self.server.folder, name)
        if not path.is_file():
            raise FileNotFoundError(name)
        move_to_trash(path)
        self.reply(200, {'success': True, 'filename': name})


def folder_label(folder):
    home = Path.home()
    return '~/' + str(folder.relative_to(home)) if home in folder.parents else str(folder)


def preferred_port(folder):
    """The same folder gets the same port, so settings in localStorage persist between launches."""
    return 47000 + int(hashlib.sha256(str(folder).encode()).hexdigest(), 16) % 1000


def bind(folder, port):
    candidates = [port] if port else [preferred_port(folder), 0]
    for candidate in candidates:
        try:
            return ThreadingHTTPServer(('127.0.0.1', candidate), Handler)
        except OSError:
            if candidate == candidates[-1]:
                raise


def request(state, endpoint, method='GET'):
    opener = build_opener(ProxyHandler({}))
    with opener.open(Request(state['url'].rstrip('/') + '/api/' + endpoint, method=method), timeout=2) as response:
        return json.load(response)


def running(state_path, folder):
    try:
        state = json.loads(state_path.read_text())
        if request(state, '_ping')['folder'] == str(folder):
            return state
    except (OSError, ValueError, KeyError):
        pass
    return None


def serve(args, folder, state_path):
    server = bind(folder, args.port)
    server.daemon_threads = True
    server.folder = folder
    server.build = args.build_dir
    server.shutdown_requested = False
    state = {'url': f'http://127.0.0.1:{server.server_port}/', 'pid': os.getpid(), 'folder': str(folder)}
    temporary = state_path.with_suffix(f'.{os.getpid()}.tmp')
    temporary.write_text(json.dumps(state))
    temporary.replace(state_path)
    if args.foreground:
        print(state['url'], flush=True)
    server.timeout = 0.2
    try:
        while not server.shutdown_requested:
            server.handle_request()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        try:
            if json.loads(state_path.read_text()).get('pid') == os.getpid():
                state_path.unlink()
        except (OSError, ValueError):
            pass


def wait_gone(state_path):
    for _ in range(50):
        if not state_path.exists():
            return
        time.sleep(0.1)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('folder', nargs='?', default='.', type=Path)
    parser.add_argument('--stop', action='store_true', help="stop this folder's server")
    parser.add_argument('--status', action='store_true', help='print the URL if running')
    parser.add_argument('--no-open', action='store_true', help='print the URL without opening Chrome')
    parser.add_argument('--foreground', action='store_true', help='stay in the terminal; Ctrl-C stops')
    parser.add_argument('--port', type=int, default=0, help='0 picks a stable port for this folder')
    parser.add_argument('--build-dir', type=Path, default=REPO / 'build')
    parser.add_argument('--state-dir', type=Path, default=Path.home() / '.cache' / 'page-turner')
    parser.add_argument('--_serve', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()

    folder = args.folder.expanduser().resolve()
    if folder.is_file():
        folder = folder.parent
    args.build_dir = args.build_dir.expanduser().resolve()
    args.state_dir = args.state_dir.expanduser().resolve()
    args.state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    key = hashlib.sha256(str(folder).encode()).hexdigest()[:24]
    state_path = args.state_dir / f'{key}.json'

    if args._serve:
        serve(args, folder, state_path)
        return

    with (args.state_dir / f'{key}.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        state = running(state_path, folder)
        if args.stop:
            if state:
                try:
                    request(state, 'stop', 'POST')
                except OSError:
                    pass
                wait_gone(state_path)
            print('Page Turner stopped.' if state else 'Page Turner is not running for this folder.')
            return
        if args.status:
            print(state['url'] if state else 'Page Turner is not running for this folder.')
            return
        if not folder.is_dir():
            parser.error(f'not a directory: {folder}')
        if not (args.build_dir / 'index.html').is_file():
            parser.error(f'Build the app first: cd {REPO} && npm run build')
        if args.foreground and not state:
            fcntl.flock(lock, fcntl.LOCK_UN)
            serve(args, folder, state_path)
            return
        if not state:
            command = [sys.executable, str(Path(__file__).resolve()), str(folder), '--_serve',
                       '--port', str(args.port), '--build-dir', str(args.build_dir), '--state-dir', str(args.state_dir)]
            log_path = args.state_dir / f'{key}.log'
            with log_path.open('ab') as log:
                process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                           start_new_session=True, close_fds=True)
            for _ in range(100):
                state = running(state_path, folder)
                if state or process.poll() is not None:
                    break
                time.sleep(0.05)
            if not state:
                if process.poll() is None:
                    process.terminate()
                raise SystemExit(f'Could not start Page Turner. See {log_path}')

    print(state['url'])
    if not args.no_open:
        if sys.platform == 'darwin':
            if subprocess.run(['open', '-a', 'Google Chrome', state['url']], capture_output=True).returncode:
                subprocess.run(['open', state['url']])
        else:
            import webbrowser
            webbrowser.open(state['url'])


if __name__ == '__main__':
    main()
