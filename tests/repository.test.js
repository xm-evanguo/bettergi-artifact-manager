import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, readFile, writeFile, rm, access, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRepositoryIndex, readScriptFiles, scriptPath, verifyRepositoryIndex } from '../tools/build-repo.js';

/** 建立隔离的脚本仓库，避免测试触及真实库存或项目 Git 历史。 */
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'artifact-repository-'));
  try {
    const source = join(root, scriptPath);
    await mkdir(join(source, 'saved_files'), { recursive: true });
    await writeFile(join(source, 'saved_files/.gitkeep'), '');
    await writeFile(join(source, 'manifest.json'), JSON.stringify({ name: '测试脚本', version: '1.0.0', main: 'main.js', bgi_version: '0.66.0', authors: [{ name: '测试' }] }));
    await writeFile(join(source, 'main.js'), 'export default 1;\n');
    await run(root, source);
  } finally { await rm(root, { recursive: true, force: true }); }
}

/** 固定索引时间，便于验证快速连续修改也会触发 BetterGI 的更新时间比较。 */
async function saveIndex(root, time = '2026-10-30T00:00:00Z') {
  const index = await createRepositoryIndex(root, new Date(time));
  await writeFile(join(root, 'repo.json'), JSON.stringify(index));
  return index;
}

test('索引使用官方 JS 叶节点协议，未修改正文时构建保持稳定', async () => fixture(async root => {
  const initial = await saveIndex(root);
  const node = initial.indexes[0].children[0];
  expect(node.name).toBe('ArtifactManager');
  expect(node.version).toBe('1.0.0');
  expect(node.description).toBe('测试脚本~|~');
  expect(node.children).toBeUndefined();
  expect(initial.url).toEndWith('/archive/refs/heads/release.zip');
  expect(initial.time).toMatch(/^\d{14}$/);
  expect(await createRepositoryIndex(root, new Date('2026-11-01T00:00:00Z'))).toEqual(initial);
  await verifyRepositoryIndex(root);
}));

test('代码变动即使不改版本也使旧索引失效，更新后时间严格增加', async () => fixture(async (root, source) => {
  const old = await saveIndex(root);
  await writeFile(join(source, 'main.js'), 'export default 2;\n');
  await expect(verifyRepositoryIndex(root)).rejects.toThrow('repo.json 已过期');
  const next = await saveIndex(root);
  expect(next.indexes[0].children[0].lastUpdated).toBe('2026-10-30 00:00:01');
  expect(next.indexes[0].children[0].contentHash).not.toBe(old.indexes[0].children[0].contentHash);
  await verifyRepositoryIndex(root);
}));

test('真实保存文件不进入发布正文或索引指纹，文件删除会改变指纹', async () => fixture(async (root, source) => {
  const initial = await saveIndex(root);
  await writeFile(join(source, 'saved_files/inventory.json'), '{"private":true}');
  await writeFile(join(source, '.DS_Store'), 'metadata');
  expect((await readScriptFiles(root)).has('saved_files/inventory.json')).toBe(false);
  expect(await createRepositoryIndex(root)).toEqual(initial);
  await rm(join(source, 'main.js'));
  expect((await createRepositoryIndex(root)).indexes[0].children[0].contentHash).not.toBe(initial.indexes[0].children[0].contentHash);
}));

test.skipIf(process.platform === 'win32')('发布正文拒绝指向项目外的链接', async () => fixture(async (root, source) => {
  await symlink(join(root, 'repo.json'), join(source, 'external.json'));
  await expect(readScriptFiles(root)).rejects.toThrow('符号链接');
}));

test('真实 Git release 只检出索引后，仍可导入完整脚本并解析入口依赖', async () => fixture(async root => {
  // 使用当前真实源码构造发布提交，代码和依赖通过 Git 对象读取，不从工作树补文件。
  const source = join(root, scriptPath);
  await rm(source, { recursive: true });
  for (const [path, bytes] of await readScriptFiles()) {
    await mkdir(join(source, path, '..'), { recursive: true });
    await writeFile(join(source, path), bytes);
  }
  const index = await saveIndex(root);
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
  git('init', '-b', 'release');
  await writeFile(join(root, '.gitattributes'), await readFile(new URL('../.gitattributes', import.meta.url)));
  git('add', '.gitattributes', 'repo.json', 'repo');
  git('-c', 'user.name=Repository Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Test repository');
  const clone = join(root, 'clone');
  git('clone', '--no-checkout', '--single-branch', '--branch', 'release', root, clone);
  const readGit = (...args) => execFileSync('git', args, { cwd: clone, stdio: ['pipe', 'pipe', 'pipe'] });
  // BetterGI 初次拉取只将 repo.json 写入工作目录，脚本内容保留在提交中。
  await writeFile(join(clone, 'repo.json'), readGit('show', 'HEAD:repo.json'));
  expect(JSON.parse(await readFile(join(clone, 'repo.json'), 'utf8'))).toEqual(index);
  await expect(access(join(clone, 'repo'))).rejects.toThrow();
  const node = index.indexes[0].children[0];
  const destination = join(root, 'User/JsScript', node.name);
  await mkdir(destination, { recursive: true });
  const archive = readGit('archive', `HEAD:repo/js/${node.name}`);
  execFileSync('tar', ['-xf', '-', '-C', destination], { input: archive });
  const manifest = JSON.parse(await readFile(join(destination, 'manifest.json'), 'utf8'));
  expect(manifest.version).toBe(node.version);
  await access(join(destination, manifest.settings_ui));
  await access(join(destination, 'vendor/miao-plugin.LICENSE'));
  await access(join(destination, 'upstream-lock.json'));
  const result = await Bun.build({ entrypoints: [join(destination, manifest.main)], target: 'browser', write: false });
  expect(result.success).toBe(true);
  expect(manifest.saved_files).toContain('saved_files/*');
  expect(await readFile(join(destination, 'saved_files/.gitkeep'), 'utf8')).toBe('');
  // 按真实属性转换后导出完整提交，确保 CI 读取的 Git 正文仍与索引指纹一致。
  const checkout = join(root, 'checkout');
  await mkdir(checkout);
  execFileSync('tar', ['-xf', '-', '-C', checkout], { input: readGit('archive', 'HEAD') });
  await verifyRepositoryIndex(checkout);
}));
