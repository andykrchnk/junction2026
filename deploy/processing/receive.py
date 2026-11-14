#!/usr/bin/python3
"""Forced SSH command: receive one release archive and run Ansible locally."""
import fcntl
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path('/opt/junction-processing')
command = os.environ.get('SSH_ORIGINAL_COMMAND', '')
match = re.fullmatch(r'deploy ([0-9a-f]{40})', command)
if not match:
    sys.exit('Expected deploy followed by a full commit SHA')
sha = match.group(1)
with (ROOT/'deployment.lock').open('w') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    with tempfile.TemporaryDirectory(prefix='incoming-', dir=ROOT) as temporary:
        incoming = Path(temporary)
        archive_path = incoming/'release.tar'
        total = 0
        with archive_path.open('wb') as output:
            while chunk := sys.stdin.buffer.read(1024*1024):
                total += len(chunk)
                if total > 32*1024*1024:
                    sys.exit('Release archive too large')
                output.write(chunk)
        source = incoming/'source'
        source.mkdir()
        with tarfile.open(archive_path) as archive:
            members = archive.getmembers()
            for item in members:
                path = Path(item.name)
                if path.is_absolute() or '..' in path.parts or not (item.isfile() or item.isdir()):
                    sys.exit('Unsafe archive entry')
                if not (item.name.startswith('packages/processing/') or item.name.startswith('deploy/processing/') or item.name in ('packages', 'packages/processing', 'deploy', 'deploy/processing')):
                    sys.exit('Unexpected release path')
            if sum(item.size for item in members) > 64*1024*1024:
                sys.exit('Expanded release too large')
            archive.extractall(source, filter='data')
        destination = ROOT/'releases'/sha
        if not destination.exists():
            source.rename(destination)
        result = subprocess.run([str(ROOT/'ansible/bin/ansible-playbook'), '-i', 'localhost,', '-c', 'local',
            str(destination/'deploy/processing/deploy.yml'), '-e', 'release_sha='+sha,
            '-e', 'release_dir='+str(destination)], cwd=destination)
        sys.exit(result.returncode)
