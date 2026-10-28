// Copies the static assets CesiumJS loads at runtime (web workers, textures,
// widget styles, third-party wasm) into public/cesium. The library code itself
// is bundled by Vite from the `cesium` package.
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const pkgDir = path.dirname(require.resolve('cesium/package.json'));
const { version } = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
const dest = path.resolve('public/cesium');
const stamp = path.join(dest, '.version');

if (existsSync(stamp) && readFileSync(stamp, 'utf8') === version) process.exit(0);

rmSync(dest, { recursive: true, force: true });
for (const dir of ['Workers', 'Assets', 'ThirdParty', 'Widgets']) {
  cpSync(path.join(pkgDir, 'Build/Cesium', dir), path.join(dest, dir), { recursive: true });
}
writeFileSync(stamp, version);
console.log(`Copied CesiumJS ${version} runtime assets to public/cesium`);
