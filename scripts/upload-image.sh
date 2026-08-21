#!/usr/bin/env bash
# Uploads a local file into the os-deployment-images R2 bucket at the given key.
# Usage: scripts/upload-image.sh <local-file> <r2-key>
# Example: scripts/upload-image.sh ./install-trimmed.wim windows-11/sources/install.wim
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <local-file> <r2-key>" >&2
  exit 1
fi

r2_key="$2"
bucket="os-deployment-images"

if [[ ! -f "$1" ]]; then
  echo "File not found: $1" >&2
  exit 1
fi
local_file="$(realpath "$1")"

(cd "$(dirname "$0")/../worker" && npx wrangler r2 object put \
  "${bucket}/${r2_key}" \
  --file "${local_file}" \
  --remote)

echo "Uploaded ${local_file} -> r2://${bucket}/${r2_key}"
