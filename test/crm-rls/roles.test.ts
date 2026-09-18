/**
 * Fase 03 · R8: blindaje del CRM ante cuentas que no son de ventas (PRD §7-R8).
 *
 * Las pruebas viven aquí, en el repo del shell, pero el SQL que se prueba es el
 * **real del CRM**: se leen `nube.sql`, `roles.sql` y `firmas.sql` del clon que
 * apunte `CRM_REPO`, se cargan en el Postgres 16 local sobre un Supabase
 * simulado (`test/apoyo/supabase-simulado.sql`) y se consulta como `anon` y
 * como `authenticated`, igual que lo haría el navegador.
 *
 * Cada fila de la tabla R8 se prueba **dos veces**:
 *
 *   · «antes»   → contra el `roles.sql` tal como está **commiteado** en el CRM.
 *                 Documenta el hueco: una cuenta que no está en la lista cae
 *                 en el `ejecutivo` por omisión y alcanza a ver cosas.
 *   · «después» → contra el `roles.sql` del **árbol de trabajo** del CRM, que
 *                 es donde la fase 03 hace su único cambio.
 *
 * Mientras la fase 03 no toque `roles.sql`, las dos variantes son el mismo
 * archivo y las pruebas de «después» de Carla fallan. Eso es el rojo que se
 * espera aquí: falta implementación, no hay error de sintaxis.
 *
 * Variables de entorno:
 *   CRM_REPO      ruta al clon del CRM            (por omisión `../CRM-VENTAS-`)
 *   CRM_REF_BASE  referencia git de la línea base (por omisión, el commit fijo
 *                 `BASE_PUBLICADA`; ver la nota de `refBase()`)
 *   DATABASE_URL_TEST  Postgres de pruebas, nunca Supabase (PRD §9)
 *
 * Corre con:
 *   docker compose -f docker-compose.test.yml up -d pg
 *   CRM_REPO=../CRM-VENTAS- npm run test:crm-rls
 */
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANA,
  BETO,
  BETO_MAYUSCULAS,
  CARLA,
  CATA,
  CLAVE_V_BETO,
  DE_BETO,
  DE_CATA,
  DORA,
  ELSA,
  GABY,
  HUECO_DE_CARLA,
  REF_BASE,
  SEMILLA,
  TODO,
  baseCruda,
  baseDelCRM,
  bitacoraQueVe,
  buzonQueVe,
  como,
  conClave,
  deshacerCompleto,
  deshacerDocumentado,
  editaConAndamio,
  intentaEditar,
  intentaInsertar,
  intentaMarcarAplicada,
  loQueVe,
  rolDe,
  rolesSql,
  sembrar,
  sembrarBuzon,
  sqlDelArbol,
} from './apoyo-crm.ts';
import type { Base } from './apoyo-crm.ts';


// ---------------------------------------------------------------------------
// Las dos bases, una por variante
// ---------------------------------------------------------------------------

// Se crean con `await` de módulo y no en un gancho `before`: bajo `node --test`
// los `before` de nivel raíz arrancan a la vez y sin esperarse (ver la nota en
// `test/apoyo/pg.ts`), y estas pruebas necesitan la base ya sembrada.
const antes: Base = await baseDelCRM('antes');
const despues: Base = await baseDelCRM('despues');

after(async () => {
  await antes.destruir();
  await despues.destruir();
});

// ---------------------------------------------------------------------------
// R8 · antes: el hueco, tal como está hoy
// ---------------------------------------------------------------------------

describe(`R8 · antes (roles.sql de ${REF_BASE})`, () => {
  it('Beto (ejecutivo en la lista) ve lo suyo y lo que no tiene dueño', async () => {
    assert.deepEqual(await loQueVe(antes, BETO), DE_BETO);
  });

  it('Ana (admin en la lista) ve todo', async () => {
    assert.deepEqual(await loQueVe(antes, ANA), TODO);
  });

  it('Gaby (gerente en la lista) ve todo', async () => {
    assert.deepEqual(await loQueVe(antes, GABY), TODO);
  });

  it('Cata (captura en la lista) ve sus prospectos, ajustes y usuarios', async () => {
    assert.deepEqual(await loQueVe(antes, CATA), DE_CATA);
  });

  it('Carla (fuera de la lista) cae en el ejecutivo por omisión: ve catálogo, usuarios y lo sin dueño', async () => {
    assert.equal(await rolDe(antes, CARLA), 'ejecutivo', 'este es el hueco que cierra la fase 03');
    assert.deepEqual(await loQueVe(antes, CARLA), HUECO_DE_CARLA);
  });

  it('Dora (en la lista pero dada de baja) cae en el mismo hueco', async () => {
    assert.equal(await rolDe(antes, DORA), 'ejecutivo', 'su fila dice admin, pero está borrada: no cuenta');
    assert.deepEqual(await loQueVe(antes, DORA), HUECO_DE_CARLA);
  });

  it('Carla, además, puede escribir', async () => {
    assert.equal(await intentaInsertar(antes, CARLA), null, 'hoy nadie la frena al insertar');
    assert.equal(await intentaEditar(antes, CARLA, 'clientes:c-sin'), 1, 'hoy alcanza a editar lo que no tiene dueño');
  });
});

// ---------------------------------------------------------------------------
// R8 · después: lo que la fase 03 tiene que lograr
// ---------------------------------------------------------------------------

describe('R8 · después (roles.sql del árbol de trabajo del CRM)', () => {
  it('Carla queda en el papel `ninguno`', async () => {
    assert.equal(
      await rolDe(despues, CARLA),
      'ninguno',
      'crm_rol() debe devolver `ninguno` cuando el correo no está en la lista',
    );
  });

  it('Carla no lee nada: cero filas de cualquier tipo', async () => {
    assert.deepEqual(await loQueVe(despues, CARLA), [], 'una cuenta fuera de la lista lee 0 filas de crm_datos');
  });

  it('Carla no lee la bitácora', async () => {
    assert.equal(await bitacoraQueVe(despues, CARLA), 0);
  });

  it('a Carla le rechazan insertar', async () => {
    const error = await intentaInsertar(despues, CARLA);
    assert.match(String(error), /row-level security/i, 'el INSERT de una cuenta fuera de la lista debe ser rechazado');
  });

  it('a Carla le rechazan editar, incluso lo que no tiene dueño', async () => {
    assert.equal(await intentaEditar(despues, CARLA, 'clientes:c-sin'), 0);
    assert.equal(await intentaEditar(despues, CARLA, 'ajustes:global'), 0);
  });

  // Las dos que siguen son la mitad de «update rechazado» de verdad: con el
  // andamio, la política de lectura ya no tapa a `edita`, y cada una mira una
  // de sus dos cláusulas. Ver la nota de los andamios, más arriba.

  it('el `using` de `edita` frena a Carla por sí solo, sin ayuda de la política de lectura', async () => {
    const intento = await editaConAndamio(despues, CARLA, 'clientes:c-sin', 'lectura');
    assert.equal(
      intento.error,
      null,
      'con la fila a la vista, el `using` de `edita` debe dejarla fuera antes de llegar al `with check`',
    );
    assert.equal(intento.filas, 0, 'el `using` de `edita` tiene que descartar la fila para el papel `ninguno`');
  });

  it('el `with check` de `edita` también frena a Carla por sí solo', async () => {
    const intento = await editaConAndamio(despues, CARLA, 'clientes:c-sin', 'escritura');
    assert.equal(intento.filas, null, 'con el `using` apartado, el `with check` de `edita` tiene que rechazar');
    assert.match(String(intento.error), /row-level security/i);
  });

  it('el andamio sí deja pasar a quien le toca (si no, las dos de arriba probarían el andamio)', async () => {
    const suyo = await editaConAndamio(despues, BETO, 'clientes:c-beto', 'lectura');
    assert.deepEqual(suyo, { filas: 1, error: null }, 'Beto edita lo suyo con el andamio puesto');
    const ajeno = await editaConAndamio(despues, BETO, 'clientes:c-gaby', 'lectura');
    assert.deepEqual(ajeno, { filas: 0, error: null }, 'y el `using` de `edita` le sigue negando la cartera de Gaby');
  });

  it('Dora, dada de baja de la lista, queda en `ninguno` y no lee nada', async () => {
    assert.equal(
      await rolDe(despues, DORA),
      'ninguno',
      'crm_yo() sólo mira la lista viva: una fila con borrado = true no da papel, ni aunque diga admin',
    );
    assert.deepEqual(await loQueVe(despues, DORA), [], 'una cuenta dada de baja lee 0 filas de crm_datos');
    assert.equal(await bitacoraQueVe(despues, DORA), 0);
    assert.match(String(await intentaInsertar(despues, DORA)), /row-level security/i);
  });

  it('el correo no distingue mayúsculas: token en MAYÚSCULAS contra lista en minúsculas', async () => {
    assert.equal(await rolDe(despues, BETO_MAYUSCULAS), 'ejecutivo', 'BETO@QUARTZ.EXAMPLE es el mismo Beto de la lista');
    assert.deepEqual(await loQueVe(despues, BETO_MAYUSCULAS), DE_BETO, 'y ve exactamente lo mismo que Beto');
  });

  it('el correo no distingue mayúsculas: token en minúsculas contra lista en MAYÚSCULAS', async () => {
    assert.equal(await rolDe(despues, ELSA), 'gerente', 'la fila de Elsa trae el correo capturado con mayúsculas');
    assert.deepEqual(await loQueVe(despues, ELSA), TODO, 'y como gerente ve todo');
  });

  it('Beto, Ana, Gaby, Cata y Elsa ven exactamente lo mismo que antes', async () => {
    for (const [quien, actor] of [
      ['Beto', BETO],
      ['Ana', ANA],
      ['Gaby', GABY],
      ['Cata', CATA],
      ['Elsa', ELSA],
    ] as const) {
      assert.deepEqual(await loQueVe(despues, actor), await loQueVe(antes, actor), `${quien} no debe notar el cambio`);
    }
  });

  it('la bitácora sigue siendo de gerencia, con los mismos conteos', async () => {
    for (const [quien, actor] of [
      ['Ana', ANA],
      ['Gaby', GABY],
      ['Beto', BETO],
      ['Cata', CATA],
    ] as const) {
      assert.equal(await bitacoraQueVe(despues, actor), await bitacoraQueVe(antes, actor), `${quien} no debe notar el cambio`);
    }
  });

  it('Beto y Cata siguen pudiendo escribir lo que les toca', async () => {
    assert.equal(await intentaInsertar(despues, BETO), null);
    assert.equal(await intentaInsertar(despues, CATA, 'prospectos'), null);
    assert.equal(await intentaEditar(despues, BETO, 'clientes:c-beto'), 1);
  });

  it('a Cata le siguen rechazando los ajustes y la lista de usuarios', async () => {
    assert.match(String(await intentaInsertar(despues, CATA, 'ajustes')), /row-level security/i);
    assert.match(String(await intentaInsertar(despues, CATA, 'usuarios')), /row-level security/i);
  });
});

// ---------------------------------------------------------------------------
// La firma anónima no se toca (firmas.sql)
// ---------------------------------------------------------------------------

describe('firmas.sql · el cliente sin cuenta sigue firmando', () => {
  for (const [variante, base] of [
    ['antes', antes],
    ['después', despues],
  ] as const) {
    it(`${variante}: con la clave correcta lee su convenio y sólo el suyo`, async () => {
      assert.deepEqual(await loQueVe(base, conClave(CLAVE_V_BETO)), ['convenios:v-beto']);
    });

    it(`${variante}: sin clave no ve nada`, async () => {
      assert.deepEqual(await loQueVe(base, { rol: 'anon' }), []);
    });

    it(`${variante}: con una clave que no es, no ve nada`, async () => {
      assert.deepEqual(await loQueVe(base, conClave('clave-inventada')), []);
    });

    it(`${variante}: deja su firma en el buzón con la clave correcta`, async () => {
      await como(base, conClave(CLAVE_V_BETO), async (c) => {
        await c.query(
          `INSERT INTO public.crm_firmas (convenio_id, token, nombre) VALUES ($1, $2, $3)`,
          ['v-beto', CLAVE_V_BETO, 'Quien firma'],
        );
      });
    });

    it(`${variante}: con una clave que no es, no puede dejar firma`, async () => {
      await assert.rejects(
        () =>
          como(base, conClave('clave-inventada'), async (c) => {
            await c.query(`INSERT INTO public.crm_firmas (convenio_id, token) VALUES ($1, $2)`, [
              'v-beto',
              'clave-inventada',
            ]);
          }),
        /row-level security/i,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Los tres archivos siguen siendo re-ejecutables
// ---------------------------------------------------------------------------

describe('nube.sql → roles.sql → firmas.sql', () => {
  it('se pueden correr dos veces seguidas sin fallar', async () => {
    const base = await baseCruda();
    try {
      for (const vuelta of [1, 2]) {
        for (const archivo of ['nube.sql', 'roles.sql', 'firmas.sql']) {
          const sql = archivo === 'roles.sql' ? rolesSql('despues') : sqlDelArbol(archivo);
          await assert.doesNotReject(() => base.pool.query(sql), `${archivo}, vuelta ${vuelta}`);
        }
      }
    } finally {
      await base.destruir();
    }
  });
});

// ---------------------------------------------------------------------------
// El deshacer que promete roles.sql §5
//
// La sección «5. Para deshacer» del archivo dice, en comentarios, qué correr
// para volver a como estaba —«todos ven todo»— si el blindaje estorba en
// producción. Eso es una promesa de ida y vuelta, y aquí se ejecuta tal cual
// está escrita en el archivo: las líneas no se copian a la prueba, se leen de
// `roles.sql`. Si alguien renombra una política y se le olvida el comentario,
// esto truena.
// ---------------------------------------------------------------------------

/** Las políticas que quedan sobre las dos tablas del CRM, ordenadas. */
async function politicas(base: Base): Promise<string[]> {
  const { rows } = await base.pool.query<{ policyname: string }>(
    `SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename IN ('crm_datos', 'crm_bitacora')
      ORDER BY policyname`,
  );
  return rows.map((r) => r.policyname);
}

describe('roles.sql · el deshacer de §5 devuelve el CRM a como estaba', () => {
  it('documenta el deshacer de las cuatro políticas que crea', async () => {
    const lineas = deshacerDocumentado(rolesSql('despues'));
    assert.equal(lineas.length, 4, `roles.sql crea cuatro políticas; §5 documenta ${lineas.length}`);
    for (const nombre of ['lee lo suyo', 'inserta', 'edita', 'gerencia lee bitacora']) {
      assert.ok(
        lineas.some((l) => l.includes(`"${nombre}"`)),
        `§5 no dice cómo tirar la política "${nombre}"`,
      );
    }
  });

  it('tras correr el deshacer y nube.sql otra vez, todos vuelven a ver todo', async () => {
    const base = await baseCruda();
    try {
      await base.pool.query(sqlDelArbol('nube.sql'));
      await base.pool.query(rolesSql('despues'));
      await base.pool.query(sqlDelArbol('firmas.sql'));
      await sembrar(base);

      // Punto de partida: el blindaje puesto.
      assert.deepEqual(await loQueVe(base, CARLA), [], 'antes de deshacer, Carla no ve nada');

      // Una firma pendiente en el buzón, para ver si vuelve con el resto.
      const firma = await sembrarBuzon(base);
      assert.deepEqual(await buzonQueVe(base, CARLA), [], 'antes de deshacer, Carla tampoco ve el buzón');

      // El deshacer, tal como lo dice el archivo, y nube.sql otra vez. Se corre
      // `deshacerCompleto` y no sólo las líneas `drop policy`: si §5 documenta
      // soltar algo más, aquí se suelta también.
      for (const linea of deshacerCompleto(rolesSql('despues'))) await base.pool.query(linea);
      await base.pool.query(sqlDelArbol('nube.sql'));

      assert.deepEqual(
        await politicas(base),
        ['cliente lee su convenio', 'equipo edita', 'equipo inserta', 'equipo lee', 'equipo lee bitacora'],
        'no debe quedar ni una política de roles.sql, y sí las de nube.sql y firmas.sql',
      );

      for (const [quien, actor] of [
        ['Ana', ANA],
        ['Gaby', GABY],
        ['Beto', BETO],
        ['Cata', CATA],
        ['Carla', CARLA],
        ['Dora', DORA],
      ] as const) {
        assert.deepEqual(await loQueVe(base, actor), TODO, `${quien} debe volver a ver todo`);
        assert.ok((await bitacoraQueVe(base, actor)) > 0, `${quien} debe volver a leer la bitácora`);
      }

      assert.equal(await intentaInsertar(base, CARLA), null, 'y Carla vuelve a poder insertar');
      assert.equal(await intentaEditar(base, CARLA, 'clientes:c-sin'), 1, 'y a poder editar');

      // Y el buzón de firmas también. Las políticas de `firmas.sql` preguntan
      // el papel por `crm_del_equipo()`, así que mientras `crm_rol()` siga viva
      // el deshacer las deja contestando «ninguno» y el buzón se queda cerrado
      // para todo el equipo, en silencio: `buscarFirmasAhora` lee cero
      // pendientes y no reporta nada.
      for (const [quien, actor] of [
        ['Ana', ANA],
        ['Beto', BETO],
        ['Cata', CATA],
        ['Carla', CARLA],
      ] as const) {
        assert.equal((await buzonQueVe(base, actor)).length, 1, `${quien} debe volver a leer el buzón de firmas`);
        assert.equal(
          (await intentaMarcarAplicada(base, actor, firma)).filas,
          1,
          `${quien} debe volver a poder marcar la firma como aplicada`,
        );
      }

      // firmas.sql no se toca al deshacer: el cliente sin cuenta sigue igual.
      assert.deepEqual(
        await loQueVe(base, { rol: 'anon', encabezados: { 'x-firma-token': CLAVE_V_BETO } }),
        ['convenios:v-beto'],
        'la firma anónima no depende de roles.sql',
      );
    } finally {
      await base.destruir();
    }
  });

  // El escenario que reprodujo la revisión, y el que de verdad se va a dar: si
  // la lista de usuarios nunca llegó a la nube, `roles.sql` deja a TODO el
  // mundo en `ninguno` y nadie ve nada. El administrador corre el deshacer para
  // salir del apuro; `crm_datos` vuelve, y el buzón no, sin un solo aviso.
  it('el deshacer también devuelve el buzón cuando la lista de usuarios nunca llegó a la nube', async () => {
    const base = await baseCruda();
    try {
      await base.pool.query(sqlDelArbol('nube.sql'));
      await base.pool.query(rolesSql('despues'));
      await base.pool.query(sqlDelArbol('firmas.sql'));

      // Una nube a medio subir: catálogo y cartera, sin la lista de usuarios.
      const subidas = SEMILLA.filter((x) => x.tipo !== 'usuarios' && x.tipo !== 'prospectos');
      for (const f of subidas) {
        await base.pool.query(
          `INSERT INTO public.crm_datos (id, tipo, datos, duenio, borrado) VALUES ($1, $2, $3::jsonb, $4, $5)`,
          [f.id, f.tipo, JSON.stringify(f.datos), f.duenio, f.borrado ?? false],
        );
      }
      const firma = await sembrarBuzon(base);

      // De entrada, nadie es nadie: ni Ana, la administradora.
      assert.equal(await rolDe(base, ANA), 'ninguno', 'sin lista de usuarios, todos caen en `ninguno`');
      assert.deepEqual(await loQueVe(base, ANA), [], 'y no ve una sola fila');
      assert.deepEqual(await buzonQueVe(base, ANA), [], 'ni el buzón');

      for (const linea of deshacerCompleto(rolesSql('despues'))) await base.pool.query(linea);
      await base.pool.query(sqlDelArbol('nube.sql'));

      for (const [quien, actor] of [
        ['Ana', ANA],
        ['Beto', BETO],
      ] as const) {
        assert.equal(
          (await loQueVe(base, actor)).length,
          subidas.length,
          `${quien} recupera los registros de crm_datos`,
        );
        assert.equal(
          (await buzonQueVe(base, actor)).length,
          1,
          `${quien} tiene que recuperar también el buzón: si no, el CRM deja de recoger firmas y nadie se entera`,
        );
        assert.equal((await intentaMarcarAplicada(base, actor, firma)).filas, 1, `${quien} vuelve a marcar la firma`);
      }
    } finally {
      await base.destruir();
    }
  });
});

// ---------------------------------------------------------------------------
// Un correo repetido en la lista
//
// `crm_yo()` resuelve con `limit 1` y sin `order by`: con dos filas para el
// mismo correo, cuál gana lo decide el plan —el orden físico de la tabla—, y
// entre un papel y otro va de «ve todo» a «no ve nada». Da igual cuál de las
// dos se elija; lo que no puede ser es que dependa de por dónde entró el
// planificador.
// ---------------------------------------------------------------------------

const CORREO_REPETIDO = 'repetida@quartz.example';

/** Siembra las dos filas del correo repetido en el orden pedido y pregunta el papel. */
async function rolConOrden(base: Base, primero: 'admin' | 'captura'): Promise<{ rol: string; ve: number }> {
  const filas =
    primero === 'admin'
      ? [
          ['usuarios:rep-a', 'admin'],
          ['usuarios:rep-b', 'captura'],
        ]
      : [
          ['usuarios:rep-b', 'captura'],
          ['usuarios:rep-a', 'admin'],
        ];
  const c = await despues.pool.connect();
  try {
    await c.query('BEGIN');
    for (const [id, rol] of filas) {
      await c.query(`INSERT INTO public.crm_datos (id, tipo, datos) VALUES ($1, 'usuarios', $2::jsonb)`, [
        id,
        JSON.stringify({ correo: CORREO_REPETIDO, nombre: 'Repetida', rol }),
      ]);
    }
    await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ email: CORREO_REPETIDO, role: 'authenticated' }),
    ]);
    await c.query(`SELECT set_config('request.headers', '{}', true)`);
    await c.query(`SET LOCAL ROLE authenticated`);
    const { rows } = await c.query<{ rol: string }>(`SELECT public.crm_rol() AS rol`);
    const vistas = await c.query<{ n: string }>(`SELECT count(*)::int AS n FROM public.crm_datos`);
    return { rol: rows[0]?.rol ?? '', ve: Number(vistas.rows[0]?.n ?? 0) };
  } finally {
    await c.query('ROLLBACK').catch(() => undefined);
    c.release();
  }
}

describe('roles.sql · crm_yo() con un correo repetido en la lista', () => {
  it('resuelve siempre lo mismo, sin importar en qué orden se capturaron las dos filas', async () => {
    const a = await rolConOrden(despues, 'admin');
    const b = await rolConOrden(despues, 'captura');
    assert.equal(
      a.rol,
      b.rol,
      `crm_yo() elige con \`limit 1\` y sin \`order by\`: capturada primero la fila de admin da ` +
        `\`${a.rol}\` (ve ${a.ve} filas) y capturada al revés da \`${b.rol}\` (ve ${b.ve}). ` +
        `Cuál gane da igual, pero tiene que ser siempre la misma.`,
    );
    assert.equal(a.ve, b.ve, 'y por lo tanto tiene que ver siempre lo mismo');
  });
});
