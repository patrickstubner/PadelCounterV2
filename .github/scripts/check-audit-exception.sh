#!/usr/bin/env bash
# Prueft die befristete Audit-Ausnahme (siehe SECURITY.md, Abschnitt
# "Befristete Audit-Ausnahme picomatch"). Schlaegt fehl, wenn
#  - in package.json eine andere GHSA-ID als die erlaubte steht, oder
#  - die Ausnahme ab dem Folgetag des Ablaufdatums (Europe/Zurich) noch aktiv ist.
# AUDIT_EXCEPTION_TODAY (YYYY-MM-DD) ueberschreibt das Datum, nur fuer Tests.
set -euo pipefail

ALLOWED="GHSA-fc5q-39xc-vjpf"
EXPIRY="2026-11-27"   # letzter Tag der Ausnahme, ab 2026-11-28 schlaegt CI fehl
CONFIG="${AUDIT_EXCEPTION_CONFIG:-package.json}"

today="${AUDIT_EXCEPTION_TODAY:-$(TZ=Europe/Zurich date +%F)}"
if ! [[ "$today" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "::error::Ungueltiges Datum: $today"
  exit 1
fi

# Alle GHSA-IDs in der Konfiguration, ausser der erlaubten.
others="$(grep -oE 'GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}' "$CONFIG" | sort -u | grep -vx "$ALLOWED" || true)"
if [ -n "$others" ]; then
  echo "::error::Nicht erlaubte Audit-Ausnahme(n) in $CONFIG: $others"
  exit 1
fi

if grep -q "$ALLOWED" "$CONFIG"; then
  if [[ "$today" > "$EXPIRY" ]]; then
    echo "::error::Audit-Ausnahme $ALLOWED ist seit $EXPIRY abgelaufen (heute: $today). ignoreGhsas in $CONFIG entfernen oder Verlaengerung durch Projektinhaber und Stabschef freigeben lassen."
    exit 1
  fi
  echo "Audit-Ausnahme $ALLOWED aktiv, gueltig bis einschliesslich $EXPIRY (heute: $today)."
else
  echo "Keine Audit-Ausnahme in $CONFIG aktiv."
fi
