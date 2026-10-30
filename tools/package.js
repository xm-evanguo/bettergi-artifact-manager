import { mkdir, cp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** 复制可导入的标准脚本目录；不把开发依赖与真实库存打包。 */
const target = resolve('dist/ArtifactManager');
// 先清空旧产物，避免源目录已删除的文件残留在包内。
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const name of ['main.js', 'manifest.json', 'settings.json', 'lib', 'data', 'vendor', 'README.md']) await cp(`script/ArtifactManager/${name}`, `${target}/${name}`, { recursive: true });
await mkdir(`${target}/saved_files`, { recursive: true });
await writeFile(`${target}/saved_files/.gitkeep`, '');
await cp('docs/upstream-lock.json', `${target}/upstream-lock.json`);
await cp('docs/THIRD_PARTY.md', `${target}/THIRD_PARTY.md`);
const manifest = JSON.parse(await readFile(`${target}/manifest.json`, 'utf8'));
console.log(`已生成 ${target}，版本 ${manifest.version}；当前仅供本地试用。`);
