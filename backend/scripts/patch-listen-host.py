#!/usr/bin/env python3
from pathlib import Path

p = Path("/var/www/business-one-platform/backend/server.js")
text = p.read_text(encoding="utf-8", errors="ignore")
old = "const server = app.listen(PORT, () => {"
new = 'const HOST = process.env.HOST || "127.0.0.1";\n    const server = app.listen(PORT, HOST, () => {'
if "app.listen(PORT, HOST" in text:
    print("already patched")
elif old not in text:
    raise SystemExit("listen pattern not found")
else:
    p.write_text(text.replace(old, new, 1), encoding="utf-8")
    print("patched listen HOST")
