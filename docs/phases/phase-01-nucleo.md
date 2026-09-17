# Fase 01 · Núcleo puro

## Alcance
Las reglas R1–R7 del PRD como **funciones puras** en TypeScript: sin base de datos, sin red, sin reloj
implícito (la hora entra como parámetro). Incluye el andamiaje mínimo del repo.

Funciones:

- `modulosVisibles(usuario, modulos, accesos) → CodigoModulo[]` (R1, ordenado por `orden`)
- `puedeEntrar(usuario, modulo, acceso) → {ok:true} | {ok:false, motivo}` (R1)
- `validarEntrada(usuarioCore | null) → ok | 'sin_acceso' | 'desactivado'` (R2.2)
- `nuevoCodigo(rng) → {codigo, hash}` y `expiraEn(emitido) → emitido + 60 000 ms` (R3)
- `evaluarCanje(boleto | null, {ahora, moduloQueCanjea, usuario, acceso}) → {ok, usuario_modulo} | {ok:false, motivo: 'desconocido'|'usado'|'vencido'|'modulo'|'inactivo'}` (R4; límite inclusivo)
- `normalizarUsuarioCdh(texto) → string | error` (R7: minúsculas, `[a-z0-9._-]{3,40}`)
- `validarAsignacion(nueva, accesosExistentes, usuarios) → ok | 'duplicado' (con nombre del dueño) | 'formato' | 'crm_con_usuario'` (R7)
- `puedeQuitarAdmin(objetivo, usuarios) → ok | 'ultimo_admin'` (R6)
- `enlaceCrm({supabaseUrl, anon, tokenHash}) → string` (R5.3; ruta relativa `/#nube=b64url({u,k})&cq=…`)
- `enlaceCdh({basePathCdh, codigo}) → string` (R3; `/cdh/api/auth/sso?codigo=…`)
- `normalizarBasePath(texto) → '' | '/algo'` (sin barra final; `'/'` → `''`; rechaza `..`, `//`, espacios)
- `hashToken(texto) → sha256 hex`

## Archivos
- `package.json` (scripts `test:nucleo`, `typecheck`; `"type":"module"`; `engines.node >=22.18`)
- `tsconfig.json` (`noEmit`, `allowImportingTsExtensions`, `erasableSyntaxOnly`, `strict`)
- `.gitignore`, `.env.example`
- `src/nucleo/tipos.ts`, `accesos.ts`, `boletos.ts`, `identidades.ts`, `enlaces.ts`, `cripto.ts`
- `test/nucleo/accesos.test.ts`, `boletos.test.ts`, `identidades.test.ts`, `enlaces.test.ts`

## Criterios de aceptación
- [ ] Cada fila de las tablas R1, R3, R4 (salvo cabecera/secreto, que es de API), R6 (último admin) y R7 (formato, duplicado, CRM) es un caso de prueba con los mismos datos de ejemplo del PRD.
- [ ] `enlaceCdh` y `enlaceCrm` devuelven rutas relativas al mismo dominio (empiezan con `/`, nunca con `//` ni `http`).
- [ ] `evaluarCanje` a `expira` exacto → ok; a `expira + 1 ms` → `vencido`.
- [ ] `enlaceCrm` produce un fragmento que el `deB64url` del CRM decodifica a `{u,k}` (prueba con la misma función copiada del CRM).
- [ ] Ningún archivo de `src/nucleo/` importa `node:fs`, `node:net`, `pg` ni usa `Date.now()` / `Math.random()` (prueba que lo revisa).
- [ ] `tsc --noEmit` sin errores.

## Verificación
```bash
npm ci
npm run typecheck && npm run test:nucleo
```
