/** Punto de entrada del servidor: lee la configuración y escucha. */
import { crearApp } from './app.ts';
import { leerConfig } from './config.ts';
import { crearPool } from './db/pool.ts';
import { crearClienteSupabase } from './servicios/supabase-auth.ts';
import { crearClienteCdh } from './servicios/cdh-cliente.ts';

export async function arrancar(): Promise<void> {
  const config = leerConfig();
  const pool = crearPool(config.databaseUrl);

  const app = crearApp({
    pool,
    config,
    supabase: crearClienteSupabase({
      url: config.supabaseUrl,
      anon: config.supabaseAnon,
      serviceRole: config.supabaseServiceRole,
    }),
    cdh: crearClienteCdh({ interno: config.cdhInterno, secreto: config.ssoSecreto }),
  });

  await new Promise<void>((listo) => {
    app.listen(config.puerto, () => {
      console.log(`Core Quartz escuchando en :${config.puerto}${config.basePath}`);
      listo();
    });
  });
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await arrancar();
}

export { crearApp };
