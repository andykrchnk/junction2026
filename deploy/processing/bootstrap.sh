#!/usr/bin/env bash
# One-time host bootstrap, executed as root on the GPU server.
set -euo pipefail
root_dir=/opt/junction-processing
apt-get update
apt-get install -y python3-venv
install -d -m 0700 "$root_dir" "$root_dir/releases"
python3 -m venv "$root_dir/ansible"
"$root_dir/ansible/bin/pip" install --disable-pip-version-check -r "$(dirname "$0")/requirements.txt"
install -m 0700 "$(dirname "$0")/receive.py" "$root_dir/receive.py"
