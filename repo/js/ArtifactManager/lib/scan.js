import { parsePanel } from './ocr.js';

/** 背包网格：8 列 5 行，首格中心与间距沿用 OCRArtifacts 在 1920×1080 下的参数。 */
const COLS = 8, PAGE = COLS * 5;
const cell = (row, col) => ({ x: 180 + col * 145, y: 253 + row * 166 });
const PANEL = { x: 1306, y: 122, width: 496, height: 845 };
const HEADER = { x: 0, y: 0, width: 1920, height: 100 };

/** 每次翻页的滚轮格数：约前进 4 行，让新视图首行与上一视图末行重叠，用于核对连续性。 */
const SCROLL_CLICKS = 39;

/** 视图内第 p 个格子（行优先）。 */
const at = p => ({ ...cell(Math.floor(p / COLS), p % COLS), row: Math.floor(p / COLS), col: p % COLS });

/**
 * 可注入宿主接口的背包扫描器。只打开背包、选择格子和滚动，不更改物品。
 * 每件读取两次确认稳定；每次翻页约前进 4 行，新视图首行必须与已读记录整行重叠，
 * 由重叠位置确定新视图的起点，因此滚动多少都不会漏件或重复；没有重叠时停止。
 * 全部件数读完且每次翻页都核对通过时标记 complete。
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
    const maxPages = options.maxPages ?? Infinity;
    if (maxPages !== Infinity && (!Number.isInteger(maxPages) || maxPages < 1)) throw new Error('扫描页数须为正整数。');
    const records = snapshot.artifacts;
    /** 读取视图中第 p 格，作为第 ordinal 件记录。 */
    const take = async (p, ordinal, page) => {
      const c = at(p);
      const text = await read({ ordinal, ...c });
      records.push(parsePanel(text, `${snapshot.scan.id}-${ordinal}`, { page, row: c.row + 1, column: c.col + 1, ordinal }));
      await save();
    };
    for (let p = 0; p < Math.min(PAGE, total); p++) await take(p, p + 1, 1);
    for (let page = 2; records.length < total && page <= maxPages; page++) {
      await host.move(cell(0, 0).x, cell(0, 0).y);
      for (let n = 0; n < SCROLL_CLICKS; n++) { await host.scroll(-1); await host.sleep(40); }
      await host.sleep(500);
      // 用重叠部分定位：新视图首行必须整行等于已读的某一行，才能证明中间没有漏件。
      const top = [];
      for (let col = 0; col < COLS; col++) top.push(await read({ ordinal: `第 ${page} 页首行`, ...at(col) }));
      const starts = [];
      for (let i = Math.max(0, Math.floor((records.length - PAGE) / COLS) * COLS); i < records.length; i += COLS) {
        if (top.every((t, col) => i + col >= records.length || records[i + col].rawOcr === t)) starts.push(i);
      }
      if (starts.length !== 1) throw new Error(starts.length ? `第 ${page} 页首行与多处已读记录相同，无法确定位置，停止扫描。` : `第 ${page} 页与上一页没有重叠，可能滚动过多漏件，停止扫描。`);
      const viewStart = starts[0];
      const end = Math.min(PAGE, total - viewStart);
      if (viewStart + end <= records.length) throw new Error(`第 ${page} 页没有新物品，滚动未前进，停止扫描。`);
      // 首行中已读出、但尚未记录的新件直接复用读取结果，其余格子逐件读取。
      for (let p = records.length - viewStart; p < end; p++) {
        if (p < COLS) {
          const c = at(p), ordinal = viewStart + p + 1;
          records.push(parsePanel(top[p], `${snapshot.scan.id}-${ordinal}`, { page, row: c.row + 1, column: c.col + 1, ordinal }));
          await save();
        } else await take(p, viewStart + p + 1, page);
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
