/**
 * R4: el CDH canjea el boleto contra el shell.
 *
 * Todas las filas de la tabla de R4 del PRD, con el boleto emitido a las
 * 10:00:00.000 y venciendo a las 10:01:00.000, incluido el límite inclusivo.
 *
 * Sobre el secreto: el PRD R4 dice 401 para «sin cabecera o incorrecta», y el
 * documento de la fase 04 dice que `/api/sso/*` responde 404 «si la petición no
 * trae el secreto configurado»; su criterio de aceptación admite «401/404».
 * Se resuelve así: **sin** cabecera la ruta no existe (404), **con** cabecera
 * equivocada es un rechazo explícito (401). En los dos casos no se consulta ni
 * se quema nada, que es lo que de verdad importa.
 */
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { HORA_CERO, ID, levantarEntorno, SECRETOS_DE_PRUEBA, type Entorno } from '../apoyo/app.ts';
import { unaFila } from '../apoyo/pg.ts';
import { hashToken } from '../../src/nucleo/cripto.ts';

const P = '/portal';
const CONTRASENA = 'contraseña-de-prueba';
const CON_SECRETO = { 'x-cq-secreto': SECRETOS_DE_PRUEBA.sso };

let e: Entorno;

/** Emite un boleto de `cdh` para Carla y devuelve su código en claro. */
async function boletoDeCarla(): Promise<string> {
  const nav = e.navegador();
  await nav.pedir('POST', `${P}/api/auth/entrar`, {
    cuerpo: { correo: 'carla@quartz.example', contrasena: CONTRASENA },
  });
  const r = await nav.pedir('GET', `${P}/api/modulos/cdh/abrir`);
  assert.equal(r.estado, 302);
  return new URL(r.destino ?? '', 'http://local').searchParams.get('codigo') ?? '';
}

/**
 * `canjeado` y `resultado` del boleto, leídos directo de la base.
 * El hash se calcula aquí con la misma función del núcleo, y no con `digest()`
 * de Postgres: pgcrypto no está instalado en la base de pruebas, y el shell
 * tampoco lo usa (de los códigos sólo guarda su SHA-256 calculado en Node).
 */
async function estadoDelBoleto(codigo: string): Promise<{ canjeado: boolean; resultado: string | null }> {
  const fila = await unaFila<{ canjeado: Date | null; resultado: string | null }>(
    e.pool,
    `SELECT canjeado, resultado FROM core.boletos WHERE codigo_hash = $1`,
    [hashToken(codigo)],
  );
  return { canjeado: fila?.canjeado != null, resultado: fila?.resultado ?? null };
}

function canjear(codigo: string, modulo = 'cdh', cabeceras: Record<string, string> = CON_SECRETO) {
  return e.pedir('POST', `${P}/api/sso/canjear`, { cuerpo: { codigo, modulo }, cabeceras });
}

before(async () => {
  e = await levantarEntorno();
  e.supabase.agregar('carla@quartz.example', CONTRASENA, ID.carla);
  e.cdh.agregar('carla.ama', true);
});

beforeEach(() => {
  e.reloj.ahora = HORA_CERO;
});

describe('R4 · canje válido', () => {
  it('a las 10:00:05 devuelve 200 con usuario_modulo y nombre', async () => {
    const codigo = await boletoDeCarla();
    e.reloj.ahora = HORA_CERO + 5_000;
    const r = await canjear(codigo);
    assert.equal(r.estado, 200);
    assert.deepEqual(r.cuerpo, { usuario_modulo: 'carla.ama', nombre: 'Carla' });
  });

  it('a las 10:01:00.000 exactas todavía vale: el límite es inclusivo', async () => {
    const codigo = await boletoDeCarla();
    e.reloj.ahora = HORA_CERO + 60_000;
    const r = await canjear(codigo);
    assert.equal(r.estado, 200);
  });

  it('a las 10:01:00.001 ya no: 410 vencido', async () => {
    const codigo = await boletoDeCarla();
    e.reloj.ahora = HORA_CERO + 60_001;
    const r = await canjear(codigo);
    assert.equal(r.estado, 410);
    assert.equal((r.cuerpo as { motivo: string }).motivo, 'vencido');
  });
});

describe('R4 · un boleto sirve una sola vez', () => {
  it('el mismo código otra vez: 410 usado', async () => {
    const codigo = await boletoDeCarla();
    e.reloj.ahora = HORA_CERO + 5_000;
    assert.equal((await canjear(codigo)).estado, 200);
    e.reloj.ahora = HORA_CERO + 6_000;
    const segundo = await canjear(codigo);
    assert.equal(segundo.estado, 410);
    assert.equal((segundo.cuerpo as { motivo: string }).motivo, 'usado');
  });

  it('un código inventado: 410 desconocido', async () => {
    const r = await canjear('codigo-que-nunca-existio');
    assert.equal(r.estado, 410);
    assert.equal((r.cuerpo as { motivo: string }).motivo, 'desconocido');
  });

  it('dos canjes simultáneos: exactamente uno gana (invariante 3)', async () => {
    const codigo = await boletoDeCarla();
    e.reloj.ahora = HORA_CERO + 5_000;
    const respuestas = await Promise.all(Array.from({ length: 8 }, () => canjear(codigo)));
    const buenos = respuestas.filter((r) => r.estado === 200);
    const usados = respuestas.filter((r) => r.estado === 410);
    assert.equal(buenos.length, 1);
    assert.equal(usados.length, 7);
  });
});

describe('R4 · el boleto es del módulo que lo pidió', () => {
  it('presentado por el CRM: 409 modulo, y el boleto queda quemado', async () => {
    const codigo = await boletoDeCarla();
    e.reloj.ahora = HORA_CERO + 5_000;
    const r = await canjear(codigo, 'crm');
    assert.equal(r.estado, 409);
    assert.equal((r.cuerpo as { motivo: string }).motivo, 'modulo');

    // Quemado: reintentarlo por su módulo correcto ya no sirve.
    const reintento = await canjear(codigo, 'cdh');
    assert.equal(reintento.estado, 410);
    assert.equal((reintento.cuerpo as { motivo: string }).motivo, 'usado');
  });
});

describe('R4 · se revisa al canjear, no sólo al emitir', () => {
  it('desactivar a Carla entre emisión y canje: 403 inactivo', async () => {
    const codigo = await boletoDeCarla();
    e.reloj.ahora = HORA_CERO + 3_000;
    await e.pool.query(`UPDATE core.usuarios SET activo = false WHERE id = $1::uuid`, [ID.carla]);
    try {
      e.reloj.ahora = HORA_CERO + 5_000;
      const r = await canjear(codigo);
      assert.equal(r.estado, 403);
      assert.equal((r.cuerpo as { motivo: string }).motivo, 'inactivo');
    } finally {
      await e.pool.query(`UPDATE core.usuarios SET activo = true WHERE id = $1::uuid`, [ID.carla]);
    }
  });

  it('apagar su acceso al CDH entre emisión y canje: 403 inactivo', async () => {
    const codigo = await boletoDeCarla();
    await e.pool.query(`UPDATE core.accesos SET activo = false WHERE usuario_id = $1::uuid AND modulo = 'cdh'`, [
      ID.carla,
    ]);
    try {
      e.reloj.ahora = HORA_CERO + 5_000;
      const r = await canjear(codigo);
      assert.equal(r.estado, 403);
      assert.equal((r.cuerpo as { motivo: string }).motivo, 'inactivo');
    } finally {
      await e.pool.query(`UPDATE core.accesos SET activo = true WHERE usuario_id = $1::uuid AND modulo = 'cdh'`, [
        ID.carla,
      ]);
    }
  });
});

describe('R4 · el secreto compartido', () => {
  it('sin cabecera: la ruta no existe (404) y el boleto NO se quema', async () => {
    const codigo = await boletoDeCarla();
    e.reloj.ahora = HORA_CERO + 5_000;
    const r = await canjear(codigo, 'cdh', {});
    assert.equal(r.estado, 404);
    assert.equal((await estadoDelBoleto(codigo)).canjeado, false);
  });

  it('con el secreto equivocado: 401 y el boleto NO se quema', async () => {
    const codigo = await boletoDeCarla();
    e.reloj.ahora = HORA_CERO + 5_000;
    const r = await canjear(codigo, 'cdh', { 'x-cq-secreto': 'no-es' });
    assert.equal(r.estado, 401);
    assert.equal((await estadoDelBoleto(codigo)).canjeado, false);
  });

  it('tras un rechazo por secreto, el boleto sigue sirviendo', async () => {
    const codigo = await boletoDeCarla();
    e.reloj.ahora = HORA_CERO + 5_000;
    await canjear(codigo, 'cdh', { 'x-cq-secreto': 'no-es' });
    const bueno = await canjear(codigo);
    assert.equal(bueno.estado, 200);
  });
});
