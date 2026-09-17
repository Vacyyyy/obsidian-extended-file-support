import initSqlJs, { SqlJsStatic } from 'sql.js';
// The existing build embeds this WASM asset; nothing is fetched at runtime.
// @ts-ignore
import wasmBinary from '../../node_modules/sql.js/dist/sql-wasm.wasm';

let engine: Promise<SqlJsStatic> | undefined;
export function getSQLite(): Promise<SqlJsStatic> {
	if (!engine)
		engine = initSqlJs({ wasmBinary }).catch((error) => {
			engine = undefined;
			throw error;
		});
	return engine;
}
