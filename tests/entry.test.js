import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { analyze } from '../repo/js/ArtifactManager/lib/analyze.js';
import { renderReport } from '../repo/js/ArtifactManager/lib/report.js';
import { buildPlan } from '../repo/js/ArtifactManager/lib/plan.js';
import { parsePanel } from '../repo/js/ArtifactManager/lib/ocr.js';
import { renderPlanReport } from '../repo/js/ArtifactManager/lib/plan-report.js';
import { item, snapshot } from './helpers.js';

/** 在受控函数内执行真实入口，宿主文件由内存替代；扫描器由替身代替，无需启动 BetterGI。 */
function entry(settings = {}, { overrides = {}, scanned = snapshot([item('a')]) } = {}) {
  const root = new URL('../repo/js/ArtifactManager/', import.meta.url);
  const memory = new Map(['data/demo-config.json', 'data/demo-snapshot.json', 'data/builds.json'].map(p => [p, readFileSync(new URL(p, root), 'utf8')]));
  const file = { createDirectory: () => true, readTextSync: p => { if (!memory.has(p)) throw new Error(`文件不存在 ${p}`); return memory.get(p); }, isFile: p => memory.has(p), writeTextSync: (p, s) => { memory.set(p, s); return true; }, ...overrides };
  const scanInventory = async (host, options) => { calls.push(options); return scanned; };
  const calls = [];
  const code = readFileSync(new URL('main.js', root), 'utf8').replace(/^import .*;\n/gm, '').replace('await (async function main()', 'return (async function main()');
  const run = new Function('analyze', 'renderReport', 'scanInventory', 'parsePanel', 'buildPlan', 'renderPlanReport', 'settings', 'file', 'log', code);
  return { memory, calls, promise: () => run(analyze, renderReport, scanInventory, parsePanel, buildPlan, renderPlanReport, settings, file, { info() {}, warn() {} }) };
}

test('默认方式自动打开背包扫描，并生成计划与报告', async () => {
  const e = entry();
  const result = await e.promise();
  expect(e.calls[0].autoOpen).toBe(true);
  expect(e.calls[0].maxPages).toBeUndefined();
  expect(e.memory.get(result.htmlPath)).toContain('圣遗物整理计划');
  expect(JSON.parse(e.memory.get(result.jsonPath)).loadouts.length).toBeGreaterThan(0);
});
test('用上次扫描生成计划时没有扫描结果则报错', async () => {
  await expect(entry({ mode: '用上次扫描生成计划' }).promise()).rejects.toThrow('还没有扫描结果');
});
test('用上次扫描生成计划不再操作游戏', async () => {
  const e = entry({ mode: '用上次扫描生成计划' });
  e.memory.set('saved_files/inventory.json', JSON.stringify(snapshot([item('a')])));
  await e.promise();
  expect(e.calls).toHaveLength(0);
  expect(e.memory.has('saved_files/plan.html')).toBe(true);
});
test('继续上次扫描把上次结果交给扫描器', async () => {
  const e = entry({ mode: '继续上次扫描' });
  e.memory.set('saved_files/inventory.json', JSON.stringify(snapshot([item('a')], { complete: false })));
  await e.promise();
  expect(e.calls[0].resume.artifacts).toHaveLength(1);
});
test('示例报告不访问游戏', async () => {
  const e = entry({ mode: '示例报告' });
  const result = await e.promise();
  expect(e.calls).toHaveLength(0);
  expect(e.memory.get(result.htmlPath)).toContain('圣遗物整理报告');
});
test('文件写入失败使入口报错', async () => {
  await expect(entry({}, { overrides: { writeTextSync: () => false } }).promise()).rejects.toThrow('保存');
});
