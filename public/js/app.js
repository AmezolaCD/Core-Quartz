/**
 * Arranque, sesión y enrutador por `#/` del portal.
 *
 * Las vistas no importan de aquí: reciben un `ctx` con lo que necesitan. Así
 * no hay ciclo entre `app.js` y `vistas/*.js`, que con módulos nativos y sin
 * empaquetador es una fuente de fallos difíciles de leer.
 */
import { api, ErrorApi, haciaModulo } from './api.js';
import { vistaEntrar } from './vistas/entrar.js';
import { vistaInicio } from './vistas/inicio.js';
import { vistaAdmin } from './vistas/admin.js';

const principal = document.getElementById('principal');
const barra = document.getElementById('barra');
const barraAcciones = document.getElementById('barra-acciones');

/** `{ usuario, modulos }` mientras haya sesión; `null` cuando no. */
let sesion = null;

/**
 * Crea un nodo. El texto va **siempre** por `textContent`, nunca por
 * `innerHTML`: los nombres y correos vienen de la base y no se confía en que
 * estén limpios.
 */
export function el(etiqueta, props = {}, hijos = []) {
  const nodo = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(props)) {
    if (valor === undefined || valor === null || valor === false) continue;
    if (clave === 'clase') nodo.className = valor;
    else if (clave === 'texto') nodo.textContent = valor;
    else if (clave.startsWith('on')) nodo.addEventListener(clave.slice(2), valor);
    else if (valor === true) nodo.setAttribute(clave, '');
    else nodo.setAttribute(clave, String(valor));
  }
  for (const hijo of [].concat(hijos)) if (hijo !== null && hijo !== undefined && hijo !== false) nodo.append(hijo);
  return nodo;
}

/** Deja en `<main>` exactamente lo que se le pase. */
function pintar(...nodos) {
  principal.replaceChildren(...nodos);
}

/** `?inicio=1`: esta vez no hay entrada directa (y no se recuerda nada). */
function pidenElInicio() {
  return new URLSearchParams(location.search).get('inicio') === '1';
}

/**
 * La regla de la fase 07: quien no es administradora y ve **un solo** módulo
 * va derecho a él.
 *
 * A la administradora nunca, tenga los módulos que tenga: si se la mandara al
 * módulo no tendría por dónde llegar a administración.
 */
function entraDirecto() {
  if (sesion === null || pidenElInicio()) return null;
  if (sesion.usuario.es_admin) return null;
  return sesion.modulos.length === 1 ? sesion.modulos[0] : null;
}

function pintarBarra() {
  if (sesion === null) {
    barra.hidden = true;
    barraAcciones.replaceChildren();
    return;
  }
  barra.hidden = false;
  barraAcciones.replaceChildren(
    el('span', { clase: 'chip', texto: sesion.usuario.nombre }),
    sesion.usuario.es_admin ? el('a', { href: '#/admin', texto: 'Administración' }) : null,
    el('button', { clase: 'secundario', type: 'button', texto: 'Salir', onclick: salir }),
  );
}

async function salir() {
  try {
    await api.salir();
  } catch {
    // Si la sesión ya no valía, el efecto buscado es el mismo.
  }
  sesion = null;
  // Se limpia `?inicio=1` para no arrastrarlo a la siguiente entrada.
  history.replaceState(null, '', location.pathname);
  pintarBarra();
  pintar(vistaEntrar(ctx));
}

/** Tras entrar: o se va derecho al módulo, o se pinta lo que toque. */
function despuesDeEntrar() {
  const directo = entraDirecto();
  if (directo) {
    location.replace(haciaModulo(directo.codigo));
    return;
  }
  pintarBarra();
  enrutar();
}

function enrutar() {
  if (sesion === null) {
    pintarBarra();
    pintar(vistaEntrar(ctx));
    return;
  }
  if (location.hash === '#/admin') {
    if (!sesion.usuario.es_admin) {
      location.hash = '#/';
      return;
    }
    pintar(vistaAdmin(ctx));
    return;
  }
  pintar(vistaInicio(ctx));
}

/** Lo que las vistas pueden usar. Nada más que esto. */
const ctx = {
  el,
  api,
  ErrorApi,
  haciaModulo,
  /** Sesión de ahora mismo (las vistas no la guardan). */
  sesion: () => sesion,
  /** La vista de entrar avisa por aquí cuando el acceso salió bien. */
  entro(datos) {
    sesion = datos;
    despuesDeEntrar();
  },
  ir(hash) {
    location.hash = hash;
  },
};

addEventListener('hashchange', enrutar);

async function arrancar() {
  try {
    sesion = await api.yo();
  } catch (error) {
    // 401 es «no hay sesión», que no es un fallo: es la pantalla de entrar.
    if (!(error instanceof ErrorApi) || (error.estado !== 401 && error.estado !== 403)) throw error;
    sesion = null;
  }

  if (sesion !== null) {
    const directo = entraDirecto();
    if (directo) {
      location.replace(haciaModulo(directo.codigo));
      return;
    }
  }
  pintarBarra();
  enrutar();
}

arrancar();
