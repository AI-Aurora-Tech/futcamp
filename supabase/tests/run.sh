#!/usr/bin/env bash
# Aplica todas as migrations num Postgres temporário e roda as verificações.
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
DIR="${PGDIR:-/var/tmp/pgtabelaco}"
PORTA="${PGPORT:-55432}"
SOCK="${PGSOCK:-/var/tmp}"
export PATH="$PGBIN:$PATH"

# O Postgres recusa rodar como root; quando for o caso, usa o usuário postgres.
# Precisa ser decidido ANTES de parar o servidor anterior — parar como root
# falha em silêncio e a porta continua ocupada.
if [ "$(id -u)" = 0 ] && id -u postgres >/dev/null 2>&1; then
  COMO="su postgres -c"
else
  COMO="bash -c"
fi

echo "▶ subindo Postgres temporário em $DIR"
$COMO "PATH=$PGBIN:\$PATH pg_ctl -D $DIR stop -m immediate" >/dev/null 2>&1 || true
sleep 1
rm -rf "$DIR"; mkdir -p "$DIR"
[ "$COMO" = "su postgres -c" ] && { chown postgres:postgres "$DIR"; chmod 700 "$DIR"; }

$COMO "PATH=$PGBIN:\$PATH initdb -D $DIR -U tabelaco --auth=trust" >/dev/null
$COMO "PATH=$PGBIN:\$PATH pg_ctl -D $DIR -o '-p $PORTA -k $SOCK' -l $DIR/pg.log start" >/dev/null
trap '$COMO "PATH=$PGBIN:\$PATH pg_ctl -D $DIR stop" >/dev/null 2>&1 || true' EXIT
sleep 2

PSQL="psql -h $SOCK -p $PORTA -U tabelaco -v ON_ERROR_STOP=1 -q"
$PSQL -d postgres -c "drop database if exists tabelaco;" -c "create database tabelaco;" >/dev/null

echo "▶ preparando o mínimo do Supabase"
$PSQL -d tabelaco -f "$AQUI/00_supabase_stub.sql" >/dev/null

echo "▶ aplicando as migrations"
for f in "$RAIZ"/supabase/migrations/*.sql; do
  if $PSQL -d tabelaco -f "$f" >/tmp/mig.log 2>&1; then
    echo "  ✅ $(basename "$f")"
  else
    echo "  ❌ $(basename "$f")"; grep -E "ERROR" /tmp/mig.log | head -3; exit 1
  fi
done

echo "▶ cenário"
$PSQL -d tabelaco -f "$AQUI/01_cenario.sql" >/dev/null

echo "▶ regras"
SAIDA=$(psql -h "$SOCK" -p "$PORTA" -U tabelaco -d tabelaco -v raiz="$RAIZ" -f "$AQUI/02_regras.sql" 2>&1)
echo "$SAIDA" | grep -oE "(✅|❌ FALHOU) ?.*" | sed 's/^/  /'

if echo "$SAIDA" | grep -q "FALHOU"; then
  echo "▶ há regras falhando"; exit 1
fi
echo "▶ tudo passou"
