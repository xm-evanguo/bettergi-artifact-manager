import { parsePanel } from './ocr.js';

/** 背包网格：8 列 5 行，首格中心与间距沿用 OCRArtifacts 在 1920×1080 下的参数。 */
const COLS = 8, ROWS = 5, PAGE = COLS * ROWS;
const cell = (row, col) => ({ x: 180 + col * 145, y: 253 + row * 166 });
const PANEL = { x: 1306, y: 122, width: 496, height: 845 };
const HEADER = { x: 0, y: 0, width: 1920, height: 100 };

/**
 * 计算第 page 页要读取的格子。前几页按整页读取；
 * 最后一页滚到底后与底部对齐，按「最后一件在末行第 (total-1)%8 列」倒推剩余件的位置。
 */
export function pageCells(page, total) {
  const start = page * PAGE;
  const remaining = total - start;
  if (remaining >= PAGE || page === 0) {
    return Array.from({ length: Math.min(PAGE, remaining) }, (_, i) => ({ ordinal: start + i + 1, ...cell(Math.floor(i / COLS), i % COLS), row: Math.floor(i / COLS), col: i % COLS }));
  }
  const lastPos = (ROWS - 1) * COLS + (total - 1) % COLS;
  return Array.from({ length: remaining }, (_, i) => {
    const p = lastPos - (remaining - 1 - i);
    return { ordinal: start + i + 1, ...cell(Math.floor(p / COLS), p % COLS), row: Math.floor(p / COLS), col: p % COLS };
  });
}

/**
 * 可注入宿主接口的背包扫描器。只打开背包、选择格子和滚动，不更改物品。
 * 每件读取两次确认稳定；翻页后核对边界，任何不确定都停止并保存已读记录。
 * 全部件数读完且边界核对通过时标记 complete。
 */
export async function scanInventory(host, options = {}) {
  const snapshot = { schemaVersion: 1, scan: { id: `scan-${Date.now()}`, source: 'BetterGI OCR', startedAt: new Date().toISOString(), complete: false, verified: false, total: null, issues: [] }, artifacts: [] };
  const save = async () => { await host.checkpoint(snapshot); };
  /** 点击一格并读取两次面板，结果不一致时停止。 */
  const read = async c => {
    await host.click(c.x, c.y);
    await host.sleep(220);
    const text = await host.ocr(PANEL);
    await host.sleep(100);
    if (!text || text !== await host.ocr(PANEL)) throw new Error(`第 ${c.ordinal} 件面板读取不稳定，停止扫描。`);
    return text;
  };
  try {
    const size = await host.size();
    if (size.width !== 1920 || size.height !== 1080) throw new Error('扫描仅适配 1920×1080。');
    if (options.autoOpen) {
      // 打开方式与 OCRArtifacts 相同：回主界面，按 B 打开背包，再点圣遗物页签。
      await host.returnMainUi();
      await host.keyPress('B');
      await host.sleep(1000);
      await host.click(675, 50);
      await host.sleep(1500);
    }
    const header = await host.ocr(HEADER);
    const count = header.match(/(\d[\d,]*)\s*\/\s*(\d[\d,]*)/);
    if (!header.includes('圣遗物') || !count) throw new Error('未确认当前处于圣遗物背包，未执行点击。请取消筛选后重试。');
    const total = Number(count[1].replace(/,/g, ''));
    snapshot.scan.total = total;
    snapshot.scan.capacity = Number(count[2].replace(/,/g, ''));
    if (total > snapshot.scan.capacity || snapshot.scan.capacity > 10000) throw new Error('背包数量识别异常。');
    await save();
    const pages = Math.ceil(total / PAGE);
    const maxPages = options.maxPages ?? pages;
    if (!Number.isInteger(maxPages) || maxPages < 1) throw new Error('扫描页数须为正整数。');
    for (let page = 0; page < Math.min(pages, maxPages); page++) {
      const cells = pageCells(page, total);
      if (page > 0) {
        // 新页第一件的前一格应是上一页最后一件；对不上说明滚动位置有偏差。
        const first = cells[0];
        const p = first.row * COLS + first.col - 1;
        const readFirst = p >= 0 ? null : await read(first);
        if (p >= 0) {
          const text = await read({ ordinal: first.ordinal - 1, ...cell(Math.floor(p / COLS), p % COLS) });
          if (text !== snapshot.artifacts.at(-1).rawOcr) throw new Error(`第 ${page + 1} 页与上一页衔接不上，滚动位置可能有偏差，停止扫描。`);
        } else if (snapshot.artifacts.slice(-PAGE).some(a => a.rawOcr === readFirst)) {
          throw new Error(`第 ${page + 1} 页首件出现在上一页中，滚动不足或未翻页，停止扫描。`);
        }
      }
      for (const c of cells) {
        const text = await read(c);
        snapshot.artifacts.push(parsePanel(text, `${snapshot.scan.id}-${c.ordinal}`, { page: page + 1, row: c.row + 1, column: c.col + 1, ordinal: c.ordinal }));
        await save();
      }
      if (page + 1 < Math.min(pages, maxPages)) {
        // 翻页参数沿用 OCRArtifacts：滚 49 格，每 3 页回滚 1 格修正累计偏差。
        await host.move(cell(0, 0).x, cell(0, 0).y);
        for (let n = 0; n < 49; n++) { await host.scroll(-1); await host.sleep(40); }
        if ((page + 1) % 3 === 0) { await host.scroll(1); await host.sleep(40); }
        await host.sleep(500);
      }
    }
    if (snapshot.artifacts.length < total) snapshot.scan.issues.push(`仅采集 ${snapshot.artifacts.length}/${total} 件，页数受限。`);
    else snapshot.scan.complete = true;
  } catch (error) {
    snapshot.scan.issues.push(String(error.message || error));
    snapshot.scan.complete = false;
  } finally {
    snapshot.scan.finishedAt = new Date().toISOString();
    await save();
  }
  return snapshot;
}
