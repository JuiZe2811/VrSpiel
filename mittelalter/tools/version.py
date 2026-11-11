#!/usr/bin/env python3
"""Setzt die Versionsnummer des Spiels.

Hängt ?v=<Version> an alle Modul-Importe und an js/main.js in index.html an,
damit Browser (z. B. der Quest-Browser) nach einem Update keine alten Dateien
aus dem Zwischenspeicher verwenden. Aufruf:  python3 tools/version.py 16
"""
import re, sys, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
v = sys.argv[1]
for f in sorted((root / 'js').glob('*.js')):
    s = f.read_text()
    s2 = re.sub(r"(from |import )'\./([\w-]+)\.js(\?v=[\w.]+)?'", lambda m: f"{m.group(1)}'./{m.group(2)}.js?v={v}'", s)
    if f.name == 'version.js':
        s2 = re.sub(r"export const VERSION = '[^']*';", f"export const VERSION = '{v}';", s2)
    if s2 != s:
        f.write_text(s2)
html = root / 'index.html'
s = html.read_text()
s = re.sub(r'src="js/main\.js(\?v=[\w.]+)?"', f'src="js/main.js?v={v}"', s)
html.write_text(s)
print('Version', v)
