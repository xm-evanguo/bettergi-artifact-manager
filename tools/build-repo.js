import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 本项目固定的公开仓库和脚本路径，与 BetterGI 的 js/ 相对路径协议对应。 */
export const repositoryUrl = 'https://github.com/xm-evanguo/bettergi-artifact-manager';
export const scriptPath = 'repo/js/ArtifactManager';
const projectRoot = fileURLToPath(new URL('../', import.meta.url));

/** 读取公开脚本正文；saved_files 只允许发布空占位文件，不读取真实账号数据。 */
export async function readScriptFiles(root = projectRoot) {
  const files = new Map();
  await visit(join(root, scriptPath), '');
  return files;

  /** 固定顺序读取普通文件；拒绝链接，避免误把目录外的数据纳入发布。 */
  async function visit(directory, relative) {
    if (!(await lstat(directory)).isDirectory()) throw new Error(`脚本目录不是普通目录：${relative}`);
    for (const name of (await readdir(directory)).sort()) {
      const path = relative ? `${relative}/${name}` : name;
      if (name === '.DS_Store' || (path.startsWith('saved_files/') && path !== 'saved_files/.gitkeep')) continue;
      const absolute = join(directory, name);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) throw new Error(`脚本不能包含符号链接：${path}`);
      if (info.isDirectory()) await visit(absolute, path);
      else if (info.isFile()) {
        const bytes = await readFile(absolute);
        if (path === 'saved_files/.gitkeep' && bytes.length !== 0) throw new Error('保存目录占位文件必须为空。');
        files.set(path, bytes);
      } else throw new Error(`脚本不能包含特殊文件：${path}`);
    }
  }
}

/** 生成与官方仓库相同的 JS 叶节点；全部正文参与指纹，代码变化也会更新索引时间。 */
export async function createRepositoryIndex(root = projectRoot, now = new Date()) {
  const files = await readScriptFiles(root);
  const manifest = JSON.parse(files.get('manifest.json')?.toString() || 'null');
  if (!manifest?.name || !manifest.version || !manifest.main) throw new Error('脚本清单缺少名称、版本或入口。');
  const digest = createHash('sha256');
  for (const [path, bytes] of files) digest.update(`${path}\0${bytes.length}\0`).update(bytes);
  const contentHash = digest.digest('hex');
  let old = null;
  try { old = JSON.parse(await readFile(join(root, 'repo.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const previous = old?.indexes?.find(node => node.name === 'js')?.children?.find(node => node.name === 'ArtifactManager');
  // 无正文变化时保留时间，避免每次构建制造更新；快速连续修改也至少递增一秒。
  const oldTime = Date.parse(`${previous?.lastUpdated?.replace(' ', 'T')}Z`);
  const timestamp = previous?.contentHash === contentHash && Number.isFinite(oldTime)
    ? oldTime : Math.max(now.getTime(), Number.isFinite(oldTime) ? oldTime + 1000 : 0);
  const lastUpdated = new Date(timestamp).toISOString().slice(0, 19).replace('T', ' ');
  const authors = manifest.authors || [];
  return {
    time: lastUpdated.replace(/[-: ]/g, ''),
    url: `${repositoryUrl}/archive/refs/heads/release.zip`,
    file: 'repo.json',
    indexes: [{
      name: 'js', type: 'directory', children: [{
        name: 'ArtifactManager', type: 'directory', version: manifest.version,
        description: `${manifest.name}~|~${manifest.description || ''}`,
        author: authors[0]?.name || '', authors,
        tags: manifest.bgi_version ? [`bgi≥${manifest.bgi_version}`] : [],
        lastUpdated, contentHash,
      }],
    }],
  };
}

/** 检查已提交索引是否与源码一致；CI 只检查，不修改或悄悄发布新正文。 */
export async function verifyRepositoryIndex(root = projectRoot) {
  const actual = JSON.parse(await readFile(join(root, 'repo.json'), 'utf8'));
  const expected = await createRepositoryIndex(root);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('repo.json 已过期，请运行 bun run build:repo 并提交索引。');
}

if (import.meta.main) {
  if (process.argv.includes('--check')) {
    await verifyRepositoryIndex();
    console.log('远程仓库索引与脚本正文一致。');
  } else {
    const index = await createRepositoryIndex();
    await writeFile(join(projectRoot, 'repo.json'), `${JSON.stringify(index, null, 2)}\n`);
    console.log('已生成 repo.json；需要把索引和 repo/ 正文一起提交。');
  }
}
