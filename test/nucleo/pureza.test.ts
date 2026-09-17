import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(import.meta.dirname, '../../src/nucleo');
const archivos = readdirSync(DIR).filter((f) => f.endsWith('.ts'));
const leer = (f: string) => readFileSync(join(DIR, f), 'utf8');

/** Especificadores de import/export/import()/require() del texto. */
function especificadores(texto: string): string[] {
  const res: string[] = [];
  const patrones = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const p of patrones) for (const m of texto.matchAll(p)) if (m[1]) res.push(m[1]);
  return res;
}

const PROHIBIDOS = /^(node:)?(fs|fs\/promises|net|http|https|http2|dgram|child_process|dns|tls)(\/.*)?$|^pg(\/.*)?$/;

describe('pureza de src/nucleo', () => {
  it('existen los archivos del núcleo', () => {
    for (const f of ['tipos.ts', 'accesos.ts', 'boletos.ts', 'identidades.ts', 'enlaces.ts', 'cripto.ts']) {
      assert.ok(archivos.includes(f), f);
    }
  });

  for (const f of archivos) {
    describe(f, () => {
      const texto = leer(f);

      it('no importa fs, red ni pg', () => {
        for (const e of especificadores(texto)) assert.doesNotMatch(e, PROHIBIDOS, `${f} importa ${e}`);
      });

      it('no lee el reloj ni usa Math.random', () => {
        assert.doesNotMatch(texto, /Date\.now\s*\(/, f);
        assert.doesNotMatch(texto, /Math\.random\s*\(/, f);
        assert.doesNotMatch(texto, /new\s+Date\s*\(\s*\)/, f);
        assert.doesNotMatch(texto, /performance\.now\s*\(/, f);
      });

      it('node:crypto sólo en cripto.ts', () => {
        const usaCrypto = especificadores(texto).some((e) => /^(node:)?crypto$/.test(e)) || /\bglobalThis\.crypto\b|\bcrypto\.(getRandomValues|randomUUID|subtle)\b/.test(texto);
        if (f !== 'cripto.ts') assert.equal(usaCrypto, false, `${f} usa crypto`);
      });

      it('imports relativos con extensión .ts', () => {
        for (const e of especificadores(texto)) {
          if (e.startsWith('.')) assert.match(e, /\.ts$/, `${f}: ${e}`);
        }
      });
    });
  }
});
