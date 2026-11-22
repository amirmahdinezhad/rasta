#!/usr/bin/env python3
"""Export the installed UI skill without building an application package."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import tempfile
import zipfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--skill-dir', type=Path, default=Path.home() / '.codex/skills/crafted-shadcn-ui')
    parser.add_argument('--output-dir', type=Path, default=Path(__file__).resolve().parent.parent / 'dist/skills')
    args = parser.parse_args()
    root = args.skill_dir.resolve()
    entry = root / 'SKILL.md'
    text = entry.read_text()
    if not text.startswith('---\n'):
        raise ValueError('SKILL.md must have frontmatter.')
    name = re.search(r'^name:\s*([a-z0-9-]+)\s*$', text.split('---', 2)[1], re.M)
    if not name or name.group(1) != root.name:
        raise ValueError('Skill name must match its folder.')
    files = sorted(p for p in root.rglob('*') if p.is_file())
    for file in files:
        if file.is_symlink():
            raise ValueError(f'Export concrete skill files, not symbolic links: {file}')
        if file.suffix == '.md':
            for link in re.findall(r'\]\(([^)]+)\)', file.read_text()):
                if '://' in link or link.startswith('#'):
                    continue
                target = (file.parent / link.split('#')[0]).resolve()
                if not target.is_relative_to(root) or not target.exists():
                    raise ValueError(f'Missing or nonportable reference: {link}')
    args.output_dir.mkdir(parents=True, exist_ok=True)
    hashes = {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    manifest_path = args.output_dir / f'{root.name}.manifest.json'
    previous = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    version = previous.get('version', '1.0.0')
    if previous and previous.get('files') != hashes:
        major, minor, patch = map(int, version.split('.'))
        version = f'{major}.{minor}.{patch + 1}'
    archive = args.output_dir / f'{root.name}.zip'
    with tempfile.TemporaryDirectory(prefix='ui-skill-export-') as temp:
        candidate = Path(temp) / archive.name
        with zipfile.ZipFile(candidate, 'w', zipfile.ZIP_DEFLATED) as zipped:
            for file in files:
                info = zipfile.ZipInfo(str(file.relative_to(root.parent)), (2026, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                zipped.writestr(info, file.read_bytes())
        unpacked = Path(temp) / 'unpacked'
        with zipfile.ZipFile(candidate) as zipped:
            zipped.extractall(unpacked)
        for file in files:
            if file.read_bytes() != (unpacked / root.name / file.relative_to(root)).read_bytes():
                raise ValueError(f'Archive verification failed: {file}')
        archive.write_bytes(candidate.read_bytes())
    manifest = {'skill': root.name, 'version': version, 'files': hashes,
                'checks': ['Matching skill name', 'Portable local references', 'ZIP extraction and byte comparison']}
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Exported {root.name} {version}: {archive}')


if __name__ == '__main__':
    main()
