import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { analyze } from '../repo/js/ArtifactManager/lib/analyze.js';
import { renderReport } from '../repo/js/ArtifactManager/lib/report.js';
import { scanInventory } from '../repo/js/ArtifactManager/lib/scan.js';

/** 在受控函数内执行真实入口，宿主文件由内存替代；无需启动 BetterGI。 */
function entry(settings = {}, overrides = {}) {
  const root = new URL('../repo/js/ArtifactManager/', import.meta.url);
  const memory = new Map(['data/demo-config.json', 'data/demo-snapshot.json', 'data/default-config.json'].map(p => [p, readFileSync(new URL(p, root), 'utf8')]));
  const file = { createDirectory: () => true, readTextSync: p => { if (!memory.has(p)) throw new Error(`文件不存在 ${p}`); return memory.get(p); }, isFile: p => memory.has(p), writeTextSync: (p, s) => { memory.set(p, s); return true; }, ...overrides };
  const code = readFileSync(new URL('main.js', root), 'utf8').replace(/^import .*;\n/gm, '').replace('await (async function main()', 'return (async function main()');
  const run = new Function('analyze', 'renderReport', 'scanInventory', 'settings', 'file', 'log', code);
  return { memory, promise: () => run(analyze, renderReport, scanInventory, settings, file, { info() {}, warn() {} }) };
}

test('真实默认入口生成 HTML 和 JSON，不访问游戏', async () => {
  const e = entry(); const result = await e.promise();
  expect(e.memory.get(result.htmlPath)).toContain('圣遗物整理报告');
  expect(JSON.parse(e.memory.get(result.jsonPath)).demo).toBe(true);
});
test('文件写入失败使入口报错，不输出成功结果', async () => {
  const e = entry({}, { writeTextSync: () => false });
  await expect(e.promise()).rejects.toThrow('保存报告失败');
});
test('快照路径不能越出保存目录', async () => {
  await expect(entry({ mode: '分析快照', snapshotPath: '../../secrets.json' }).promise()).rejects.toThrow('输入文件须位于');
});
test('未配置角色的真实快照模式生成复查报告，不误用演示角色', async () => {
  const e = entry({ mode: '分析快照' });
  e.memory.set('saved_files/inventory.json', e.memory.get('data/demo-snapshot.json'));
  const result = JSON.parse(e.memory.get((await e.promise()).jsonPath));
  expect(result.demo).toBe(false); expect(result.counts.cleanup).toBe(0); expect(result.blockers.join()).toContain('持有角色');
});
test('真实模式拒绝误用示例角色规则', async () => {
  const e = entry({ mode: '分析快照' });
  e.memory.set('saved_files/config.json', e.memory.get('data/demo-config.json'));
  await expect(e.promise()).rejects.toThrow('示例配置只能用于示例报告');
});
