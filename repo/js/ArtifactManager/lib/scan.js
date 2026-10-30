import { parsePanel } from './ocr.js';

/** 可注入宿主接口的实验扫描器。只读取、选择背包格子和滚动，不更改物品。 */
export async function scanInventory(host, options = {}) {
  const snapshot = { schemaVersion: 1, scan: { id: `scan-${Date.now()}`, source: 'BetterGI experimental OCR', startedAt: new Date().toISOString(), complete: false, verified: false, total: null, issues: ['固定网格翻页未实机验收；即使数量一致，也不视为完整扫描。'] }, artifacts: [] };
  const save = async () => { await host.checkpoint(snapshot); };
  try {
    if (options.prepared !== true) throw new Error('先手动打开圣遗物背包、取消筛选并滚动至顶部，再勾选已准备。');
    const maxPages = options.maxPages ?? 1;
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) throw new Error('扫描页数须为 1 至 100。');
    const size = await host.size();
    if (size.width !== 1920 || size.height !== 1080) throw new Error('实验扫描仅适配 1920×1080。');
    const header = await host.ocr({ x: 0, y: 0, width: 1920, height: 100 });
    const count = header.match(/(\d[\d,]*)\s*\/\s*(\d[\d,]*)/);
    if (!header.includes('圣遗物') || !count) throw new Error('未确认当前处于圣遗物背包，未执行点击。');
    snapshot.scan.total = Number(count[1].replace(/,/g, ''));
    snapshot.scan.capacity = Number(count[2].replace(/,/g, ''));
    if (snapshot.scan.total > snapshot.scan.capacity || snapshot.scan.capacity > 10000) throw new Error('背包数量识别异常。');
    await save();
    const pages = Math.min(maxPages, Math.ceil(snapshot.scan.total / 40));
    let previousFirst = null;
    for (let page = 0; page < pages; page++) {
      // 末页的滚动停靠和行偏移尚未验证，保留原始观测，禁止据此宣称全量完成。
      const countOnPage = Math.min(40, snapshot.scan.total - snapshot.artifacts.length);
      for (let index = 0; index < countOnPage; index++) {
        const row = Math.floor(index / 8), column = index % 8;
        const location = { page: page + 1, row: row + 1, column: column + 1, ordinal: snapshot.artifacts.length + 1 };
        await host.click(180 + column * 145, 253 + row * 166);
        await host.sleep(220);
        let text = await host.ocr({ x: 1306, y: 122, width: 496, height: 845 });
        await host.sleep(100);
        const confirmation = await host.ocr({ x: 1306, y: 122, width: 496, height: 845 });
        if (!text || text !== confirmation) {
          snapshot.scan.issues.push(`第 ${location.ordinal} 件面板不稳定，停止扫描。`);
          throw new Error('面板读取不稳定，已保存部分记录。');
        }
        if (index === 0) {
          if (previousFirst === text) throw new Error('翻页后的首件与前页相同，无法区分未滚动和重复物品，停止。');
          previousFirst = text;
        }
        snapshot.artifacts.push(parsePanel(text, `${snapshot.scan.id}-${location.ordinal}`, location));
        await save();
      }
      if (page + 1 < pages) {
        await host.move(180, 253);
        for (let n = 0; n < 49; n++) { await host.scroll(-1); await host.sleep(40); }
        if ((page + 1) % 3 === 0) { await host.scroll(1); await host.sleep(40); }
        await host.sleep(500);
      }
    }
    if (snapshot.artifacts.length < snapshot.scan.total) snapshot.scan.issues.push(`仅采集 ${snapshot.artifacts.length}/${snapshot.scan.total} 件，页数受限。`);
  } catch (error) {
    snapshot.scan.issues.push(String(error.message || error));
  } finally {
    snapshot.scan.finishedAt = new Date().toISOString();
    await save();
  }
  return snapshot;
}
