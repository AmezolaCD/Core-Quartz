/**
 * Fase 03 · R8 (ampliación del 18 sep 2026): la pantalla «¿Por qué no veo algo?».
 *
 * Con el papel `ninguno` puesto, a una cuenta que no es de ventas el servidor
 * deja de entregarle **todo**: cero filas, y por lo tanto cero filas de
 * usuarios. La pantalla de diagnóstico (`revisarPermisos` / `pantallaPermisos`
 * en el `index.html` del CRM) lee justo eso, y hoy de «cero filas de usuarios»
 * concluye lo que antes era cierto y desde este cambio ya no:
 *
 *     «La nube no tiene la lista de usuarios … Sin ella el servidor trata a
 *      todos como ejecutivos sin nombre»
 *
 * Son dos casos distintos y hay que distinguirlos:
 *
 *   · llegaron filas, pero ninguna de usuarios  → la lista no llegó a la nube;
 *   · no llegó ni una fila                      → tu correo no está en la lista.
 *
 * ## Cómo se prueba esto sin navegador
 *
 * No con `grep`. Las dos funciones se **sacan del `index.html` real** (por sus
 * llaves) y se **ejecutan** aquí con `new Function`, pasándoles de fuera lo
 * único que necesitan del navegador: `api`, `modal`, `esc`, `esAdmin`… Lo que
 * corre es el código de producción, sin copiarlo ni reescribirlo:
 *
 *   · `revisarPermisos` se corre contra un `api()` fingido que devuelve las
 *     filas que el servidor entregaría, y se mira el diagnóstico que arma;
 *   · `pantallaPermisos` se corre contra un `revisarPermisos` fingido que
 *     devuelve un diagnóstico armado a mano, y se mira **qué mensaje pinta**;
 *   · y las dos encadenadas, que es el caso de verdad: el servidor no entrega
 *     nada → la pantalla tiene que decir «tu correo no está en la lista».
 *
 * Lo único que estas pruebas no ven es el navegador en sí (que el modal se
 * dibuje, que los botones respondan). Para eso está la fase 09.
 *
 * Si la fase 03 acaba usando en las ramas algo que no sea el diagnóstico —una
 * función global nueva—, `new Function` truena con un ReferenceError claro y
 * basta con agregarla a `DEPENDENCIAS`.
 *
 * Corre con:
 *   CRM_REPO=../CRM-VENTAS- npm run test:crm-rls
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CRM } from './apoyo-crm.ts';

const INDEX = readFileSync(path.join(CRM, 'index.html'), 'utf8');

// ---------------------------------------------------------------------------
// Sacar una función del index.html por sus llaves
// ---------------------------------------------------------------------------

/**
 * El texto de `function nombre(...){ … }`, contando llaves desde la primera.
 *
 * Es un recuento ingenuo —no entiende de cadenas ni de comentarios—, así que
 * se comprueba a la salida que lo recortado sea una función válida: si algún
 * día deja de serlo, la prueba lo dice en vez de medir cualquier cosa.
 */
function funcionDelIndex(nombre: string): string {
  let i = INDEX.indexOf(`function ${nombre}(`);
  assert.ok(i >= 0, `index.html ya no define \`function ${nombre}(\``);
  if (INDEX.slice(Math.max(0, i - 6), i) === 'async ') i -= 6;

  let abiertas = 0;
  let vistaAlguna = false;
  for (let j = i; j < INDEX.length; j++) {
    const ch = INDEX[j];
    if (ch === '{') {
      abiertas++;
      vistaAlguna = true;
    } else if (ch === '}') {
      abiertas--;
      if (vistaAlguna && abiertas === 0) {
        const fuente = INDEX.slice(i, j + 1);
        assert.doesNotThrow(
          () => new Function(`${fuente}\nreturn ${nombre};`),
          `lo recortado de \`${nombre}\` no es una función válida: el recuento de llaves se perdió`,
        );
        return fuente;
      }
    }
  }
  assert.fail(`no se encontró el cierre de \`${nombre}\` en index.html`);
}

/** El objeto `NOMBRE_TIPO`, tal como está en el archivo (lo usa la tabla). */
function nombreTipoDelIndex(): Record<string, string> {
  const m = INDEX.match(/const NOMBRE_TIPO = \{[\s\S]*?\};/);
  assert.ok(m, 'index.html ya no define `const NOMBRE_TIPO`');
  const armar = new Function(`${m[0]}\nreturn NOMBRE_TIPO;`) as () => Record<string, string>;
  return armar();
}

const FUENTE_REVISAR = funcionDelIndex('revisarPermisos');
const FUENTE_PANTALLA = funcionDelIndex('pantallaPermisos');
const NOMBRE_TIPO = nombreTipoDelIndex();

/**
 * Todo lo que las dos funciones toman de fuera. Van como parámetros de
 * `new Function`, así que cada prueba decide qué les entrega.
 */
type Dependencias = Record<string, unknown>;

function arma<T>(fuente: string, nombre: string, deps: Dependencias): T {
  const nombres = Object.keys(deps);
  const crear = new Function(...nombres, `${fuente}\nreturn ${nombre};`) as (...args: unknown[]) => T;
  return crear(...nombres.map((n) => deps[n]));
}

// ---------------------------------------------------------------------------
// El diagnóstico que `revisarPermisos` arma
// ---------------------------------------------------------------------------

interface Diagnostico {
  correo: string;
  conDuenio: boolean;
  conteo: Record<string, number>;
  total: number;
  conDuenioN: number;
  usuariosNube: number;
  meReconoce: boolean;
  rolNube: string;
  nombreNube: string;
  rolLocal: string;
  nombreLocal: string;
}

interface FilaServidor {
  id: string;
  tipo: string;
  duenio?: string | null;
  datos: Record<string, unknown>;
}

/** Corre el `revisarPermisos` real contra un servidor fingido. */
function revisarPermisos(
  filas: FilaServidor[] | (() => Promise<FilaServidor[]>),
  correo = 'carla@quartz.example',
  rolLocal = 'ejecutivo',
): Promise<Diagnostico> {
  const api = typeof filas === 'function' ? filas : async () => filas;
  const fn = arma<() => Promise<Diagnostico>>(FUENTE_REVISAR, 'revisarPermisos', {
    api,
    correoSesion: () => correo,
    rolActual: () => rolLocal,
    miNombre: () => '',
  });
  return fn();
}

/** Un diagnóstico armado a mano, con los valores de una nube sana por omisión. */
function diagnostico(parcial: Partial<Diagnostico>): Diagnostico {
  return {
    correo: 'carla@quartz.example',
    conDuenio: true,
    conteo: {},
    total: 0,
    conDuenioN: 0,
    usuariosNube: 0,
    meReconoce: false,
    rolNube: '',
    nombreNube: '',
    rolLocal: 'ejecutivo',
    nombreLocal: '',
    ...parcial,
  };
}

// ---------------------------------------------------------------------------
// El mensaje que `pantallaPermisos` acaba pintando
// ---------------------------------------------------------------------------

/**
 * Las cuatro cosas que la pantalla puede acabar diciendo. Se reconocen por un
 * trozo corto y no por el párrafo entero, para que la fase 03 pueda reescribir
 * la redacción sin romper esto: lo que se prueba es **cuál rama se eligió**.
 */
const MENSAJES = {
  'lista-no-llego': /no tiene la lista de usuarios/i,
  'correo-fuera-de-la-lista': /correo no est[áa] en la lista/i,
  'papel-distinto': /te tiene con otro papel/i,
  'todo-en-orden': /todo en orden/i,
} as const;

type Mensaje = keyof typeof MENSAJES;

/** Corre el `pantallaPermisos` real y devuelve cuál mensaje pintó. */
async function mensajeDe(r: Diagnostico, soyAdmin = false): Promise<Mensaje> {
  const cuerpo = { innerHTML: '', querySelector: () => ({}) };
  const ov = { querySelector: () => cuerpo, remove: () => undefined };

  const fn = arma<() => void>(FUENTE_PANTALLA, 'pantallaPermisos', {
    modal: () => ov,
    esc: (s: unknown) => String(s ?? ''),
    esAdmin: () => soyAdmin,
    infoRol: (rol: string) => ({ name: rol || 'no registrado' }),
    nombresDeRol: () => 'Ana',
    NOMBRE_TIPO,
    revisarPermisos: async () => r,
    empujarUsuarios: async () => undefined,
    bajarTodo: async () => undefined,
    alert: () => undefined,
  });

  fn();
  await new Promise((listo) => setTimeout(listo, 0));

  const html = cuerpo.innerHTML;
  assert.ok(html, 'la pantalla no pintó nada: revisa las dependencias que se le pasan');
  assert.doesNotMatch(html, /errbox/, `la pantalla tronó en vez de pintar: ${html}`);

  const encontrados = (Object.keys(MENSAJES) as Mensaje[]).filter((k) => MENSAJES[k].test(html));
  assert.equal(
    encontrados.length,
    1,
    `la pantalla tiene que elegir un mensaje y nada más uno; eligió ${encontrados.length} (${encontrados.join(', ')}).\n${html}`,
  );
  return encontrados[0]!;
}

// ---------------------------------------------------------------------------
// 1. Lo que el servidor entrega → el diagnóstico
// ---------------------------------------------------------------------------

/** La lista de usuarios tal como bajaría de una nube sana. */
const USUARIOS_NUBE: FilaServidor[] = [
  { id: 'usuarios:ana', tipo: 'usuarios', duenio: null, datos: { correo: 'ana@quartz.example', nombre: 'Ana', rol: 'admin' } },
  { id: 'usuarios:beto', tipo: 'usuarios', duenio: null, datos: { correo: 'beto@quartz.example', nombre: 'Beto', rol: 'ejecutivo' } },
];

const CATALOGO_NUBE: FilaServidor[] = [
  { id: 'ajustes:global', tipo: 'ajustes', duenio: null, datos: {} },
  { id: 'habitaciones:h1', tipo: 'habitaciones', duenio: null, datos: {} },
  { id: 'clientes:c-beto', tipo: 'clientes', duenio: 'Beto', datos: {} },
];

describe('index.html · revisarPermisos: lo que el servidor entrega', () => {
  it('con el papel `ninguno` no baja ni una fila: 0 totales, 0 de usuarios, no me reconoce', async () => {
    const r = await revisarPermisos([]);
    assert.deepEqual(
      { total: r.total, usuariosNube: r.usuariosNube, meReconoce: r.meReconoce, conDuenio: r.conDuenio },
      { total: 0, usuariosNube: 0, meReconoce: false, conDuenio: true },
      'es la entrada del caso que la fase 03 tiene que distinguir',
    );
  });

  it('con la lista de usuarios en la nube, la cuenta y reconoce al que está', async () => {
    const r = await revisarPermisos([...CATALOGO_NUBE, ...USUARIOS_NUBE], 'beto@quartz.example');
    assert.equal(r.total, 5);
    assert.equal(r.usuariosNube, 2);
    assert.equal(r.meReconoce, true);
    assert.equal(r.rolNube, 'ejecutivo');
    assert.equal(r.conDuenioN, 1, 'cuenta los registros con dueño marcado');
  });

  it('bajan filas pero ninguna de usuarios: ésa sí es «la lista no llegó a la nube»', async () => {
    const r = await revisarPermisos(CATALOGO_NUBE);
    assert.equal(r.total, 3);
    assert.equal(r.usuariosNube, 0);
    assert.equal(r.meReconoce, false);
  });

  it('el correo se coteja sin distinguir mayúsculas ni espacios', async () => {
    const r = await revisarPermisos(
      [{ id: 'usuarios:elsa', tipo: 'usuarios', duenio: null, datos: { correo: '  ELSA@Quartz.Example ', rol: 'gerente' } }],
      'elsa@quartz.example',
    );
    assert.equal(r.meReconoce, true);
    assert.equal(r.rolNube, 'gerente');
  });

  it('si no existe la columna `duenio`, es que no han corrido roles.sql', async () => {
    let primera = true;
    const r = await revisarPermisos(async () => {
      if (primera) {
        primera = false;
        throw new Error('column crm_datos.duenio does not exist');
      }
      return CATALOGO_NUBE;
    });
    assert.equal(r.conDuenio, false, 'se vuelve a preguntar sin la columna y se anota que roles.sql no está');
    assert.equal(r.total, 3);
  });
});

// ---------------------------------------------------------------------------
// 2. El diagnóstico → el mensaje
//
//    Aquí está el criterio de aceptación: la pantalla distingue «la lista no
//    llegó a la nube» de «tu correo no está en la lista».
// ---------------------------------------------------------------------------

describe('index.html · pantallaPermisos: (filas totales, filas de usuarios, me reconoce) → mensaje', () => {
  it('0 filas totales y 0 de usuarios → «tu correo no está en la lista»', async () => {
    assert.equal(
      await mensajeDe(diagnostico({ total: 0, usuariosNube: 0, meReconoce: false })),
      'correo-fuera-de-la-lista',
      'sin una sola fila, el servidor no es que no tenga la lista: es que a ti no te entrega nada',
    );
  });

  it('bajan filas pero 0 de usuarios → «la nube no tiene la lista de usuarios»', async () => {
    assert.equal(
      await mensajeDe(diagnostico({ total: 3, conteo: { ajustes: 1, habitaciones: 1, clientes: 1 }, usuariosNube: 0, meReconoce: false })),
      'lista-no-llego',
      'ése sí es el caso viejo: el servidor entrega, pero la lista nunca se subió',
    );
  });

  it('baja la lista pero mi correo no está en ella → «tu correo no está en la lista»', async () => {
    assert.equal(
      await mensajeDe(diagnostico({ total: 8, usuariosNube: 6, meReconoce: false })),
      'correo-fuera-de-la-lista',
    );
  });

  it('me reconoce y con el mismo papel → todo en orden', async () => {
    assert.equal(
      await mensajeDe(diagnostico({ total: 8, usuariosNube: 6, meReconoce: true, rolNube: 'ejecutivo', rolLocal: 'ejecutivo' })),
      'todo-en-orden',
    );
  });

  it('me reconoce con otro papel → manda el del servidor', async () => {
    assert.equal(
      await mensajeDe(diagnostico({ total: 8, usuariosNube: 6, meReconoce: true, rolNube: 'admin', rolLocal: 'ejecutivo' })),
      'papel-distinto',
    );
  });

  it('sin roles.sql corrido, la pantalla no inventa problemas de papeles', async () => {
    assert.equal(
      await mensajeDe(diagnostico({ conDuenio: false, total: 8, usuariosNube: 0, meReconoce: false })),
      'todo-en-orden',
      'sin la columna `duenio` no hay reglas que expliquen nada: eso lo dice la nota de abajo, no un problema',
    );
  });

  it('una nube sana y un administrador: el mensaje no cambia por quién mira', async () => {
    assert.equal(
      await mensajeDe(diagnostico({ total: 8, usuariosNube: 0, meReconoce: false }), true),
      'lista-no-llego',
      'al administrador se le ofrece además el botón de subir la lista, pero la rama es la misma',
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Las dos encadenadas: el caso de verdad, de punta a punta
// ---------------------------------------------------------------------------

describe('index.html · de punta a punta: el servidor no entrega nada', () => {
  it('cuenta en `ninguno` (0 filas del servidor) → la pantalla dice «tu correo no está en la lista»', async () => {
    const r = await revisarPermisos([]);
    assert.equal(
      await mensajeDe(r),
      'correo-fuera-de-la-lista',
      'es lo que verá la cuenta de intendencia en cuanto la fase 03 esté aplicada',
    );
  });

  it('la lista no se subió (bajan filas, ninguna de usuarios) → la pantalla dice que falta la lista', async () => {
    const r = await revisarPermisos(CATALOGO_NUBE);
    assert.equal(await mensajeDe(r), 'lista-no-llego');
  });

  it('nube sana → todo en orden', async () => {
    const r = await revisarPermisos([...CATALOGO_NUBE, ...USUARIOS_NUBE], 'beto@quartz.example', 'ejecutivo');
    assert.equal(await mensajeDe(r), 'todo-en-orden');
  });
});

// ---------------------------------------------------------------------------
// 4. La frase que dejó de ser cierta
//
//    «trata a todos como ejecutivos sin nombre» describía el comportamiento de
//    antes de R8. Con el papel `ninguno`, el servidor no trata a nadie como
//    ejecutivo: no le entrega nada. La frase aparece dos veces en index.html
//    —en el aviso de la pantalla y en un comentario del código de enlace— y
//    las dos dejan de ser ciertas con este cambio.
// ---------------------------------------------------------------------------

const FRASE_FALSA = 'trata a todos como ejecutivos sin nombre';

describe('index.html · la frase que dejó de ser cierta', () => {
  it('la pantalla de permisos ya no afirma que el servidor trata a todos como ejecutivos sin nombre', () => {
    assert.ok(
      !FUENTE_PANTALLA.includes(FRASE_FALSA),
      'con el papel `ninguno` el servidor no entrega nada, no reparte todo como ejecutivo',
    );
  });

  it('y la frase no queda en ninguna otra parte de index.html', () => {
    const veces = INDEX.split(FRASE_FALSA).length - 1;
    assert.equal(
      veces,
      0,
      `la frase sigue ${veces} vez(ces) en index.html; también está en el comentario de \`marcarSincronizado\`, ` +
        `y también dejó de ser cierta ahí`,
    );
  });
});
