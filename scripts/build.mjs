import { build } from 'esbuild';
import { mkdir, readFile, rm, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Explicit public allowlist: tests, server code, .env and project documentation
// are never exposed by the Worker. The small frontend is embedded so the
// deployment does not depend on an additional static-assets binding.
const publicFiles = {
  'index.html': 'text/html; charset=utf-8',
  'app.js': 'text/javascript; charset=utf-8',
  'lib.mjs': 'text/javascript; charset=utf-8',
  'explorer.mjs': 'text/javascript; charset=utf-8',
  'network.mjs': 'text/javascript; charset=utf-8',
  'style.css': 'text/css; charset=utf-8',
  'vendor/leaflet/leaflet.js': 'text/javascript; charset=utf-8',
  'vendor/leaflet/leaflet.css': 'text/css; charset=utf-8',
  'vendor/leaflet/LICENSE': 'text/plain; charset=utf-8',
};
const assets = Object.fromEntries(await Promise.all(Object.entries(publicFiles).map(async ([file, type]) =>
  ['/' + file, { type, body: await readFile(resolve('frontend', file), 'utf8') }])));
const hosting = JSON.parse(await readFile('.openai/hosting.json', 'utf8'));
if (!hosting.project_id) throw new Error('The hosting manifest must identify the registered Site.');
await rm('dist', { recursive: true, force: true });
await mkdir('dist/.openai', { recursive: true });
await build({
  entryPoints: ['worker/index.mjs'], outfile: 'dist/server/index.js', bundle: true,
  format: 'esm', platform: 'browser', target: 'es2022', minify: false,
  plugins: [{ name: 'embedded-public-assets', setup(builder) {
    builder.onResolve({ filter: /^london:assets$/ }, () => ({ path: 'assets', namespace: 'london' }));
    builder.onLoad({ filter: /.*/, namespace: 'london' }, () => ({ contents: 'export default ' + JSON.stringify(assets), loader: 'js' }));
  } }],
});
await copyFile('.openai/hosting.json', 'dist/.openai/hosting.json');
console.log('Built London Transit Live Worker with ' + Object.keys(assets).length + ' public assets.');
