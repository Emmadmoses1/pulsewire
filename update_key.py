import sys, os

OLD_KEY = '$2a$10$mdqVObTCy3dJ/mscdn./0.AscxgxHKCM0Mq.O7ApHHlKB1UVXsFy6'
NEW_KEY = sys.argv[1]
ROOT = os.path.expanduser('~/pulsewire-static')
SKIP_DIRS = {'.git', 'node_modules'}

changed = 0
for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
    for fname in filenames:
        fpath = os.path.join(dirpath, fname)
        try:
            with open(fpath, 'r', encoding='utf-8') as f:
                content = f.read()
        except (UnicodeDecodeError, PermissionError):
            continue
        if OLD_KEY in content:
            content = content.replace(OLD_KEY, NEW_KEY)
            with open(fpath, 'w', encoding='utf-8') as f:
                f.write(content)
            changed += 1
            print('Updated:', fpath)

print(f'\nDone — {changed} file(s) updated.')
