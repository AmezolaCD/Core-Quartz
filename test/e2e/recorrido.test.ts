/**
 * Fase 09: el recorrido completo, contra **staging**.
 *
 * El archivo tiene dos mitades y conviene saber por qué:
 *
 * · **El guardia** corre en cualquier parte, sin entorno y sin red. Es lo que
 *   impide que estas pruebas —que crean y borran usuarios— toquen producción, y
 *   por eso se prueba aquí, en el CI, y no a mano.
 *
 * · **Los seis recorridos** necesitan staging de verdad: un proyecto Supabase
 *   propio, el `docker compose` de la fase 08 levantado y el CRM en su origen.
 *   Hasta que exista, están declarados como `todo`: se ven, se nombran y no
 *   mienten diciendo que pasan. Escribirlos a ciegas contra un entorno que nadie
 *   ha visto sería inventar selectores; el documento de la fase dice qué hace
 *   falta para montarlo.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mismoProyecto, revisarStaging } from './preparar-staging.ts';

// ---------------------------------------------------------------------------
// El guardia contra producción
// ---------------------------------------------------------------------------

const PROD = 'https://abcdefghijklmnop.supabase.co';
const STAGING = 'https://qrstuvwxyz123456.supabase.co';
const DB = 'postgres://usuario:contrasena@host:5432/postgres';

/** ¿Dejaría correr con este entorno? */
function corre(entorno: { supabaseUrl?: string; produccion?: string; databaseUrl?: string }): boolean {
  return revisarStaging(entorno) === null;
}

describe('fase 09 · el guardia contra producción', () => {
  it('con staging de verdad, deja correr', () => {
    assert.equal(corre({ supabaseUrl: STAGING, produccion: PROD, databaseUrl: DB }), true);
  });

  it('sin SUPABASE_URL o sin DATABASE_URL no hay a qué apuntar: no corre', () => {
    assert.equal(corre({ produccion: PROD, databaseUrl: DB }), false);
    assert.equal(corre({ supabaseUrl: STAGING, produccion: PROD }), false);
  });

  it('**sin `CQ_SUPABASE_PRODUCCION` no corre**, y eso es el punto', () => {
    // Un guardia que se apaga cuando nadie lo configuró no es un guardia, y la
    // máquina donde nadie lo configuró es justo donde hace falta. Los dos
    // repositorios son públicos, así que la dirección de producción no puede
    // estar en el código (invariante §5): tiene que venir del entorno.
    assert.equal(corre({ supabaseUrl: STAGING, databaseUrl: DB }), false);
    assert.equal(corre({ supabaseUrl: STAGING, produccion: '   ', databaseUrl: DB }), false);
  });

  it('reconoce producción disfrazada: barra, mayúsculas, ruta y espacios', () => {
    // Comparar las cadenas tal cual dejaría pasar las cuatro. Se compara el
    // host, que es lo que identifica al proyecto.
    for (const disfraz of [PROD, `${PROD}/`, PROD.toUpperCase(), `${PROD}/auth/v1`, ` ${PROD} `]) {
      assert.equal(
        corre({ supabaseUrl: disfraz, produccion: PROD, databaseUrl: DB }),
        false,
        `dejó pasar «${disfraz}»`,
      );
    }
  });

  it('una dirección que no se entiende cuenta como producción: no corre', () => {
    // Ante la duda, no se corre. Es la única respuesta segura cuando lo que hay
    // puesto no se puede interpretar.
    assert.equal(corre({ supabaseUrl: 'no-es-una-url', produccion: PROD, databaseUrl: DB }), false);
    assert.equal(corre({ supabaseUrl: STAGING, produccion: 'basura', databaseUrl: DB }), false);
  });

  it('dos proyectos distintos no son el mismo', () => {
    assert.equal(mismoProyecto(STAGING, PROD), false);
    assert.equal(mismoProyecto(STAGING, `${STAGING}/`), true);
  });

  it('el motivo dice qué hacer, no sólo que no se puede', () => {
    const sinProd = revisarStaging({ supabaseUrl: STAGING, databaseUrl: DB });
    assert.ok(sinProd, 'debería impedirlo');
    assert.match(sinProd.motivo, /CQ_SUPABASE_PRODUCCION/);
    assert.match(sinProd.motivo, /\.env\.e2e/);

    const esProd = revisarStaging({ supabaseUrl: PROD, produccion: PROD, databaseUrl: DB });
    assert.ok(esProd, 'debería impedirlo');
    assert.match(esProd.motivo, /staging/);
  });
});

// ---------------------------------------------------------------------------
// Los seis recorridos
//
// Declarados y sin escribir hasta que exista staging. Lo que hace falta para
// montarlo está en `docs/E2E.md`; el porqué de cada uno, en el PRD.
// ---------------------------------------------------------------------------

describe('fase 09 · los seis recorridos', () => {
  it('1 · Ana entra al portal, abre el CDH y comenta, vuelve, y abre el CRM con sesión', { todo: 'falta staging' });
  it('2 · Beto sólo ve el CRM; forzar `api/modulos/cdh/abrir` da 403', { todo: 'falta staging' });
  it('3 · Carla consulta `crm_datos` desde Supabase y ve 0 filas (R8), con la lista sembrada', { todo: 'falta staging' });
  it('4 · Ana desactiva a Carla: su sesión del CDH deja de servir y no puede entrar al portal', { todo: 'falta staging' });
  it('5 · reusar un `?codigo=` ya canjeado da la página de error del CDH', { todo: 'falta staging' });
  it('6 · los recorridos 1 y 2 otra vez a 360 × 740', { todo: 'falta staging' });
});
