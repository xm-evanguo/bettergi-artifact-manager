import { analyze } from './lib/analyze.js';
import { renderReport } from './lib/report.js';
import { scanInventory } from './lib/scan.js';
import { parsePanel } from './lib/ocr.js';
import { buildPlan } from './lib/plan.js';
import { renderPlanReport } from './lib/plan-report.js';

/** 宿主方法只在该适配器内访问；决策层可在 Bun 中独立验证。 */
function makeHost(checkpointPath) {
  return {
    async size() { const region = captureGameRegion(); try { return { width: region.width, height: region.height }; } finally { region.dispose(); } },
    async ocr(rect) { const region = captureGameRegion(); try { const result = region.find(RecognitionObject.ocr(rect.x, rect.y, rect.width, rect.height)); return result ? String(result.text || '') : ''; } finally { region.dispose(); } },
    click: async (x, y) => { click(x, y); },
    move: async (x, y) => { moveMouseTo(x, y); },
    scroll: async n => { verticalScroll(n); },
    keyPress: async key => { keyPress(key); },
    returnMainUi: () => genshin.returnMainUi(),
    sleep: ms => sleep(ms),
    checkpoint: async snapshot => { if (!file.writeTextSync(checkpointPath, JSON.stringify(snapshot, null, 2))) throw new Error('保存扫描进度失败，停止读取。'); },
  };
}

/** 写文件失败时报错，避免输出不存在的结果路径。 */
function write(path, text) {
  if (!file.writeTextSync(path, text)) throw new Error(`保存 ${path} 失败。`);
}

/** 由库存快照生成整理计划、报告和分解筛选脚本。 */
function plan(snapshot) {
  const result = buildPlan(snapshot, JSON.parse(file.readTextSync('data/builds.json')));
  write('saved_files/plan.json', JSON.stringify(result, null, 2));
  write('saved_files/plan.html', renderPlanReport(result));
  // BetterGI 只允许脚本写入 .txt、.json、.html 等扩展名，不能写 .js。
  write('saved_files/salvage-filter.txt', result.salvage.js);
  const c = result.counts;
  log.info(`计划已生成：saved_files/plan.html。保留 ${c.keep}，待强化 ${c.upgrade}，分解 ${c.discard}，待复查 ${c.review}，材料 ${c.fodder}。`);
  if (result.blockers.length) log.warn(`分解清单已关闭：${result.blockers.join('；')}`);
  return { htmlPath: 'saved_files/plan.html', jsonPath: 'saved_files/plan.json' };
}

/** BetterGI 标准脚本入口。默认自动打开背包扫描全部圣遗物并生成计划；只读取，不分解、不强化。 */
await (async function main() {
  const opts = typeof settings === 'undefined' ? {} : settings;
  if (!file.createDirectory('saved_files')) throw new Error('无法建立 saved_files 目录。');
  const mode = String(opts.mode || '扫描并生成计划');
  if (mode === '扫描并生成计划') {
    const pages = String(opts.maxPages || '').trim();
    const snapshot = await scanInventory(makeHost('saved_files/inventory.json'), { autoOpen: true, maxPages: pages ? Number(pages) : undefined });
    log.info(`扫描结束：${snapshot.artifacts.length}/${snapshot.scan.total ?? '?'} 件，已保存 saved_files/inventory.json。`);
    if (snapshot.scan.issues.length) log.warn(`扫描问题：${snapshot.scan.issues.join('；')}`);
    return plan(snapshot);
  }
  if (mode === '继续上次扫描') {
    if (!file.isFile('saved_files/inventory.json')) throw new Error('还没有扫描结果，请先选择「扫描并生成计划」。');
    const prior = JSON.parse(file.readTextSync('saved_files/inventory.json'));
    if (prior.scan?.complete) throw new Error('上次扫描已完整，无需续扫；请选择「用上次扫描生成计划」。');
    const pages = String(opts.maxPages || '').trim();
    const snapshot = await scanInventory(makeHost('saved_files/inventory.json'), { autoOpen: true, resume: prior, maxPages: pages ? Number(pages) : undefined });
    log.info(`续扫结束：${snapshot.artifacts.length}/${snapshot.scan.total ?? '?'} 件，已保存 saved_files/inventory.json。`);
    if (snapshot.scan.issues.length) log.warn(`扫描问题：${snapshot.scan.issues.join('；')}`);
    return plan(snapshot);
  }
  if (mode === '用上次扫描生成计划') {
    if (!file.isFile('saved_files/inventory.json')) throw new Error('还没有扫描结果，请先选择「扫描并生成计划」。');
    // 用当前解析规则重新解析原始文本，旧扫描也能得到后来的识别修正。
    const snapshot = JSON.parse(file.readTextSync('saved_files/inventory.json'));
    snapshot.artifacts = snapshot.artifacts.map(a => (a.rawOcr ? parsePanel(a.rawOcr, a.id, a.location) : a));
    return plan(snapshot);
  }
  if (mode === '示例报告') {
    const result = analyze(JSON.parse(file.readTextSync('data/demo-snapshot.json')), JSON.parse(file.readTextSync('data/demo-config.json')));
    const stamp = Date.now();
    const htmlPath = `saved_files/report-${stamp}.html`, jsonPath = `saved_files/report-${stamp}.json`;
    write(jsonPath, JSON.stringify(result, null, 2));
    write(htmlPath, renderReport(result));
    log.info(`示例报告已生成：${htmlPath}`);
    return { htmlPath, jsonPath };
  }
  throw new Error('未知运行模式。');
})();
