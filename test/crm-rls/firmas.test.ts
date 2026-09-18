/**
 * Fase 03 · R8 (ampliación del 18 sep 2026): el buzón de firmas.
 *
 * `roles.sql` deja al papel `ninguno` sin una sola fila de `crm_datos`, pero el
 * blindaje no acaba ahí. `firmas.sql` crea `public.crm_firmas` —el buzón donde
 * el cliente deposita su firma— con dos políticas que no miran el papel:
 *
 *     create policy "equipo lee firmas"   ... for select to authenticated using (true);
 *     create policy "equipo marca firmas" ... for update to authenticated using (true) with check (true);
 *
 * `to authenticated using (true)` quiere decir «cualquiera que haya entrado al
 * servidor», y eso incluye a la cuenta de intendencia. De ahí salen tres cosas,
 * y las tres se prueban aquí:
 *
 *   1. **Se lee el buzón entero**: nombre, puesto, celular e imagen de la firma
 *      de cada cliente que está por firmar.
 *   2. **Se lee la clave del convenio** (`token`), que es justo lo que abre el
 *      convenio completo como `anon` por la política «cliente lee su convenio».
 *      Ésa es la escalada: de una cuenta que no es de ventas al convenio entero.
 *   3. **Se puede sustituir la firma pendiente** —el CRM graba la falsificada al
 *      cerrar el convenio, lo que rompe la invariante §8.7 «lo firmado no se
 *      altera»— y **marcar como aplicada** una firma legítima para que se pierda.
 *
 * Igual que en `roles.test.ts`, cada cosa se prueba contra dos líneas:
 *
 *   · «antes»   → `firmas.sql` tal como está commiteado en la línea base
 *                 (`REF_BASE`). Documenta el hueco, y como el commit está
 *                 fijado, sigue documentándolo para siempre.
 *   · «después» → `firmas.sql` del árbol de trabajo del CRM, que es donde la
 *                 fase 03 agrega la guarda de papel.
 *
 * Y hay una tercera base a propósito —`soloRoles`: `roles.sql` **ya arreglado**
 * con el buzón **sin arreglar**—, porque es la que enseña lo que motiva esta
 * ampliación: el papel `ninguno` por sí solo no cierra el hueco del buzón.
 *
 * Mientras la fase 03 no toque `firmas.sql`, las pruebas de «después» fallan.
 * Eso es el rojo que se espera aquí: falta implementación, no hay error.
 *
 * Corre con:
 *   CRM_REPO=../CRM-VENTAS- npm run test:crm-rls
 */
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANA,
  BETO,
  CARLA,
  CATA,
  CLAVE_V_BETO,
  COLUMNAS_FIRMA,
  DORA,
  FIRMA_FALSA,
  FIRMA_LEGITIMA,
  GABY,
  REF_BASE,
  baseDelCRM,
  baseSinRoles,
  buzonQueVe,
  clavesQueSaca,
  como,
  conClave,
  firmaIntacta,
  intentaMarcarAplicada,
  intentaSustituir,
  loQueVe,
  rolDe,
  sembrarBuzon,
  sqlDelArbol,
} from './apoyo-crm.ts';
import type { Base, FilaFirma } from './apoyo-crm.ts';

// ---------------------------------------------------------------------------
// Las tres bases
// ---------------------------------------------------------------------------

// Con `await` de módulo y no en un `before`, por lo mismo que en roles.test.ts.

/** El CRM publicado tal cual: `roles.sql` y `firmas.sql` de la línea base. */
const antes: Base = await baseDelCRM('antes', 'antes');

/**
 * El paso intermedio: `roles.sql` ya arreglado (Carla cae en `ninguno`) con el
 * buzón todavía sin guarda. Es la base que justifica esta ampliación.
 */
const soloRoles: Base = await baseDelCRM('despues', 'antes');

/** El árbol de trabajo completo: es lo que la fase 03 tiene que lograr. */
const despues: Base = await baseDelCRM('despues', 'despues');

/**
 * El CRM a medio poner: `nube.sql` y `firmas.sql`, **sin** `roles.sql`.
 *
 * `ROLES.md` declara soportada esta configuración, y es la que sostiene el
 * atajo `to_regprocedure` de `crm_del_equipo()`: sin ese atajo, las reglas del
 * buzón llamarían a una `crm_rol()` que no existe y la recogida de firmas
 * tronaría entera.
 */
const sinRoles: Base = await baseSinRoles();

const idAntes = await sembrarBuzon(antes);
const idSoloRoles = await sembrarBuzon(soloRoles);
const idDespues = await sembrarBuzon(despues);
const idSinRoles = await sembrarBuzon(sinRoles);

after(async () => {
  await antes.destruir();
  await soloRoles.destruir();
  await despues.destruir();
  await sinRoles.destruir();
});

// ---------------------------------------------------------------------------
// El hueco, tal como está publicado
// ---------------------------------------------------------------------------

describe(`firmas.sql · antes (buzón de ${REF_BASE}): el hueco`, () => {
  it('Carla, que no es de ventas, lee el buzón completo: datos de quien firma y la clave del convenio', async () => {
    const buzon = await buzonQueVe(antes, CARLA);
    assert.equal(buzon.length, 1, 'hoy el buzón le baja entero a cualquiera que haya entrado al servidor');
    const fila = buzon[0]!;
    assert.deepEqual(
      {
        convenio_id: fila.convenio_id,
        token: fila.token,
        nombre: fila.nombre,
        puesto: fila.puesto,
        celular: fila.celular,
        img: fila.img,
      },
      {
        convenio_id: FIRMA_LEGITIMA.convenio,
        token: CLAVE_V_BETO,
        nombre: FIRMA_LEGITIMA.nombre,
        puesto: FIRMA_LEGITIMA.puesto,
        celular: FIRMA_LEGITIMA.celular,
        img: FIRMA_LEGITIMA.img,
      },
      'lee las seis columnas, incluida la clave que abre el convenio',
    );
  });

  it('Carla sustituye la firma pendiente por una falsa', async () => {
    const intento = await intentaSustituir(antes, CARLA, idAntes);
    assert.equal(intento.error, null, 'hoy nadie la frena');
    assert.equal(intento.filas, 1, 'el UPDATE alcanza la fila del buzón');
    assert.equal(intento.fila?.nombre, FIRMA_FALSA.nombre, 'y la firma del buzón ya es la falsa');
    assert.equal(intento.fila?.img, FIRMA_FALSA.img, 'la imagen de la firma quedó sustituida');
  });

  it('Carla marca como aplicada una firma legítima, y se pierde', async () => {
    const intento = await intentaMarcarAplicada(antes, CARLA, idAntes);
    assert.equal(intento.error, null);
    assert.equal(intento.filas, 1);
    assert.equal(intento.fila?.aplicada, true, 'el CRM ya no la recogerá: para él está atendida');
  });

  it('Dora, dada de baja de la lista, hace exactamente lo mismo', async () => {
    assert.equal((await buzonQueVe(antes, DORA)).length, 1);
    assert.equal((await intentaSustituir(antes, DORA, idAntes)).filas, 1);
  });

  it('arreglar `roles.sql` no cierra el hueco: el papel `ninguno` sigue leyendo y editando el buzón', async () => {
    assert.equal(await rolDe(soloRoles, CARLA), 'ninguno', 'con roles.sql arreglado, Carla ya no tiene papel');
    assert.deepEqual(await loQueVe(soloRoles, CARLA), [], 'y no lee una sola fila de crm_datos');

    const buzon = await buzonQueVe(soloRoles, CARLA);
    assert.equal(buzon.length, 1, 'y aun así el buzón le sigue bajando entero: `to authenticated using (true)`');
    assert.equal(buzon[0]?.token, CLAVE_V_BETO, 'con la clave del convenio incluida');

    const intento = await intentaSustituir(soloRoles, CARLA, idSoloRoles);
    assert.equal(intento.filas, 1, 'y la sigue pudiendo sustituir');
    assert.equal(intento.fila?.img, FIRMA_FALSA.img);
  });
});

// ---------------------------------------------------------------------------
// Lo que la ampliación de la fase 03 tiene que lograr
// ---------------------------------------------------------------------------

describe('firmas.sql · después (buzón del árbol de trabajo del CRM)', () => {
  it('Carla no lee ni una fila del buzón', async () => {
    assert.deepEqual(
      await buzonQueVe(despues, CARLA),
      [],
      'una cuenta fuera de la lista lee 0 filas de crm_firmas',
    );
  });

  it('Dora, dada de baja, tampoco lee el buzón', async () => {
    assert.deepEqual(await buzonQueVe(despues, DORA), []);
  });

  it('Carla no puede sustituir la firma, y la legítima queda intacta', async () => {
    const intento = await intentaSustituir(despues, CARLA, idDespues);
    assert.equal(intento.filas, 0, 'el UPDATE no debe alcanzar ninguna fila');
    firmaIntacta(intento.fila);
  });

  it('Carla no puede marcarla como aplicada, y sigue pendiente', async () => {
    const intento = await intentaMarcarAplicada(despues, CARLA, idDespues);
    assert.equal(intento.filas, 0);
    firmaIntacta(intento.fila);
  });

  it('Dora tampoco: ni sustituir ni marcar', async () => {
    const sustituir = await intentaSustituir(despues, DORA, idDespues);
    assert.equal(sustituir.filas, 0);
    firmaIntacta(sustituir.fila);
    const marcar = await intentaMarcarAplicada(despues, DORA, idDespues);
    assert.equal(marcar.filas, 0);
    firmaIntacta(marcar.fila);
  });

  // Las dos que siguen son «update rechazado» de verdad: con el andamio puesto
  // sobre `crm_firmas`, la política de lectura ya no tapa a «equipo marca
  // firmas», y cada una mira una de sus dos cláusulas. Ver la nota de los
  // andamios en `apoyo-crm.ts`.

  it('el `using` de «equipo marca firmas» frena a Carla por sí solo, sin ayuda de la política de lectura', async () => {
    const intento = await intentaSustituir(despues, CARLA, idDespues, 'lectura');
    assert.equal(intento.error, null, 'con la fila a la vista, el `using` debe dejarla fuera antes del `with check`');
    assert.equal(intento.filas, 0, 'el `using` tiene que descartar la fila para el papel `ninguno`');
    firmaIntacta(intento.fila);
  });

  it('el `with check` de «equipo marca firmas» también frena a Carla por sí solo', async () => {
    const intento = await intentaSustituir(despues, CARLA, idDespues, 'escritura');
    assert.equal(intento.filas, null, 'con el `using` apartado, el `with check` tiene que rechazar');
    assert.match(String(intento.error), /row-level security/i);
    firmaIntacta(intento.fila);
  });

  it('el andamio sí deja pasar a quien le toca (si no, las dos de arriba probarían el andamio)', async () => {
    const intento = await intentaSustituir(despues, BETO, idDespues, 'lectura');
    assert.equal(intento.error, null, 'Beto recoge del buzón con el andamio puesto');
    assert.equal(intento.filas, 1);
  });
});

// ---------------------------------------------------------------------------
// La escalada, de punta a punta
//
// El buzón no es grave por lo que guarda, sino por lo que abre: la columna
// `token` es la misma clave que la política «cliente lee su convenio» de
// `firmas.sql` acepta como `anon`. Quien saca una clave del buzón abre el
// convenio entero sin cuenta ninguna.
// ---------------------------------------------------------------------------

describe('firmas.sql · la escalada: del buzón a la clave, y de la clave al convenio', () => {
  it(`antes (${REF_BASE}): Carla saca la clave del buzón y con ella abre el convenio como anónima`, async () => {
    const claves = await clavesQueSaca(soloRoles, CARLA);
    assert.deepEqual(claves, [CLAVE_V_BETO], 'el primer eslabón: la clave sale del buzón');

    const robada = claves[0]!;
    assert.deepEqual(
      await loQueVe(soloRoles, conClave(robada)),
      ['convenios:v-beto'],
      'el segundo eslabón: con esa clave, una sesión anónima lee el convenio entero',
    );
  });

  it('después: Carla no consigue ninguna clave del buzón, y la cadena se rompe en el primer eslabón', async () => {
    assert.deepEqual(
      await clavesQueSaca(despues, CARLA),
      [],
      'sin clave no hay escalada: el papel `ninguno` no debe sacar ni un token de crm_firmas',
    );
    assert.deepEqual(await clavesQueSaca(despues, DORA), []);
  });

  it('la clave que el cliente ya tiene en su enlace sigue abriendo su convenio (eso no cambia)', async () => {
    // El control de la prueba anterior: la cadena se rompe porque la clave ya no
    // se puede sacar del buzón, no porque el camino anónimo haya dejado de servir.
    assert.deepEqual(await loQueVe(despues, conClave(CLAVE_V_BETO)), ['convenios:v-beto']);
    assert.deepEqual(await loQueVe(antes, conClave(CLAVE_V_BETO)), ['convenios:v-beto'], 'igual que antes');
  });
});

// ---------------------------------------------------------------------------
// Los cuatro papeles conocidos no notan el cambio
// ---------------------------------------------------------------------------

const CONOCIDOS = [
  ['Ana (admin)', ANA],
  ['Gaby (gerente)', GABY],
  ['Beto (ejecutivo)', BETO],
  ['Cata (captura)', CATA],
] as const;

describe('firmas.sql · los cuatro papeles conocidos siguen recogiendo firmas igual que antes', () => {
  for (const [quien, actor] of CONOCIDOS) {
    it(`${quien} lee el buzón exactamente igual que en ${REF_BASE}`, async () => {
      const viejo = await buzonQueVe(antes, actor);
      const nuevo = await buzonQueVe(despues, actor);
      assert.equal(viejo.length, 1, 'el juego de datos trae una firma pendiente');
      assert.equal(nuevo.length, viejo.length, `${quien} debe seguir viendo los mismos conteos`);
      assert.deepEqual(
        nuevo.map(({ id: _id, ...resto }) => resto),
        viejo.map(({ id: _id, ...resto }) => resto),
        'las mismas columnas, con el mismo contenido',
      );
    });

    it(`${quien} sigue marcando la firma como aplicada`, async () => {
      const viejo = await intentaMarcarAplicada(antes, actor, idAntes);
      const nuevo = await intentaMarcarAplicada(despues, actor, idDespues);
      assert.deepEqual(
        { filas: nuevo.filas, error: nuevo.error },
        { filas: viejo.filas, error: viejo.error },
        `${quien} no debe notar el cambio al marcar`,
      );
      assert.equal(nuevo.filas, 1, 'el equipo sí recoge del buzón');
      assert.equal(nuevo.fila?.aplicada, true);
    });

    it(`${quien} sigue pudiendo corregir la firma recogida`, async () => {
      const viejo = await intentaSustituir(antes, actor, idAntes);
      const nuevo = await intentaSustituir(despues, actor, idDespues);
      assert.deepEqual(
        { filas: nuevo.filas, error: nuevo.error },
        { filas: viejo.filas, error: viejo.error },
        `${quien} no debe notar el cambio al editar`,
      );
      assert.equal(nuevo.filas, 1);
    });
  }
});

// ---------------------------------------------------------------------------
// El cliente anónimo y el buzón
//
// Depositar con clave válida y no poder con una inventada ya está probado en
// `roles.test.ts`. Aquí van sólo las partes que tocan `crm_firmas` de frente y
// que allá no se miran: que el buzón no se lee, que no se edita, y que la fila
// depositada cae pendiente.
// ---------------------------------------------------------------------------

describe('firmas.sql · el cliente anónimo deposita, pero no lee ni corrige el buzón', () => {
  for (const [variante, base, id] of [
    ['antes', antes, idAntes],
    ['después', despues, idDespues],
  ] as const) {
    it(`${variante}: no lee el buzón, ni con la clave correcta en el enlace`, async () => {
      assert.deepEqual(await buzonQueVe(base, conClave(CLAVE_V_BETO)), [], 'no hay política de select para `anon`');
      assert.deepEqual(await buzonQueVe(base, { rol: 'anon' }), []);
    });

    it(`${variante}: no puede marcar como aplicada la firma de nadie`, async () => {
      const intento = await intentaMarcarAplicada(base, conClave(CLAVE_V_BETO), id);
      assert.equal(intento.filas, 0, 'no hay política de update para `anon`');
      firmaIntacta(intento.fila);
    });

    it(`${variante}: deposita con clave válida y la firma cae pendiente de recoger`, async () => {
      // Sin `returning`: un `insert ... returning` exigiría también una política
      // de select, y el visitante no tiene ninguna —que es justo lo que prueba
      // la primera de estas cuatro—. El CRM tampoco lo usa: deposita y se va.
      const fila = await como(base, conClave(CLAVE_V_BETO), async (c) => {
        await c.query(
          `INSERT INTO public.crm_firmas (convenio_id, token, nombre, puesto, celular, img)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          ['v-beto', CLAVE_V_BETO, 'Otra que firma', 'Compras', '3300000000', 'data:image/png;base64,OTRA'],
        );
        await c.query('RESET ROLE');
        const puesta = await c.query<FilaFirma>(`SELECT ${COLUMNAS_FIRMA} FROM public.crm_firmas WHERE nombre = $1`, [
          'Otra que firma',
        ]);
        return puesta.rows[0];
      });
      assert.equal(fila?.nombre, 'Otra que firma', 'la firma del cliente llega al buzón');
      assert.equal(fila?.aplicada, false, 'y llega pendiente: el CRM todavía tiene que recogerla');
    });

    it(`${variante}: no puede depositar una firma ya marcada como aplicada`, async () => {
      await assert.rejects(
        () =>
          como(base, conClave(CLAVE_V_BETO), async (c) => {
            await c.query(
              `INSERT INTO public.crm_firmas (convenio_id, token, nombre, aplicada) VALUES ($1, $2, $3, true)`,
              ['v-beto', CLAVE_V_BETO, 'Colada'],
            );
          }),
        /row-level security/i,
        'el `with check` de «cliente deja su firma» exige aplicada = false',
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Sin roles.sql corrido: nube.sql → firmas.sql
//
// `ROLES.md` dice que `firmas.sql` se puede correr solo, y que hasta que no se
// corra `roles.sql` el buzón se comporta como siempre: lo recoge todo el
// equipo. De eso se encarga el atajo `to_regprocedure` de `crm_del_equipo()`.
// Sin él, las reglas del buzón llamarían a una función que no existe y la
// recogida de firmas tronaría con `function public.crm_rol() does not exist`
// —no «se ve menos»: deja de funcionar—. Quitarlo no rompía ninguna prueba,
// así que aquí queda cubierto.
// ---------------------------------------------------------------------------

describe('firmas.sql · sin roles.sql corrido (nube → firmas), como dice ROLES.md', () => {
  it('`crm_del_equipo()` contesta que sí, sin tronar, porque no hay papeles que mirar', async () => {
    for (const [quien, actor] of [
      ['Ana', ANA],
      ['Beto', BETO],
      ['Carla', CARLA],
    ] as const) {
      const respuesta = await como(sinRoles, actor, async (c) => {
        const { rows } = await c.query<{ x: boolean }>(`SELECT public.crm_del_equipo() AS x`);
        return rows[0]?.x;
      });
      assert.equal(respuesta, true, `${quien}: sin roles.sql corrido, el buzón es de todo el equipo`);
    }
  });

  it('el equipo lee el buzón con normalidad', async () => {
    for (const [quien, actor] of CONOCIDOS) {
      const buzon = await buzonQueVe(sinRoles, actor);
      assert.equal(buzon.length, 1, `${quien} tiene que seguir recogiendo firmas sin roles.sql corrido`);
      assert.equal(buzon[0]?.nombre, FIRMA_LEGITIMA.nombre);
    }
  });

  it('el equipo marca la firma como aplicada con normalidad', async () => {
    for (const [quien, actor] of CONOCIDOS) {
      const intento = await intentaMarcarAplicada(sinRoles, actor, idSinRoles);
      assert.equal(intento.error, null, `${quien} no debe recibir ningún error`);
      assert.equal(intento.filas, 1, `${quien} tiene que poder marcar la firma`);
      assert.equal(intento.fila?.aplicada, true);
    }
  });

  it('y también quien no está en la lista: sin roles.sql no hay lista que valga', async () => {
    // No es un hueco: es el comportamiento de siempre, el que `roles.sql`
    // viene justamente a cerrar. Se fija para que se vea que el atajo no
    // pretende blindar nada por su cuenta.
    assert.equal((await buzonQueVe(sinRoles, CARLA)).length, 1);
    assert.equal((await intentaMarcarAplicada(sinRoles, CARLA, idSinRoles)).filas, 1);
  });

  it('el cliente sin cuenta sigue depositando su firma', async () => {
    await como(sinRoles, conClave(CLAVE_V_BETO), async (c) => {
      await c.query(`INSERT INTO public.crm_firmas (convenio_id, token, nombre) VALUES ($1, $2, $3)`, [
        'v-beto',
        CLAVE_V_BETO,
        'Quien firma sin roles.sql',
      ]);
    });
    assert.deepEqual(await loQueVe(sinRoles, conClave(CLAVE_V_BETO)), ['convenios:v-beto']);
  });

  it('nube.sql → firmas.sql se pueden correr dos veces seguidas sin fallar', async () => {
    for (const vuelta of [1, 2]) {
      for (const archivo of ['nube.sql', 'firmas.sql']) {
        await assert.doesNotReject(() => sinRoles.pool.query(sqlDelArbol(archivo)), `${archivo}, vuelta ${vuelta}`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Con un roles.sql VIEJO aplicado
//
// El otro caso que el atajo se encuentra en producción: `crm_rol()` sí existe,
// pero es la de antes de R8, la que nunca devuelve `ninguno`. Entonces la
// guarda del buzón está puesta y no guarda nada, y no hay forma de que
// `firmas.sql` lo note: la única salida es correr el `roles.sql` nuevo.
//
// Esto no es un hueco de `firmas.sql` ni se puede arreglar desde ahí; se fija
// para que nadie lea la guarda del buzón como una protección que vale sola.
// ---------------------------------------------------------------------------

describe('firmas.sql · con un roles.sql viejo aplicado, la guarda del buzón no guarda', () => {
  it('Carla cae en `ejecutivo` por omisión y el buzón le sigue bajando entero', async () => {
    assert.equal(await rolDe(antes, CARLA), 'ejecutivo', 'el roles.sql viejo no conoce el papel `ninguno`');
    const buzon = await buzonQueVe(antes, CARLA);
    assert.equal(buzon.length, 1, 'con la guarda puesta pero el roles.sql viejo, el buzón sigue abierto');
    assert.equal(buzon[0]?.token, CLAVE_V_BETO, 'incluida la clave del convenio');
  });

  it('en cambio, con el roles.sql nuevo la misma guarda sí cierra', async () => {
    assert.equal(await rolDe(despues, CARLA), 'ninguno');
    assert.deepEqual(await buzonQueVe(despues, CARLA), [], 'la guarda vale en cuanto el papel existe');
  });
});

// ---------------------------------------------------------------------------
// Red estructural: ninguna política del CRM puede quedar abierta de par en par
//
// El hueco del buzón no fue un descuido de redacción: fue el patrón de
// `nube.sql` —`to authenticated using (true)`— aplicado a una tabla nueva sin
// que nadie lo volviera a mirar. Mientras `roles.sql` y `firmas.sql` estén
// corridos, ninguna regla del CRM para gente con cuenta puede decir `true` a
// secas; si mañana aparece otra tabla `crm_*` con ese patrón, esto lo canta.
//
// Ojo con lo que NO dice: un `case … else true` de `inserta` o de `edita` no
// es una regla abierta —ahí el `true` es la última rama de una decisión que ya
// preguntó el papel—, y por eso se mira la cláusula completa y no si contiene
// la palabra.
// ---------------------------------------------------------------------------

interface Regla {
  tablename: string;
  policyname: string;
  cmd: string;
  roles: string[];
  qual: string | null;
  with_check: string | null;
}

describe('el orden documentado nube → roles → firmas no deja ninguna política abierta', () => {
  it('ninguna regla `to authenticated` sobre public.crm_* dice `true` a secas', async () => {
    const { rows } = await despues.pool.query<Regla>(
      `SELECT tablename, policyname, cmd, roles::text[] AS roles, qual, with_check
         FROM pg_policies
        WHERE schemaname = 'public' AND tablename LIKE 'crm\\_%'
        ORDER BY tablename, policyname`,
    );
    assert.ok(rows.length > 0, 'no se encontró ni una política: ¿se cargó el SQL del CRM?');

    const abiertas: string[] = [];
    for (const r of rows) {
      if (!r.roles.includes('authenticated')) continue;
      for (const [clausula, texto] of [
        ['using', r.qual],
        ['with check', r.with_check],
      ] as const) {
        if (texto !== null && texto.trim().toLowerCase() === 'true') {
          abiertas.push(`«${r.policyname}» sobre public.${r.tablename} (${r.cmd}): ${clausula} = true`);
        }
      }
    }

    assert.deepEqual(
      abiertas,
      [],
      `hay ${abiertas.length} regla(s) abiertas de par en par para cualquiera que haya entrado al servidor:\n` +
        abiertas.map((x) => `  · ${x}`).join('\n') +
        `\nEs el patrón de nube.sql. Una tabla nueva del CRM tiene que preguntar el papel, ` +
        `como hacen «lee lo suyo» (roles.sql) y «equipo lee firmas» (firmas.sql).`,
    );
  });

  it('y la red sí distingue: sobre una tabla `crm_*` nueva con el patrón de nube.sql, salta', async () => {
    // Sin esto, la prueba de arriba podría estar pasando porque no encuentra
    // nada, no porque esté todo bien. Se crea la tabla dentro de una
    // transacción que se deshace siempre.
    const c = await despues.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`CREATE TABLE public.crm_nueva (id text primary key)`);
      await c.query(`ALTER TABLE public.crm_nueva ENABLE ROW LEVEL SECURITY`);
      await c.query(`CREATE POLICY "equipo lee nueva" ON public.crm_nueva FOR SELECT TO authenticated USING (true)`);
      const { rows } = await c.query<Regla>(
        `SELECT tablename, policyname, cmd, roles::text[] AS roles, qual, with_check
           FROM pg_policies
          WHERE schemaname = 'public' AND tablename LIKE 'crm\\_%' AND qual = 'true'`,
      );
      assert.deepEqual(
        rows.map((r) => `${r.tablename}.${r.policyname}`),
        ['crm_nueva.equipo lee nueva'],
        'la consulta de la red tiene que encontrar exactamente la tabla nueva',
      );
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      c.release();
    }
  });
});
