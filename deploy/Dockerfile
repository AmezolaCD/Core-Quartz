# ============================================================================
# Core Quartz · shell
#
# Node 22 ejecuta el TypeScript con su type stripping nativo (PRD §9): no hay
# paso de compilación, así que la imagen lleva el código tal cual y `tsc` se
# queda fuera. Construir desde la raíz del repo:
#
#   docker build -f deploy/Dockerfile -t core-quartz:1.0.0 .
# ============================================================================
FROM node:22-alpine

# `tini` como PID 1: sin él, Node no recibe SIGTERM y cada `docker compose
# down` acaba en un SIGKILL a los diez segundos.
RUN apk add --no-cache tini

ENV NODE_ENV=production
WORKDIR /app

# Las dependencias primero: cambian mucho menos que el código, y así la capa
# se reaprovecha entre construcciones.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Sólo lo que hace falta para servir. Ni `test/`, ni `docs/`, ni `.env`:
# lo que no se copia no se puede filtrar.
COPY src ./src
COPY public ./public

# La imagen corre como `node` (uid 1000), que ya viene en la base.
USER node

EXPOSE 4000

# La sonda sigue al prefijo: con CQ_BASE_PATH=/portal la salud vive en
# /portal/api/salud y la ruta de antes no existe.
# Sin `${...}` a propósito: docker compose interpola esa forma al leer el
# archivo y se comería la expresión de JavaScript antes de que llegue al
# contenedor.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4000) + (process.env.CQ_BASE_PATH || '') + '/api/salud').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/index.ts"]
