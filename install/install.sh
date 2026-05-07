#!/usr/bin/env bash
set -euo pipefail

REPO_OWNER="SaulgoodMan-C"
REPO_NAME="saul-image-gen"
REPO_SLUG="${REPO_OWNER}/${REPO_NAME}"
DEFAULT_API_URL="https://api.tu-zi.com/v1"
DEFAULT_MODEL="gpt-image-2"
INSTALL_DIR="${SAUL_IMAGE_GEN_DIR:-${HOME}/.codex/skills/saul-skills/${REPO_NAME}}"
INSTALL_TEMP_DIR=""

usage() {
  cat <<'EOF'
Usage: install.sh [--help]

Installs Saul Image Gen into the Codex skills directory and guides .env setup.

Environment overrides:
  SAUL_IMAGE_GEN_DIR   Custom install directory.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

say() {
  printf '%s\n' "$1"
}

need_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    say "Missing required command: $1"
    say "Install it, then run this script again."
    exit 1
  fi
}

cleanup() {
  if [[ -n "${INSTALL_TEMP_DIR:-}" ]]; then
    rm -rf "$INSTALL_TEMP_DIR"
  fi
}

download() {
  local url="$1"
  local output="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$output"
    return
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -q "$url" -O "$output"
    return
  fi
  say "Missing curl or wget. Install one of them, then run this script again."
  exit 1
}

read_value() {
  local label="$1"
  local default_value="$2"
  local secret="${3:-false}"
  local value

  if [[ ! -r /dev/tty ]]; then
    say "Interactive setup requires a terminal."
    say "Run this script from a terminal so it can ask for IMAGE_API_URL and IMAGE_API_KEY."
    exit 1
  fi

  if [[ "$secret" == "true" ]]; then
    printf '%s: ' "$label" >/dev/tty
    IFS= read -r -s value </dev/tty
    printf '\n' >/dev/tty
  elif [[ -n "$default_value" ]]; then
    printf '%s [%s]: ' "$label" "$default_value" >/dev/tty
    IFS= read -r value </dev/tty
  else
    printf '%s: ' "$label" >/dev/tty
    IFS= read -r value </dev/tty
  fi

  if [[ -z "$value" ]]; then
    printf '%s' "$default_value"
  else
    printf '%s' "$value"
  fi
}

download_archive() {
  local archive_path="$1"
  local release_url="https://github.com/${REPO_SLUG}/releases/latest/download/${REPO_NAME}.zip"
  local source_url="https://github.com/${REPO_SLUG}/archive/refs/heads/main.zip"

  if download "$release_url" "$archive_path"; then
    say "Downloaded latest release package."
    return
  fi

  say "Latest release package was not available. Falling back to main branch source package."
  download "$source_url" "$archive_path"
}

same_existing_path() {
  local left="$1"
  local right="$2"
  local left_path right_path
  left_path="$(cd "$left" 2>/dev/null && pwd -P)" || return 1
  right_path="$(cd "$right" 2>/dev/null && pwd -P)" || return 1
  [[ "$left_path" == "$right_path" ]]
}

install_files() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local repo_root
  repo_root="$(cd "${script_dir}/.." && pwd)"

  if [[ -f "${repo_root}/SKILL.md" ]] && same_existing_path "$repo_root" "$INSTALL_DIR"; then
    say "Saul Image Gen is already in the target skills directory."
    return
  fi

  need_command unzip
  local temp_dir archive_path extracted_root
  temp_dir="$(mktemp -d)"
  INSTALL_TEMP_DIR="$temp_dir"
  archive_path="${temp_dir}/${REPO_NAME}.zip"
  trap cleanup EXIT

  download_archive "$archive_path"
  unzip -q "$archive_path" -d "$temp_dir"
  extracted_root="$(find "$temp_dir" -mindepth 1 -maxdepth 1 -type d | head -n 1)"

  mkdir -p "$(dirname "$INSTALL_DIR")"
  rm -rf "${INSTALL_DIR}.tmp"
  mkdir -p "${INSTALL_DIR}.tmp"
  cp -R "${extracted_root}/." "${INSTALL_DIR}.tmp/"

  if [[ -f "${INSTALL_DIR}/.env" ]]; then
    cp "${INSTALL_DIR}/.env" "${INSTALL_DIR}.tmp/.env"
  fi

  rm -rf "$INSTALL_DIR"
  mv "${INSTALL_DIR}.tmp" "$INSTALL_DIR"
  INSTALL_TEMP_DIR=""
  rm -rf "$temp_dir"
  say "Installed to ${INSTALL_DIR}"
}

write_env() {
  local env_path="${INSTALL_DIR}/.env"
  if [[ -f "$env_path" ]]; then
    printf '.env already exists. Reconfigure it now? [y/N]: '
    local answer
    IFS= read -r answer </dev/tty
    case "$answer" in
      y|Y|yes|YES) ;;
      *)
        say "Kept existing .env."
        return
        ;;
    esac
  fi

  say ""
  say "Image API configuration"
  local api_url api_key model
  api_url="$(read_value "IMAGE_API_URL" "$DEFAULT_API_URL")"
  while true; do
    api_key="$(read_value "IMAGE_API_KEY" "" true)"
    if [[ -n "$api_key" ]]; then
      break
    fi
    say "IMAGE_API_KEY is required."
  done
  model="$(read_value "IMAGE_MODEL" "$DEFAULT_MODEL")"

  cat >"$env_path" <<EOF
[defaults]
DEFAULT_QUALITY=
DEFAULT_ASPECT_RATIO=
DEFAULT_OUTPUT_DIR=~/Desktop/images

[image-api]
IMAGE_API_KEY=${api_key}
IMAGE_API_URL=${api_url}
IMAGE_MODEL=${model}
IMAGE_WIRE_API=responses
IMAGE_REF_MODE=generations-json
EOF
  chmod 600 "$env_path" 2>/dev/null || true
  say "Wrote ${env_path}"
}

check_runtime() {
  if command -v node >/dev/null 2>&1; then
    say "Node.js found: $(node --version)"
  else
    say "Node.js was not found. Install Node.js before running image generation commands."
  fi

  if command -v npx >/dev/null 2>&1; then
    say "npx found."
  else
    say "npx was not found. It is normally installed with Node.js."
  fi
}

say "Saul Image Gen installer"
install_files
write_env
check_runtime
say ""
say "Done. Test it with:"
say "npx -y tsx \"${INSTALL_DIR}/scripts/main.ts\" --prompt \"一只戴墨镜的柴犬，赛博朋克风格\""
