#!/usr/bin/env python3
"""
WepChat 本地静态服务器（带 CORS 头）
用法：python3 server.py [端口]   （默认 8765）

相比 python -m http.server，本脚本为所有响应添加 CORS 头，
解决 WebView / 浏览器跨域请求被拦截（CORS）的问题。
"""
import http.server
import functools
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765

class CorsHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # 允许任意来源（本地开发用）
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, X-Requested-With")
        self.send_header("Access-Control-Max-Age", "86400")
        super().end_headers()

    def do_OPTIONS(self):
        # 预检请求：直接返回 204
        self.send_response(204)
        self.end_headers()

    def log_message(self, format, *args):
        sys.stderr.write("CORS file server: %s\n" % (format % args))

handler = functools.partial(CorsHandler, directory=".")
with http.server.ThreadingHTTPServer(("0.0.0.0", PORT), handler) as httpd:
    print(f"CORS file server running at http://localhost:{PORT}/  (Ctrl+C 停止)")
    httpd.serve_forever()