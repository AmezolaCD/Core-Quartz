import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarUsuarioCdh, validarAsignacion } from '../../src/nucleo/identidades.ts';
import type { Acceso } from '../../src/nucleo/tipos.ts';
import { ID, accesos, usuarios } from './datos.ts';

describe('R7 · normalizarUsuarioCdh', () => {
  it("'Carla.Ama' → 'carla.ama'", () => {
    assert.deepEqual(normalizarUsuarioCdh('Carla.Ama'), { ok: true, valor: 'carla.ama' });
  });

  it('acepta minúsculas, números, punto, guion y guion bajo', () => {
    assert.deepEqual(normalizarUsuarioCdh('rec_2.turno-b'), { ok: true, valor: 'rec_2.turno-b' });
  });

  it('el acceso cdh INACTIVO de una persona ACTIVA sigue ocupando el usuario (Beto, beto.cdh)', () => {
    const conBeto: Acceso[] = [...accesos(), { usuario_id: ID.beto, modulo: 'cdh', usuario_modulo: 'beto.cdh', activo: false }];
    const r = validarAsignacion({ usuario_id: ID.eva, modulo: 'cdh', usuario_modulo: 'beto.cdh' }, conBeto, usuarios());
    assert.deepEqual(r, { ok: false, motivo: 'duplicado', dueno: 'Beto' });
  });

  it("'juan perez' → formato", () => {
    assert.deepEqual(normalizarUsuarioCdh('juan perez'), { ok: false, motivo: 'formato' });
  });

  it('caracteres fuera de [a-z0-9._-] → formato', () => {
    for (const t of ['peña', 'ana@quartz', 'a/b', 'uno;dos']) {
      assert.deepEqual(normalizarUsuarioCdh(t), { ok: false, motivo: 'formato' }, t);
    }
  });

  it('largo: 3 y 40 se aceptan; 2 y 41 no', () => {
    assert.deepEqual(normalizarUsuarioCdh('abc'), { ok: true, valor: 'abc' });
    assert.deepEqual(normalizarUsuarioCdh('a'.repeat(40)), { ok: true, valor: 'a'.repeat(40) });
    assert.deepEqual(normalizarUsuarioCdh('ab'), { ok: false, motivo: 'formato' });
    assert.deepEqual(normalizarUsuarioCdh('a'.repeat(41)), { ok: false, motivo: 'formato' });
  });

  it('vacío → formato', () => {
    assert.deepEqual(normalizarUsuarioCdh(''), { ok: false, motivo: 'formato' });
  });
});

describe('R7 · validarAsignacion', () => {
  const sinCdhDeCarla = (): Acceso[] => accesos().filter((a) => !(a.usuario_id === ID.carla && a.modulo === 'cdh'));

  it("asignar cdh a Carla con 'Carla.Ama' → se guarda como carla.ama", () => {
    const r = validarAsignacion({ usuario_id: ID.carla, modulo: 'cdh', usuario_modulo: 'Carla.Ama' }, sinCdhDeCarla(), usuarios());
    assert.deepEqual(r, { ok: true, usuario_modulo: 'carla.ama' });
  });

  it('Carla vuelve a guardar su propio usuario → no es duplicado', () => {
    const r = validarAsignacion({ usuario_id: ID.carla, modulo: 'cdh', usuario_modulo: 'Carla.Ama' }, accesos(), usuarios());
    assert.deepEqual(r, { ok: true, usuario_modulo: 'carla.ama' });
  });

  it("asignar cdh a Eva con 'carla.ama' → duplicado, dueña Carla", () => {
    const r = validarAsignacion({ usuario_id: ID.eva, modulo: 'cdh', usuario_modulo: 'carla.ama' }, accesos(), usuarios());
    assert.deepEqual(r, { ok: false, motivo: 'duplicado', dueno: 'Carla' });
  });

  it('el duplicado se detecta sin distinguir mayúsculas (en lo nuevo y en lo guardado)', () => {
    const r1 = validarAsignacion({ usuario_id: ID.eva, modulo: 'cdh', usuario_modulo: 'CARLA.AMA' }, accesos(), usuarios());
    assert.deepEqual(r1, { ok: false, motivo: 'duplicado', dueno: 'Carla' });
    const guardadoRaro = accesos().map((a) =>
      a.usuario_id === ID.carla && a.modulo === 'cdh' ? { ...a, usuario_modulo: 'Carla.AMA' } : a,
    );
    const r2 = validarAsignacion({ usuario_id: ID.eva, modulo: 'cdh', usuario_modulo: 'carla.ama' }, guardadoRaro, usuarios());
    assert.deepEqual(r2, { ok: false, motivo: 'duplicado', dueno: 'Carla' });
  });

  it("'amadellaves' a Carla y luego a Eva → la segunda es duplicado de Carla", () => {
    const base = sinCdhDeCarla();
    const r1 = validarAsignacion({ usuario_id: ID.carla, modulo: 'cdh', usuario_modulo: 'amadellaves' }, base, usuarios());
    assert.deepEqual(r1, { ok: true, usuario_modulo: 'amadellaves' });
    const despues: Acceso[] = [...base, { usuario_id: ID.carla, modulo: 'cdh', usuario_modulo: 'amadellaves', activo: true }];
    const r2 = validarAsignacion({ usuario_id: ID.eva, modulo: 'cdh', usuario_modulo: 'amadellaves' }, despues, usuarios());
    assert.deepEqual(r2, { ok: false, motivo: 'duplicado', dueno: 'Carla' });
  });

  it('un acceso inactivo (o de persona inactiva) sigue ocupando el usuario del CDH', () => {
    const r = validarAsignacion({ usuario_id: ID.eva, modulo: 'cdh', usuario_modulo: 'dani.mtto' }, accesos(), usuarios());
    assert.deepEqual(r, { ok: false, motivo: 'duplicado', dueno: 'Dani' });
  });

  it("'juan perez' → formato", () => {
    const r = validarAsignacion({ usuario_id: ID.beto, modulo: 'cdh', usuario_modulo: 'juan perez' }, accesos(), usuarios());
    assert.deepEqual(r, { ok: false, motivo: 'formato' });
  });

  it('cdh con usuario muy corto o muy largo → formato', () => {
    for (const t of ['ab', 'x'.repeat(41)]) {
      const r = validarAsignacion({ usuario_id: ID.beto, modulo: 'cdh', usuario_modulo: t }, accesos(), usuarios());
      assert.deepEqual(r, { ok: false, motivo: 'formato' }, t);
    }
  });

  it('cdh con usuario vacío o nulo → formato', () => {
    for (const t of ['', null]) {
      const r = validarAsignacion({ usuario_id: ID.beto, modulo: 'cdh', usuario_modulo: t }, accesos(), usuarios());
      assert.deepEqual(r, { ok: false, motivo: 'formato' }, String(t));
    }
  });

  it('crm con usuario_modulo → crm_con_usuario', () => {
    const r = validarAsignacion({ usuario_id: ID.carla, modulo: 'crm', usuario_modulo: 'carla.ama' }, accesos(), usuarios());
    assert.deepEqual(r, { ok: false, motivo: 'crm_con_usuario' });
  });

  it('crm con usuario_modulo nulo o vacío → ok con null', () => {
    for (const t of [null, '']) {
      const r = validarAsignacion({ usuario_id: ID.carla, modulo: 'crm', usuario_modulo: t }, accesos(), usuarios());
      assert.deepEqual(r, { ok: true, usuario_modulo: null }, String(t));
    }
  });

  it('el mismo texto en crm de varias personas no es duplicado (sólo cdh es uno a uno)', () => {
    const r = validarAsignacion({ usuario_id: ID.carla, modulo: 'crm', usuario_modulo: null }, accesos(), usuarios());
    assert.deepEqual(r, { ok: true, usuario_modulo: null });
  });
});
