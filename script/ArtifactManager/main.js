import { analyze } from './lib/analyze.js';
import { renderReport } from './lib/report.js';
import { scanInventory } from './lib/scan.js';

/** 仅允许读取项目保存目录内的 JSON，避免设置中的相对路径逃逸。 */
function savedJsonPath(value, fallback) {
  const path = String(value || fallback).replace(/\\/g, '/');
  if (!/^saved_files\/[A-Za-z0-9_\-.]+\.json$/.test(path) || path.includes('..')) throw new Error('输入文件须位于 saved_files，文件名只能含英文字母、数字、点、横线和下划线。');
  return path;
}

/** 宿主方法只在该适配器内访问；决策层可在 Bun 中独立验证。 */
function makeHost(checkpointPath) {
  return {
    async size() { const region = captureGameRegion(); try { return { width: region.width, height: region.height }; } finally { region.dispose(); } },
    async ocr(rect) { const region = captureGameRegion(); try { const result = region.find(RecognitionObject.ocr(rect.x, rect.y, rect.width, rect.height)); return result ? String(result.text || '') : ''; } finally { region.dispose(); } },
    click: async (x, y) => { click(x, y); },
    move: async (x, y) => { moveMouseTo(x, y); },
    scroll: async n => { verticalScroll(n); },
    sleep: ms => sleep(ms),
    checkpoint: async snapshot => { if (!file.writeTextSync(checkpointPath, JSON.stringify(snapshot, null, 2))) throw new Error('保存扫描进度失败，停止读取。'); },
  };
}

/** BetterGI 标准脚本入口；默认运行虚构库存示例，不操作游戏。 */
await (async function main() {
  const opts = typeof settings === 'undefined' ? {} : settings;
  if (!file.createDirectory('saved_files')) throw new Error('无法建立 saved_files 目录。');
  const mode = String(opts.mode || '示例报告');
  let config, snapshot;
  if (mode === '示例报告') {
    config = JSON.parse(file.readTextSync('data/demo-config.json'));
    snapshot = JSON.parse(file.readTextSync('data/demo-snapshot.json'));
  } else {
    const configPath = savedJsonPath(opts.configPath, 'saved_files/config.json');
    config = JSON.parse(file.readTextSync(file.isFile(configPath) ? configPath : 'data/default-config.json'));
    if (config.demo === true) throw new Error('示例配置只能用于示例报告，请从 default-config.json 创建真实配置。');
    const names = value => String(value || '').split(/[,，、\n]/).map(s => s.trim()).filter(Boolean);
    const main = names(opts.mainCharacters), reserve = names(opts.reserveCharacters);
    if (main.length || reserve.length) config.characters = [...main.map(name => ({ name, priority: 'main' })), ...reserve.map(name => ({ name, priority: 'reserve' }))];
    if (String(opts.targetFreeSlots || '').trim()) config.targetFreeSlots = Number(opts.targetFreeSlots);
    config.demo = false;
    if (mode === '实验扫描') {
      const checkpoint = `saved_files/scan-${Date.now()}.json`;
      snapshot = await scanInventory(makeHost(checkpoint), { prepared: opts.prepared === true, maxPages: Number(opts.maxPages || 1) });
      log.info(`原始扫描已保存：${checkpoint}`);
    } else if (mode === '分析快照') {
      snapshot = JSON.parse(file.readTextSync(savedJsonPath(opts.snapshotPath, 'saved_files/inventory.json')));
    } else throw new Error('未知运行模式。');
  }
  const result = analyze(snapshot, config);
  const stamp = Date.now();
  const htmlPath = `saved_files/report-${stamp}.html`;
  const jsonPath = `saved_files/report-${stamp}.json`;
  if (!file.writeTextSync(jsonPath, JSON.stringify(result, null, 2)) || !file.writeTextSync(htmlPath, renderReport(result))) throw new Error('保存报告失败。');
  log.info(`报告已生成：${htmlPath}`);
  log.info(`保留 ${result.counts.keep}，优先试强化 ${result.counts.upgrade}，可清理 ${result.counts.cleanup}，待复查 ${result.counts.review}。`);
  if (result.blockers.length) log.warn(`清理建议已关闭：${result.blockers.join('；')}`);
  return { htmlPath, jsonPath };
})();
