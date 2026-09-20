#!/usr/bin/env bash
# ============================================================================
# Core Quartz · comprueba que el origen quedó bien puesto.
#
#   bash deploy/verificar.sh                  # contra el .env de deploy/
#   CQ_ORIGEN=localhost bash deploy/verificar.sh
#
# No cambia nada: sólo levanta (si hace falta) y pregunta. Devuelve 0 si todo
# está como debe, y 1 diciendo qué falló.
# ============================================================================
set -Eeuo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$AQUI"

: "${CQ_ORIGEN:=localhost}"
export CQ_ORIGEN
BASE="https://${CQ_ORIGEN}"

# Con `localhost`, Caddy firma con su CA interna, que este curl no conoce.
CURL=(curl --silent --show-error --max-time 20)
if [ "$CQ_ORIGEN" = "localhost" ] || [ "$CQ_ORIGEN" = "127.0.0.1" ]; then
  CURL+=(--insecure)
fi

fallos=0
ok()    { printf '  \033[32m✓\033[0m %s\n' "$1"; }
falla() { printf '  \033[31m✗\033[0m %s\n' "$1"; fallos=$((fallos + 1)); }

# Compara el código de estado de una ruta contra el esperado.
estado() {
  local ruta="$1" esperado="$2" visto
  visto="$("${CURL[@]}" -o /dev/null -w '%{http_code}' "${BASE}${ruta}" || echo 000)"
  if [ "$visto" = "$esperado" ]; then ok "$ruta → $visto"; else falla "$ruta → $visto (se esperaba $esperado)"; fi
}

# Comprueba que el cuerpo de una ruta contenga un texto.
contiene() {
  local ruta="$1" aguja="$2" cuerpo
  cuerpo="$("${CURL[@]}" "${BASE}${ruta}" || true)"
  if printf '%s' "$cuerpo" | grep -q -- "$aguja"; then ok "$ruta contiene «$aguja»"
  else falla "$ruta no contiene «$aguja» (devolvió: $(printf '%s' "$cuerpo" | head -c 120))"; fi
}

echo "Levantando los servicios…"
docker compose up -d --build >/dev/null

echo "Esperando a que el CDH y el shell respondan…"
for _ in $(seq 1 60); do
  if "${CURL[@]}" -o /dev/null "${BASE}/portal/api/salud" 2>/dev/null; then break; fi
  sleep 2
done

echo
echo "Salud de cada módulo"
contiene /portal/api/salud '"ok":true'
contiene /cdh/api/health   '"ok":true'

echo
echo "Lo que NO debe alcanzarse desde fuera"
# R4 · PRD §5 riesgo 4: el canje es la puerta del CDH y vive en la red interna.
estado /portal/api/sso/canjear 404
# La raíz es del CRM, que está en Vercel. Aquí no hay nada.
estado / 404
estado /otra-cosa 404

echo
echo "El portal se sirve de verdad"
contiene /portal/ '<html'
estado /portal 301

echo
echo "Los secretos no salen"
for secreto in SERVICE_ROLE DATABASE_URL CQ_SSO_SECRETO; do
  if "${CURL[@]}" "${BASE}/portal/" | grep -q "$secreto"; then
    falla "«$secreto» aparece en el HTML del portal"
  else
    ok "«$secreto» no aparece en el HTML del portal"
  fi
done

echo
echo "La imagen del shell"
uid="$(docker compose exec -T shell id -u 2>/dev/null | tr -d '\r\n' || echo '?')"
if [ "$uid" = "1000" ]; then ok "corre como uid 1000"; else falla "corre como uid $uid (se esperaba 1000)"; fi
if docker compose exec -T shell test -e /app/.env 2>/dev/null; then
  falla "la imagen contiene un .env"
else
  ok "la imagen no contiene ningún .env"
fi

echo
echo "La url_base del CRM es absoluta"
# Es el error silencioso más fácil de cometer: la semilla sólo corre en la
# PRIMERA migración, así que cambiar CQ_URL_CRM después no actualiza la fila y
# la entrada al CRM queda cayendo dentro del propio portal.
crm="$(docker compose exec -T shell node -e "
  const { crearPool } = await import('./src/db/pool.ts');
  const pool = crearPool(process.env.DATABASE_URL);
  const { rows } = await pool.query(\"SELECT url_base FROM core.modulos WHERE codigo = 'crm'\");
  console.log(rows[0]?.url_base ?? '');
  await pool.end();
" 2>/dev/null | tr -d '\r\n' || echo '')"
case "$crm" in
  https://*) ok "core.modulos.url_base del CRM = $crm" ;;
  '')        falla "no se pudo leer core.modulos.url_base del CRM" ;;
  *)         falla "core.modulos.url_base del CRM es «$crm»: debe ser absoluta (vea docs/DESPLIEGUE.md)" ;;
esac

echo
if [ "$fallos" -eq 0 ]; then
  echo "Todo en orden."
else
  echo "$fallos comprobación(es) fallaron."
fi
exit $(( fallos > 0 ? 1 : 0 ))
