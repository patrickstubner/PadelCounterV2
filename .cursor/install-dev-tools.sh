#!/usr/bin/env bash
# Idempotentes Install-Skript für Cursor Cloud Agent VMs.
# Aufruf aus der Repo-Wurzel: bash .cursor/install-dev-tools.sh
# Kein curl|bash, keine Secrets, keine Agent-Configs ändern.
# Weitere Tools: unten im Block «Weitere Tools (Erweiterung)» Version, URL und SHA-256 ergänzen.
#
# Paketmanager: npm (package-lock.json), pnpm (pnpm-lock.yaml, Version aus packageManager)
# oder kein Install, wenn kein Lockfile da ist. Node: engines in package.json, sonst >= 22.
set -euo pipefail

ROOT="$(pwd)"
PREFIX="${HOME}/.local"
BIN="${PREFIX}/bin"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$BIN"
export PATH="${BIN}:${PATH}"

# --- Gepinnte Versionen (offizielle GitHub-Releases, Stand 15./16.11.2026) ---
RG_VERSION="14.1.1"
RG_URL="https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/ripgrep-14.1.1-x86_64-unknown-linux-musl.tar.gz"
RG_SHA256="4cf9f2741e6c465ffdb7c26f38056a59e2a2544b51f7cc128ef28337eeae4d8e"

ASTGREP_VERSION="0.51.2"
ASTGREP_URL="https://github.com/ast-grep/ast-grep/releases/download/0.51.2/app-x86_64-unknown-linux-musl.zip"
ASTGREP_SHA256="7263b2f3dbfa4a4ae4512932ffa75ccd86451db17646bd1640a4b21e4b3558d8"

CBM_VERSION="0.12.1"
CBM_SUMS_URL="https://github.com/DeusData/codebase-memory-mcp/releases/download/v0.12.1/checksums.txt"
CBM_SUMS_SHA256="103ddf75ccbe4e4de9faa57f074ee5f16b88edab6fd2f7dfd34e50d147dddffe"
CBM_ARCHIVE="codebase-memory-mcp-linux-amd64-portable.tar.gz"
CBM_URL="https://github.com/DeusData/codebase-memory-mcp/releases/download/v0.12.1/${CBM_ARCHIVE}"
CBM_SHA256="8c3d0341064301e78ecc84cf7348d4e2c6562a0f57448243ea560aaa34de36c1"

download_https() {
  local url="$1" dest="$2"
  case "$url" in
    https://*) ;;
    *) echo "error: nur HTTPS erlaubt: $url" >&2; return 1 ;;
  esac
  curl -fsSL --proto '=https' --proto-redir '=https' --max-redirs 5 --retry 3 --retry-delay 2 -o "$dest" "$url"
}

verify_sha256() {
  local file="$1" expected="$2"
  local actual
  actual="$(sha256sum "$file" | awk '{print $1}')"
  if [[ "$actual" != "$expected" ]]; then
    echo "error: Prüfsumme stimmt nicht für $file" >&2
    echo "erwartet: $expected" >&2
    echo "ist:      $actual" >&2
    return 1
  fi
}

install_binary() {
  # Nur ~/.local/bin. Kein sudo, kein /usr/local/bin (CA-1).
  local src="$1" name="$2"
  install -m 0755 "$src" "${BIN}/${name}"
}

ensure_path() {
  local line='export PATH="$HOME/.local/bin:$PATH"'
  local marker='# cursor-cloud-dev-tools'
  for rc in "${HOME}/.profile" "${HOME}/.bashrc"; do
    if [[ -f "$rc" ]] && grep -q 'cursor-cloud-dev-tools' "$rc"; then
      continue
    fi
    printf '\n%s\n%s\n' "$marker" "$line" >> "$rc"
  done
}

tool_ok() {
  local cmd="$1" version="$2"
  command -v "$cmd" >/dev/null 2>&1 || return 1
  "$cmd" --version 2>/dev/null | grep -Fq "$version"
}

extract_named_bin() {
  find "$1" -type f -name "$2" ! -name '*.md' ! -name '*.txt' | head -n 1
}

require_node() {
  if ! command -v node >/dev/null 2>&1; then
    echo "error: Node.js fehlt. Bitte Node in der Cloud-Umgebung bereitstellen (siehe engines in package.json bzw. .nvmrc). Dieses Skript installiert Node nicht." >&2
    exit 1
  fi
  if [[ -f "${ROOT}/package.json" ]]; then
    if ! node -e '
const fs = require("fs");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const eng = (pkg.engines && pkg.engines.node) || ">=22";
const [maj, min, pat] = process.versions.node.split(".").map((n) => parseInt(n, 10));
const m = /^(>=|>|=)?\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(eng));
if (!m) process.exit(0);
const needMaj = parseInt(m[2], 10);
const needMin = parseInt(m[3] || "0", 10);
const needPat = parseInt(m[4] || "0", 10);
const op = m[1] || ">=";
const cmp = maj - needMaj || min - needMin || pat - needPat;
const ok = op === ">" ? cmp > 0 : op === "=" ? cmp === 0 : cmp >= 0;
if (!ok) {
  console.error("error: Node " + process.versions.node + " erfüllt engines.node \"" + eng + "\" nicht.");
  process.exit(1);
}
'; then
      exit 1
    fi
  fi
  echo "Node $(node -v) ist vorhanden."
}

# --- ripgrep ---
if tool_ok rg "$RG_VERSION"; then
  echo "ripgrep ${RG_VERSION} bereits vorhanden, übersprungen."
else
  echo "Installiere ripgrep ${RG_VERSION}…"
  download_https "$RG_URL" "${TMP}/rg.tar.gz"
  verify_sha256 "${TMP}/rg.tar.gz" "$RG_SHA256"
  mkdir -p "${TMP}/rg"
  tar -xzf "${TMP}/rg.tar.gz" -C "${TMP}/rg"
  RG_BIN="$(extract_named_bin "${TMP}/rg" rg)"
  [[ -n "$RG_BIN" && -x "$RG_BIN" ]] || { echo "error: rg nicht im Archiv" >&2; exit 1; }
  install_binary "$RG_BIN" rg
fi

# --- ast-grep (Befehl ast-grep, nicht sg) ---
if tool_ok ast-grep "$ASTGREP_VERSION"; then
  echo "ast-grep ${ASTGREP_VERSION} bereits vorhanden, übersprungen."
else
  echo "Installiere ast-grep ${ASTGREP_VERSION}…"
  download_https "$ASTGREP_URL" "${TMP}/ast-grep.zip"
  verify_sha256 "${TMP}/ast-grep.zip" "$ASTGREP_SHA256"
  mkdir -p "${TMP}/ast-grep"
  python3 -c '
import zipfile
from pathlib import Path
dest = Path("'"${TMP}/ast-grep"'")
with zipfile.ZipFile("'"${TMP}/ast-grep.zip"'") as zf:
    for info in zf.infolist():
        name = Path(info.filename).name
        if name in {"ast-grep", "sg"} and not info.is_dir():
            target = dest / name
            target.write_bytes(zf.read(info))
            target.chmod(0o755)
'
  if [[ -x "${TMP}/ast-grep/ast-grep" ]]; then
    install_binary "${TMP}/ast-grep/ast-grep" ast-grep
  elif [[ -x "${TMP}/ast-grep/sg" ]]; then
    install_binary "${TMP}/ast-grep/sg" ast-grep
  else
    echo "error: ast-grep nicht im Archiv" >&2
    exit 1
  fi
fi

# --- codebase-memory-mcp (portable Linux-Build, ohne offizielles install.sh) ---
if tool_ok codebase-memory-mcp "$CBM_VERSION"; then
  echo "codebase-memory-mcp ${CBM_VERSION} bereits vorhanden, übersprungen."
else
  echo "Installiere codebase-memory-mcp ${CBM_VERSION}…"
  download_https "$CBM_SUMS_URL" "${TMP}/checksums.txt"
  verify_sha256 "${TMP}/checksums.txt" "$CBM_SUMS_SHA256"
  if ! awk -v f="$CBM_ARCHIVE" -v h="$CBM_SHA256" '$2==f && $1==h {found=1} END{exit found?0:1}' "${TMP}/checksums.txt"; then
    echo "error: Archiv-Hash steht so nicht in checksums.txt" >&2
    exit 1
  fi
  download_https "$CBM_URL" "${TMP}/${CBM_ARCHIVE}"
  verify_sha256 "${TMP}/${CBM_ARCHIVE}" "$CBM_SHA256"
  mkdir -p "${TMP}/cbm"
  tar -xzf "${TMP}/${CBM_ARCHIVE}" -C "${TMP}/cbm"
  CBM_BIN="$(extract_named_bin "${TMP}/cbm" codebase-memory-mcp)"
  [[ -n "$CBM_BIN" && -x "$CBM_BIN" ]] || { echo "error: codebase-memory-mcp nicht im Archiv" >&2; exit 1; }
  install_binary "$CBM_BIN" codebase-memory-mcp
fi

# UI und Auto-Index aus (keine Netz-Modelle, keine Agent-Configs).
# Nicht «codebase-memory-mcp install» oder «update» ausführen.
codebase-memory-mcp --ui=false >/dev/null 2>&1 || true
codebase-memory-mcp config set ui_enabled false >/dev/null
codebase-memory-mcp config set auto_index false >/dev/null

# --- Repo-Abhängigkeiten ---
if [[ -f "${ROOT}/package-lock.json" ]]; then
  require_node
  echo "Installiere npm-Abhängigkeiten mit npm ci --ignore-scripts…"
  npm ci --ignore-scripts
elif [[ -f "${ROOT}/pnpm-lock.yaml" ]]; then
  require_node
  PNPM_PIN="$(node -p "const p=require('./package.json').packageManager||''; const m=/^pnpm@(.+)$/.exec(p); m?m[1]:''" 2>/dev/null || true)"
  if ! command -v corepack >/dev/null 2>&1 && ! command -v pnpm >/dev/null 2>&1; then
    echo "error: pnpm fehlt und corepack ist nicht verfügbar. pnpm in der Cloud-Umgebung bereitstellen, nicht per curl|bash." >&2
    exit 1
  fi
  # Shims und Cache nur unter dem Home-Verzeichnis, nicht nach /usr/local (kein sudo, CA-1).
  if command -v corepack >/dev/null 2>&1; then
    export COREPACK_HOME="${COREPACK_HOME:-${HOME}/.cache/corepack}"
    mkdir -p "${COREPACK_HOME}" "${BIN}"
    echo "Aktiviere pnpm über corepack${PNPM_PIN:+ (@${PNPM_PIN})} in ${BIN}…"
    corepack enable --install-directory "${BIN}"
    if [[ -n "$PNPM_PIN" ]]; then
      corepack prepare "pnpm@${PNPM_PIN}" --activate
    fi
  fi
  echo "Installiere pnpm-Abhängigkeiten mit pnpm install --frozen-lockfile…"
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD="${PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:-1}" pnpm install --frozen-lockfile
elif [[ -f "${ROOT}/yarn.lock" ]]; then
  require_node
  echo "error: yarn.lock gefunden, Yarn-Install ist in diesem Skript noch nicht hinterlegt. Bitte analog zu npm/pnpm ergänzen." >&2
  exit 1
else
  echo "Kein npm-/pnpm-Lockfile, Abhängigkeit-Install übersprungen."
fi

# --- Index bauen (gehört zum Build-Snapshot) ---
echo "Baue codebase-memory-mcp Index für ${ROOT}…"
codebase-memory-mcp cli --quiet index_repository "{\"repo_path\":\"${ROOT}\"}"
codebase-memory-mcp cli --quiet list_projects '{}' || true

# --- Weitere Tools (Erweiterung) ---
# Beispiel: weiteres CLI mit gepinnter Version und SHA-256 hier ergänzen,
# analog zu ripgrep/ast-grep. Keine unversionierten npm-i -g / uv tool install
# ohne Pin und Prüfung. Kein curl|bash.

ensure_path

echo "Fertig. Binaries unter ${BIN} (in PATH). Werkzeuge:"
rg --version | head -n 1
ast-grep --version
codebase-memory-mcp --version
