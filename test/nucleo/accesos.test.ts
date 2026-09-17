import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { modulosVisibles, puedeEntrar, puedeQuitarAdmin, validarEntrada } from '../../src/nucleo/accesos.ts';
import type { Usuario } from '../../src/nucleo/tipos.ts';
import { ID, accesoDe, accesos, modulo, modulos, usuario, usuarios } from './datos.ts';

describe('R1 · modulosVisibles', () => {
  it('Ana ve [crm, cdh]', () => {
    assert.deepEqual(modulosVisibles(usuario('ana'), modulos(), accesos()), ['crm', 'cdh']);
  });

  it('Beto ve [crm] (no tiene fila de cdh)', () => {
    assert.deepEqual(modulosVisibles(usuario('beto'), modulos(), accesos()), ['crm']);
  });

  it('Carla ve [cdh] (no tiene fila de crm)', () => {
    assert.deepEqual(modulosVisibles(usuario('carla'), modulos(), accesos()), ['cdh']);
  });

  it('Dani no ve nada: usuario inactivo', () => {
    assert.deepEqual(modulosVisibles(usuario('dani'), modulos(), accesos()), []);
  });

  it('Eva ve [cdh]: su acceso crm está inactivo', () => {
    assert.deepEqual(modulosVisibles(usuario('eva'), modulos(), accesos()), ['cdh']);
  });

  it('Ana con modulos.cdh.activo = false ve [crm]', () => {
    const ms = modulos().map((m) => (m.codigo === 'cdh' ? { ...m, activo: false } : m));
    assert.deepEqual(modulosVisibles(usuario('ana'), ms, accesos()), ['crm']);
  });

  it('ordena por orden, no alfabéticamente ni por posición en la lista', () => {
    const invertidos = modulos().reverse();
    assert.deepEqual(modulosVisibles(usuario('ana'), invertidos, accesos()), ['crm', 'cdh']);
    const cambiados = modulos().map((m) => ({ ...m, orden: m.codigo === 'crm' ? 20 : 10 }));
    assert.deepEqual(modulosVisibles(usuario('ana'), cambiados, accesos()), ['cdh', 'crm']);
  });

  it('ser admin no da módulos por sí solo', () => {
    const jefa: Usuario = { id: 'admin-sin-accesos', correo: 'jefa@quartz.example', nombre: 'Jefa', es_admin: true, activo: true };
    assert.deepEqual(modulosVisibles(jefa, modulos(), accesos()), []);
  });

  it('un acceso cdh sin usuario_modulo no se muestra', () => {
    const as = accesos().map((a) =>
      a.usuario_id === ID.carla && a.modulo === 'cdh' ? { ...a, usuario_modulo: null } : a,
    );
    assert.deepEqual(modulosVisibles(usuario('carla'), modulos(), as), []);
  });
});

describe('R1/R3 · puedeEntrar', () => {
  it('Carla pide cdh → ok', () => {
    assert.deepEqual(puedeEntrar(usuario('carla'), modulo('cdh'), accesoDe('carla', 'cdh')), { ok: true });
  });

  it('Beto pide cdh → sin_acceso', () => {
    assert.deepEqual(puedeEntrar(usuario('beto'), modulo('cdh'), accesoDe('beto', 'cdh')), {
      ok: false,
      motivo: 'sin_acceso',
    });
  });

  it('Carla pide xyz → modulo_desconocido', () => {
    assert.deepEqual(puedeEntrar(usuario('carla'), modulo('xyz'), null), { ok: false, motivo: 'modulo_desconocido' });
  });

  it('Ana pide crm → ok', () => {
    assert.deepEqual(puedeEntrar(usuario('ana'), modulo('crm'), accesoDe('ana', 'crm')), { ok: true });
  });

  it('Dani pide cdh → usuario_inactivo', () => {
    assert.deepEqual(puedeEntrar(usuario('dani'), modulo('cdh'), accesoDe('dani', 'cdh')), {
      ok: false,
      motivo: 'usuario_inactivo',
    });
  });

  it('Eva pide crm → acceso_inactivo', () => {
    assert.deepEqual(puedeEntrar(usuario('eva'), modulo('crm'), accesoDe('eva', 'crm')), {
      ok: false,
      motivo: 'acceso_inactivo',
    });
  });

  it('Ana pide cdh con el módulo apagado → modulo_inactivo', () => {
    const cdh = modulo('cdh');
    assert.ok(cdh);
    assert.deepEqual(puedeEntrar(usuario('ana'), { ...cdh, activo: false }, accesoDe('ana', 'cdh')), {
      ok: false,
      motivo: 'modulo_inactivo',
    });
  });

  it('acceso cdh con usuario_modulo nulo → sin_usuario_modulo', () => {
    const a = accesoDe('carla', 'cdh');
    assert.ok(a);
    assert.deepEqual(puedeEntrar(usuario('carla'), modulo('cdh'), { ...a, usuario_modulo: null }), {
      ok: false,
      motivo: 'sin_usuario_modulo',
    });
  });

  it('acceso crm con usuario_modulo nulo sí entra', () => {
    assert.deepEqual(puedeEntrar(usuario('beto'), modulo('crm'), accesoDe('beto', 'crm')), { ok: true });
  });
});

describe('R2.2 · validarEntrada', () => {
  it('Ana (activa) → ok', () => {
    assert.equal(validarEntrada(usuario('ana')), 'ok');
  });

  it('sin fila en core.usuarios → sin_acceso', () => {
    assert.equal(validarEntrada(null), 'sin_acceso');
  });

  it('Dani (inactivo) → desactivado', () => {
    assert.equal(validarEntrada(usuario('dani')), 'desactivado');
  });
});

describe('R6 · puedeQuitarAdmin', () => {
  it('Ana es la única admin activa: no puede quitarse ni desactivarse', () => {
    assert.deepEqual(puedeQuitarAdmin(ID.ana, usuarios()), { ok: false, motivo: 'ultimo_admin' });
  });

  it('con dos admins activos, se le puede quitar a uno', () => {
    const us = usuarios().map((u) => (u.id === ID.beto ? { ...u, es_admin: true } : u));
    assert.deepEqual(puedeQuitarAdmin(ID.ana, us), { ok: true });
    assert.deepEqual(puedeQuitarAdmin(ID.beto, us), { ok: true });
  });

  it('un admin inactivo no cuenta', () => {
    const us = usuarios().map((u) => (u.id === ID.dani ? { ...u, es_admin: true } : u));
    assert.deepEqual(puedeQuitarAdmin(ID.ana, us), { ok: false, motivo: 'ultimo_admin' });
  });

  it('quitar/desactivar a alguien que no es admin activo siempre se puede', () => {
    assert.deepEqual(puedeQuitarAdmin(ID.beto, usuarios()), { ok: true });
    const us = usuarios().map((u) => (u.id === ID.dani ? { ...u, es_admin: true } : u));
    assert.deepEqual(puedeQuitarAdmin(ID.dani, us), { ok: true });
  });
});
