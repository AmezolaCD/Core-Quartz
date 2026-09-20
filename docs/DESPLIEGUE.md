# Despliegue de Core Quartz

Cómo poner el portal y el CDH detrás de un solo origen HTTPS, paso a paso.

Al terminar:

| Dirección | Qué sirve |
|---|---|
| `https://<CQ_ORIGEN>/portal/` | El portal de Core Quartz |
| `https://<CQ_ORIGEN>/cdh/` | El CDH |
| `https://core-quartz.vercel.app/` | El CRM, que **no se toca** y sigue en Vercel |

El CRM se queda donde está. Los enlaces de firma que ya se mandaron a clientes
llevan `core-quartz.vercel.app/` dentro y tienen que seguir funcionando.

## Antes de empezar

- Una máquina con **Docker** y **Docker Compose**, encendida siempre.
- Un **dominio que apunte a su IP**. Sin comprar nada sirve
  `<ip-con-guiones>.sslip.io` (por ejemplo `203-0-113-7.sslip.io`).
- Los **puertos 80 y 443 abiertos** hacia esa máquina. Let's Encrypt necesita
  el 80 para emitir el certificado.
- Las llaves del proyecto de **Supabase** (`anon` y `service_role`) y la cadena
  de conexión a su Postgres.
- El repositorio del **CDH** clonado al lado.

> **Respalde el CDH antes de tocar nada.** Si ya hay un CDH en uso, su historial
> vive en un volumen de Docker y es lo único irrecuperable de todo esto:
>
> ```bash
> docker run --rm -v cdhquartz_cdh-data:/datos -v "$PWD":/copia alpine \
>   tar czf /copia/cdh-respaldo-$(date +%F).tar.gz -C /datos .
> ```
>
> Guarde ese archivo **fuera de la máquina**.

## 1. La imagen del CDH

Se construye en **su** repositorio, no aquí. El shell nunca escribe en el CDH
ni en su código, y mezclar los dos árboles invitaría a hacerlo.

```bash
cd ../cdhquartz
docker compose build          # deja la imagen cdh-quartz:1.0.0
```

## 2. La configuración

```bash
cd Core-Quartz
cp .env.example deploy/.env
```

Y llene `deploy/.env`. Lo que no puede quedar vacío:

| Variable | Qué es |
|---|---|
| `CQ_ORIGEN` | El dominio que apunta a esta máquina |
| `DATABASE_URL` | Postgres de Supabase (el mismo del CRM) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Del proyecto de Supabase |
| `CQ_SSO_SECRETO` | Inventado aquí, **el mismo en el shell y en el CDH** |
| `CQ_URL_CRM` | `https://core-quartz.vercel.app` |
| `CDH_SEED_PASSWORD` | Contraseña de los usuarios iniciales del CDH |

Para el secreto del SSO sirve:

```bash
openssl rand -base64 32
```

> **`CQ_URL_CRM` tiene que ser absoluta.** El CRM vive en Vercel y el portal no.
> Si queda relativa, el portal manda a la gente a su propia raíz en vez de al
> CRM y la entrada no funciona. Es el error silencioso más fácil de cometer, y
> por eso `verificar.sh` lo revisa.

## 3. Levantar

```bash
cd deploy
docker compose up -d --build
```

La primera vez, Caddy pide el certificado a Let's Encrypt: tarda unos segundos
y necesita el puerto 80. El shell corre las migraciones al arrancar, antes de
atender nada.

## 4. Comprobar

```bash
bash deploy/verificar.sh
```

Revisa que los dos módulos respondan, que el canje del boleto **no** se alcance
desde fuera, que la raíz dé 404, que el portal sirva HTML, que no se asome
ningún secreto, que la imagen corra como `uid 1000` y sin `.env`, y que la
`url_base` del CRM sea absoluta.

Para probar en la propia máquina antes de apuntar el dominio:

```bash
CQ_ORIGEN=localhost bash deploy/verificar.sh
```

## 5. La primera administradora

Sin esto no hay por dónde entrar a administración.

```bash
cd deploy
docker compose exec shell node src/cli/crear-admin.ts
```

## Cambiar a dónde apunta un módulo

`CQ_URL_CRM` y `CQ_URL_CDH` siembran `core.modulos.url_base` **sólo en la
primera migración**, con `on conflict do nothing`. Cambiarlas en el `.env`
después **no actualiza nada**: la fila ya existe.

Es a propósito —una administradora puede haber cambiado esa dirección y un
reinicio no debería pisársela—, pero sorprende. Para cambiarla de verdad:

```sql
update core.modulos set url_base = 'https://core-quartz.vercel.app' where codigo = 'crm';
update core.modulos set url_base = '/cdh' where codigo = 'cdh';
```

`verificar.sh` avisa si la del CRM no quedó absoluta.

## Respaldos

Dos cosas distintas, y las dos hacen falta:

- **El CDH** vive en el volumen `core-quartz_cdh-data` de esta máquina. Es lo
  único que no está en ningún otro lado. El comando de arriba lo respalda;
  póngalo en un `cron` diario y **llévese la copia fuera de la máquina**.
- **Core Quartz** vive en Supabase, que ya tiene sus propios respaldos.

Para reaprovechar el volumen de una instalación anterior del CDH, márquelo
externo en `deploy/docker-compose.yml`:

```yaml
volumes:
  cdh-data:
    external: true
    name: cdhquartz_cdh-data
```

## Cómo revertir

```bash
cd deploy
docker compose down            # el volumen del CDH NO se borra
```

`down` para los contenedores y deja los volúmenes. El CDH vuelve a arrancar
como estaba. **Nunca use `down -v`**: eso sí borra el historial del CDH.

Para volver a una versión anterior del shell:

```bash
git checkout <commit-anterior>
docker compose up -d --build
```

Las migraciones no se deshacen solas. Si la versión anterior no entiende el
esquema nuevo, hay que revertir la migración a mano antes.

## Lo que falta medir, y por qué no está aquí

El PRD §5 describe el público entrando por `core-quartz.vercel.app`, con Vercel
reenviando `/portal/*` y `/cdh/*` a esta máquina. **Este despliegue no lo
necesita**: el origen funciona solo, con su propio dominio y su propio HTTPS.

Si más adelante se quiere ese dominio único, hay que medir antes tres cosas
contra Vercel real, y ninguna se puede medir sin el despliegue hecho:

1. **Tamaño máximo de petición** que pasa la reescritura — el CDH sube hasta 8
   fotos por envío.
2. **Tiempo de espera** de la reescritura — un reporte grande del CDH.
3. **Qué cabecera trae la IP del cliente**, de la que depende el límite de
   intentos de entrada.

Si algo no cabe, se decide entonces: o el CDH reduce las fotos en el navegador,
o se baja el límite por envío, o se deja el dominio propio y no hay reescritura
que medir.
