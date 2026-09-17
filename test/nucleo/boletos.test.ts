import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { evaluarCanje, expiraEn, nuevoCodigo } from '../../src/nucleo/boletos.ts';
import { hashToken } from '../../src/nucleo/cripto.ts';
import type { Boleto, ContextoCanje } from '../../src/nucleo/tipos.ts';
import { ID, accesoDe, hora, modulo, usuario } from './datos.ts';

const sha256 = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');

function rngFijo(relleno: (i: number) => number) {
  const pedidos: number[] = [];
  const rng = (n: number) => {
    pedidos.push(n);
    return Uint8Array.from({ length: n }, (_, i) => relleno(i));
  };
  return { rng, pedidos };
}

describe('R3 · nuevoCodigo', () => {
  it('pide 32 bytes y devuelve su base64url (43 caracteres)', () => {
    const { rng, pedidos } = rngFijo((i) => i);
    const { codigo } = nuevoCodigo(rng);
    assert.deepEqual(pedidos, [32]);
    assert.equal(codigo.length, 43);
    assert.equal(codigo, Buffer.from(Uint8Array.from({ length: 32 }, (_, i) => i)).toString('base64url'));
  });

  it('es determinista con el mismo rng', () => {
    assert.deepEqual(nuevoCodigo(rngFijo((i) => i * 7).rng), nuevoCodigo(rngFijo((i) => i * 7).rng));
  });

  it('bytes distintos → código distinto', () => {
    assert.notEqual(nuevoCodigo(rngFijo(() => 1).rng).codigo, nuevoCodigo(rngFijo(() => 2).rng).codigo);
  });

  it('es seguro para URL (sin +, / ni =) aun con bytes que en base64 darían + y /', () => {
    const { codigo } = nuevoCodigo(rngFijo((i) => (i % 2 ? 0xff : 0xfb)).rng);
    assert.match(codigo, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(codigo.includes('-') || codigo.includes('_'));
  });

  it('hash = sha256 hex del código', () => {
    const { codigo, hash } = nuevoCodigo(rngFijo((i) => 255 - i).rng);
    assert.equal(hash, sha256(codigo));
    assert.match(hash, /^[0-9a-f]{64}$/);
  });
});

describe('R3 · expiraEn', () => {
  it('emitido + 60 000 ms', () => {
    assert.equal(expiraEn(hora('10:00:00.000')), hora('10:01:00.000'));
    assert.equal(expiraEn(0), 60_000);
  });
});

describe('hashToken', () => {
  it('sha256 hex conocido', () => {
    assert.equal(hashToken('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('coincide con node:crypto para texto UTF-8', () => {
    assert.equal(hashToken('Cañón ñ'), sha256('Cañón ñ'));
  });
});

describe('R4 · evaluarCanje (boleto de Carla, 10:00:00.000 → 10:01:00.000)', () => {
  const boletoCarla = (cambios: Partial<Boleto> = {}): Boleto => ({
    codigo_hash: sha256('codigo-de-carla'),
    usuario_id: ID.carla,
    modulo: 'cdh',
    usuario_modulo: 'carla.ama',
    emitido: hora('10:00:00.000'),
    expira: hora('10:01:00.000'),
    canjeado: null,
    resultado: null,
    ...cambios,
  });

  const ctx = (hhmmss: string, cambios: Partial<ContextoCanje> = {}): ContextoCanje => ({
    ahora: hora(hhmmss),
    moduloQueCanjea: 'cdh',
    usuario: usuario('carla'),
    acceso: accesoDe('carla', 'cdh'),
    modulo: modulo('cdh'),
    ...cambios,
  });

  it('10:00:05, módulo cdh → ok con carla.ama', () => {
    assert.deepEqual(evaluarCanje(boletoCarla(), ctx('10:00:05.000')), { ok: true, usuario_modulo: 'carla.ama' });
  });

  it('el mismo código otra vez a 10:00:06 → usado', () => {
    const quemado = boletoCarla({ canjeado: hora('10:00:05.000'), resultado: 'ok' });
    assert.deepEqual(evaluarCanje(quemado, ctx('10:00:06.000')), { ok: false, motivo: 'usado' });
  });

  it('un boleto quemado por un intento fallido también da usado', () => {
    const quemado = boletoCarla({ canjeado: hora('10:00:02.000'), resultado: 'modulo' });
    assert.deepEqual(evaluarCanje(quemado, ctx('10:00:05.000')), { ok: false, motivo: 'usado' });
  });

  it('10:01:00.000 exactos → ok (límite inclusivo)', () => {
    assert.deepEqual(evaluarCanje(boletoCarla(), ctx('10:01:00.000')), { ok: true, usuario_modulo: 'carla.ama' });
  });

  it('10:01:00.001 → vencido', () => {
    assert.deepEqual(evaluarCanje(boletoCarla(), ctx('10:01:00.001')), { ok: false, motivo: 'vencido' });
  });

  it('presentado por el módulo crm → modulo', () => {
    assert.deepEqual(evaluarCanje(boletoCarla(), ctx('10:00:05.000', { moduloQueCanjea: 'crm' })), {
      ok: false,
      motivo: 'modulo',
    });
  });

  it('Carla desactivada a las 10:00:03; canje a 10:00:05 → inactivo', () => {
    const carla = { ...usuario('carla'), activo: false };
    assert.deepEqual(evaluarCanje(boletoCarla(), ctx('10:00:05.000', { usuario: carla })), {
      ok: false,
      motivo: 'inactivo',
    });
  });

  it('acceso cdh de Carla desactivado antes del canje → inactivo', () => {
    const a = accesoDe('carla', 'cdh');
    assert.ok(a);
    assert.deepEqual(evaluarCanje(boletoCarla(), ctx('10:00:05.000', { acceso: { ...a, activo: false } })), {
      ok: false,
      motivo: 'inactivo',
    });
  });

  it('usuario o acceso ya no existen al canjear → inactivo', () => {
    assert.deepEqual(evaluarCanje(boletoCarla(), ctx('10:00:05.000', { acceso: null })), {
      ok: false,
      motivo: 'inactivo',
    });
    assert.deepEqual(evaluarCanje(boletoCarla(), ctx('10:00:05.000', { usuario: null })), {
      ok: false,
      motivo: 'inactivo',
    });
  });

  it('código inventado → desconocido', () => {
    assert.deepEqual(evaluarCanje(null, ctx('10:00:05.000')), { ok: false, motivo: 'desconocido' });
  });

  it('usado se reporta antes que vencido', () => {
    const quemado = boletoCarla({ canjeado: hora('10:00:05.000'), resultado: 'ok' });
    assert.deepEqual(evaluarCanje(quemado, ctx('10:05:00.000')), { ok: false, motivo: 'usado' });
  });
  describe('R4 · al canjear se vuelve a aplicar R1 con las filas actuales', () => {
    const accesoCarla = () => {
      const a = accesoDe('carla', 'cdh');
      assert.ok(a);
      return a;
    };
    const cdh = () => {
      const m = modulo('cdh');
      assert.ok(m);
      return m;
    };
    const INACTIVO = { ok: false, motivo: 'inactivo' } as const;

    it("a) el acceso actual se religó a 'carla.nueva' dentro de los 60 s → inactivo", () => {
      const acceso = { ...accesoCarla(), usuario_modulo: 'carla.nueva' };
      assert.deepEqual(evaluarCanje(boletoCarla(), ctx('10:00:05.000', { acceso })), INACTIVO);
    });

    it('b) el acceso actual ya no tiene usuario_modulo → inactivo', () => {
      const acceso = { ...accesoCarla(), usuario_modulo: null };
      assert.deepEqual(evaluarCanje(boletoCarla(), ctx('10:00:05.000', { acceso })), INACTIVO);
    });

    it('c) el módulo cdh se apagó antes del canje → inactivo', () => {
      assert.deepEqual(evaluarCanje(boletoCarla(), ctx('10:00:05.000', { modulo: { ...cdh(), activo: false } })), INACTIVO);
    });

    it('c) la fila del módulo ya no existe → inactivo', () => {
      assert.deepEqual(evaluarCanje(boletoCarla(), ctx('10:00:05.000', { modulo: null })), INACTIVO);
    });

    it('c) la fila del módulo es de otro módulo (crm) → inactivo', () => {
      assert.deepEqual(evaluarCanje(boletoCarla(), ctx('10:00:05.000', { modulo: modulo('crm') })), INACTIVO);
    });

    it('d) el usuario recibido es Eva, no la dueña del boleto → inactivo', () => {
      assert.deepEqual(evaluarCanje(boletoCarla(), ctx('10:00:05.000', { usuario: usuario('eva') })), INACTIVO);
    });

    it('e) el acceso recibido es de otra persona → inactivo', () => {
      const acceso = { ...accesoCarla(), usuario_id: ID.eva };
      assert.deepEqual(evaluarCanje(boletoCarla(), ctx('10:00:05.000', { acceso })), INACTIVO);
      assert.deepEqual(evaluarCanje(boletoCarla(), ctx('10:00:05.000', { acceso: accesoDe('eva', 'cdh') })), INACTIVO);
    });

    it('e) el acceso recibido es de crm para un boleto cdh → inactivo', () => {
      const acceso = { ...accesoCarla(), modulo: 'crm' as const };
      assert.deepEqual(evaluarCanje(boletoCarla(), ctx('10:00:05.000', { acceso })), INACTIVO);
      const ana = usuario('ana');
      const boletoAna = boletoCarla({ usuario_id: ID.ana, usuario_modulo: 'sistemas' });
      assert.deepEqual(
        evaluarCanje(boletoAna, ctx('10:00:05.000', { usuario: ana, acceso: accesoDe('ana', 'crm') })),
        INACTIVO,
      );
    });

    it('f) camino feliz: devuelve el usuario_modulo de la fila actual', () => {
      assert.deepEqual(evaluarCanje(boletoCarla(), ctx('10:00:05.000', { acceso: accesoCarla() })), {
        ok: true,
        usuario_modulo: 'carla.ama',
      });
    });

    it('f) la comparación con el boleto no distingue mayúsculas y devuelve la fila actual', () => {
      const acceso = { ...accesoCarla(), usuario_modulo: 'Carla.Ama' };
      assert.deepEqual(evaluarCanje(boletoCarla(), ctx('10:00:05.000', { acceso })), {
        ok: true,
        usuario_modulo: 'Carla.Ama',
      });
      const boletoMayus = boletoCarla({ usuario_modulo: 'CARLA.AMA' });
      assert.deepEqual(evaluarCanje(boletoMayus, ctx('10:00:05.000', { acceso: accesoCarla() })), {
        ok: true,
        usuario_modulo: 'carla.ama',
      });
    });
  });
});
