import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { enlaceCdh, enlaceCrm, normalizarBasePath } from '../../src/nucleo/enlaces.ts';

// ---- Copia textual del CRM (refs/crm/index.html) ----
const b64url = (t: string) => btoa(t).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const deB64url = (t: string) => atob(t.replace(/-/g, "+").replace(/_/g, "/")
  .padEnd(Math.ceil(t.length / 4) * 4, "="));
// ---- fin de la copia ----

const DATOS_CRM = {
  supabaseUrl: 'https://abcdefghijklmnop.supabase.co',
  anon: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.firma-de-prueba_x',
  tokenHash: '5f1c0a9e3b7d2c4a6e8f0b1d3c5e7a9b2d4f6a8c0e1b3d5f7a9c2e4b6d8f0a1c',
};

function esRutaRelativa(r: string) {
  assert.equal(typeof r, 'string');
  assert.ok(r.startsWith('/'), `debe empezar con /: ${r}`);
  assert.ok(!r.startsWith('//'), `no debe empezar con //: ${r}`);
  assert.ok(!/^https?:/i.test(r), `no debe ser absoluta: ${r}`);
}

describe('R5.3 · enlaceCrm', () => {
  it('es /#nube=…&cq=… en la raíz del mismo dominio', () => {
    const r = enlaceCrm(DATOS_CRM);
    esRutaRelativa(r);
    assert.ok(r.startsWith('/#nube='), r);
    assert.ok(r.includes(`&cq=${DATOS_CRM.tokenHash}`), r);
  });

  it('el deB64url del CRM decodifica nube a {u, k}', () => {
    const r = enlaceCrm(DATOS_CRM);
    // mismo patrón que leerInvitacion() del CRM
    const m = r.match(/[#&]nube=([A-Za-z0-9_-]+)/);
    assert.ok(m && m[1], r);
    assert.deepEqual(JSON.parse(deB64url(m[1])), { u: DATOS_CRM.supabaseUrl, k: DATOS_CRM.anon });
  });

  it('nube coincide con el b64url del CRM', () => {
    const r = enlaceCrm(DATOS_CRM);
    const esperado = b64url(JSON.stringify({ u: DATOS_CRM.supabaseUrl, k: DATOS_CRM.anon }));
    assert.equal(r, `/#nube=${esperado}&cq=${DATOS_CRM.tokenHash}`);
  });

  it('cq se lee de vuelta tal cual', () => {
    const r = enlaceCrm(DATOS_CRM);
    const m = r.match(/[#&]cq=([^&]+)/);
    assert.equal(m?.[1], DATOS_CRM.tokenHash);
  });
});

describe('R3 · enlaceCdh', () => {
  const X = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';

  it("con '/cdh' → /cdh/api/auth/sso?codigo=…", () => {
    assert.equal(enlaceCdh({ basePathCdh: '/cdh', codigo: X }), '/cdh/api/auth/sso?codigo=' + encodeURIComponent(X));
  });

  it('codifica el código para URL', () => {
    const raro = 'a+b/c=d&e';
    assert.equal(enlaceCdh({ basePathCdh: '/cdh', codigo: raro }), '/cdh/api/auth/sso?codigo=' + encodeURIComponent(raro));
  });

  it("con base '' → /api/auth/sso?codigo=…", () => {
    assert.equal(enlaceCdh({ basePathCdh: '', codigo: X }), '/api/auth/sso?codigo=' + encodeURIComponent(X));
  });

  it('siempre es ruta relativa al mismo dominio', () => {
    esRutaRelativa(enlaceCdh({ basePathCdh: '/cdh', codigo: X }));
    esRutaRelativa(enlaceCdh({ basePathCdh: '', codigo: X }));
    esRutaRelativa(enlaceCdh({ basePathCdh: '/portal/cdh', codigo: X }));
  });

  it('una base maliciosa nunca produce // ni http (o se rechaza)', () => {
    for (const base of ['//malo.example', 'https://malo.example', 'http:', '/\\malo.example']) {
      let r: string | undefined;
      try {
        r = enlaceCdh({ basePathCdh: base, codigo: X });
      } catch (e) {
        assert.notEqual((e as Error).message, 'no implementado');
        continue;
      }
      esRutaRelativa(r);
      assert.ok(!r.startsWith('/\\'), r);
    }
  });
});

describe('normalizarBasePath', () => {
  const casosOk: [string, string][] = [
    ['/cdh', '/cdh'],
    ['/cdh/', '/cdh'],
    ['/', ''],
    ['', ''],
    ['/portal/cdh', '/portal/cdh'],
  ];
  for (const [entrada, valor] of casosOk) {
    it(`'${entrada}' → '${valor}'`, () => {
      assert.deepEqual(normalizarBasePath(entrada), { ok: true, valor });
    });
  }

  // 'cdh' (sin barra inicial) se rechaza en vez de corregirse.
  const casosMalos = ['cdh', '/a/../b', '/..', '//x', '/cdh//', '/a b', ' /cdh', 'https://x/cdh', '/a\\b'];
  for (const entrada of casosMalos) {
    it(`'${entrada}' → formato`, () => {
      assert.deepEqual(normalizarBasePath(entrada), { ok: false, motivo: 'formato' });
    });
  }
});
