import type { Db } from '../core/schema';

/** Adapta una base de datos de SQLite-WASM (API oo1) a la interfaz del núcleo. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function wrapDb(raw: any): Db {
  return {
    exec(sql, bind) {
      raw.exec(bind ? { sql, bind } : sql);
    },
    rows(sql, bind) {
      return raw.exec({ sql, ...(bind ? { bind } : {}), rowMode: 'object', returnValue: 'resultRows' });
    },
    prepare(sql) {
      const st = raw.prepare(sql);
      return {
        run(bind) {
          st.bind(bind);
          st.step();
          st.reset();
        },
        finalize() {
          st.finalize();
        },
      };
    },
  };
}
