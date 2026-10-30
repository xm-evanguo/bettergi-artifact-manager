import { readFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';

/** 检查所有模块能由浏览器目标打包，防止宿主项目混入 Bun 或 Node 依赖。 */
const root = 'script/ArtifactManager';
const manifest = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'));
for (const name of [manifest.main, manifest.settings_ui, 'data/default-config.json', 'data/demo-config.json', 'data/demo-snapshot.json']) await access(`${root}/${name}`);
const settings = JSON.parse(await readFile(`${root}/${manifest.settings_ui}`, 'utf8'));
if (new Set(settings.map(x => x.name)).size !== settings.length) throw new Error('设置名称重复。');
const result = await Bun.build({ entrypoints: [`${root}/${manifest.main}`], target: 'browser', write: false });
if (!result.success) throw new AggregateError(result.logs, '模块检查失败。');
async function inspect(dir) {
  for (const d of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, d.name);
    if (d.isDirectory()) { if (d.name !== 'saved_files') await inspect(path); continue; }
    if (!/\.(js|json)$/.test(path)) continue;
    const data = await readFile(path);
    if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) throw new Error(`${path} 含 BOM。`);
    if (path.endsWith('.json')) JSON.parse(data.toString('utf8'));
    if (path.endsWith('.js') && /\b(?:node:|Bun\.)/.test(data.toString('utf8'))) throw new Error(`${path} 含开发运行时依赖。`);
  }
}
await inspect(root);
console.log('模块、JSON、设置和编码检查通过。');
