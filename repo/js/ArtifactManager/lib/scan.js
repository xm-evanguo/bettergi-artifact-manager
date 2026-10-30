import { parsePanel } from './ocr.js';

/** 背包网格：8 列 5 行，首格中心与间距沿用 OCRArtifacts 在 1920×1080 下的参数。 */
const COLS = 8, PAGE = COLS * 5;
const cell = (row, col) => ({ x: 180 + col * 145, y: 253 + row * 166 });
const PANEL = { x: 1306, y: 122, width: 496, height: 845 };
const HEADER = { x: 0, y: 0, width: 1920, height: 100 };

/** 每次翻页的滚轮格数：约前进 4 行，让新视图首行与上一视图末行重叠，用于核对连续性。 */
const SCROLL_CLICKS = 39;

/** 对不上时最多回滚的滚轮格数（约 1.5 行）。 */
const MAX_NUDGE = 15;

/**
 * 用于比对同一件圣遗物的指纹：只取套装名之前的行（名称、部位、主词条、等级、副词条）。
 * 之后的套装效果长文本 OCR 杂字较多，两次运行间可能不同；行首符号和全零杂行也去掉。
 */
export function fingerprint(text) {
  const lines = String(text || '').split('\n').map(l => l.trim().replace(/^[^\u4e00-\u9fa5\d+]+/, '')).filter(l => l && !/^0+$/.test(l));
  const setLine = lines.findIndex(l => /[:：]$/.test(l));
  return (setLine > 0 ? lines.slice(0, setLine) : lines).join('\n');
}

/** 圣遗物背包末尾的祝圣精华、祝圣油膏等强化材料。 */
const isMaterial = text => /圣遗物(强化|经验)素材/.test(text);

/** 视图内第 p 个格子（行优先）。 */
const at = p => ({ ...cell(Math.floor(p / COLS), p % COLS), row: Math.floor(p / COLS), col: p % COLS });

/**
 * 可注入宿主接口的背包扫描器。只打开背包、选择格子和滚动，不更改物品。
 * 每件读取两次确认稳定；每次翻页约前进 4 行，新视图首行必须与已读记录整行重叠，
 * 由重叠位置确定新视图的起点，因此滚动多少都不会漏件或重复；没有重叠时停止。
 * 读到强化材料或空格（点击后面板不变）即为网格末尾；末尾前的件数少于页头总数时，多半开着筛选，不标记 complete。
 * 全部件数读完且每次翻页都核对通过时标记 complete。
 */
export async function scanInventory(host, options = {}) {
  const snapshot = { schemaVersion: 1, scan: { id: `scan-${Date.now()}`, source: 'BetterGI OCR', startedAt: new Date().toISOString(), complete: false, verified: false, total: null, issues: [] }, artifacts: [] };
  const save = async () => { await host.checkpoint(snapshot); };
  let lastRead = null;
  /** 点击一格并读取两次面板，结果不一致时停止。 */
  const read = async c => {
    await host.click(c.x, c.y);
    await host.sleep(220);
    const text = await host.ocr(PANEL);
    await host.sleep(100);
    if (!text || text !== await host.ocr(PANEL)) throw new Error(`第 ${c.ordinal} 件面板读取不稳定，停止扫描。`);
    lastRead = text;
    return text;
  };
  const prior = options.resume;
  try {
    if (prior) {
      // 续扫：先装入上次记录，此后任何失败保存的检查点都保留原有进度，可以再次续扫。
      if (!prior.artifacts?.length || prior.artifacts.some(a => !a.rawOcr)) throw new Error('上次扫描结果缺少原始记录，无法续扫。');
      // 用当前解析规则重新解析原始文本，旧记录也能得到后来的识别修正。
      // 旧版把末尾的强化材料也当成圣遗物记下，这里去掉。
      snapshot.artifacts.push(...prior.artifacts.filter(a => !isMaterial(a.rawOcr)).map(a => parsePanel(a.rawOcr, a.id, a.location)));
      snapshot.scan.total = prior.scan?.total ?? null;
      snapshot.scan.resumedFrom = prior.scan?.id;
    }
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
    // 续扫时先核对数量，再覆盖快照中的总数，失败后保存的检查点仍是上次的数量。
    if (prior && prior.scan?.total !== total) throw new Error(`背包数量 ${total} 与上次扫描的 ${prior.scan?.total} 不同，库存已变化，请重新完整扫描。`);
    snapshot.scan.total = total;
    snapshot.scan.capacity = Number(count[2].replace(/,/g, ''));
    if (total > snapshot.scan.capacity || snapshot.scan.capacity > 10000) throw new Error('背包数量识别异常。');
    await save();
    const maxPages = options.maxPages ?? Infinity;
    if (maxPages !== Infinity && (!Number.isInteger(maxPages) || maxPages < 1)) throw new Error('扫描页数须为正整数。');
    const records = snapshot.artifacts;
    let gridEnd = false;
    const prints = new WeakMap();
    /** 记录的指纹，算过一次后缓存。 */
    const fp = r => { if (!prints.has(r)) prints.set(r, fingerprint(r.rawOcr)); return prints.get(r); };
    /** 读取视图中第 p 格，作为第 ordinal 件记录。 */
    const take = async (p, ordinal, page) => {
      const c = at(p), before = lastRead;
      let text = await read({ ordinal, ...c });
      // 面板没变：可能点到了空格，也可能点击没生效，等一下再点一次确认。
      if (text === before) { await host.sleep(500); text = await read({ ordinal, ...c }); }
      if (text === before || isMaterial(text)) { gridEnd = true; return; }
      records.push(parsePanel(text, `${snapshot.scan.id}-${ordinal}`, { page, row: c.row + 1, column: c.col + 1, ordinal }));
      await save();
    };
    /**
     * 用重叠部分定位：读视图首行的若干格，必须与已读记录中恰好一行吻合，才能证明中间没有漏件。
     * 每页滚动的格数与 4 行略有出入，误差会逐页累积；对不上时先回滚一格再试，最多回滚约 1.5 行。
     */
    const align = async (page, cols, from) => {
      for (let nudge = 0; nudge <= MAX_NUDGE; nudge++) {
        if (nudge) { await host.scroll(1); await host.sleep(300); }
        const top = new Map();
        for (const col of cols) top.set(col, await read({ ordinal: `第 ${page} 页首行`, ...at(col) }));
        const starts = [], want = [...top].map(([col, t]) => [col, fingerprint(t)]);
        for (let i = from; i < records.length; i += COLS) {
          if (want.every(([col, f]) => i + col >= records.length || fp(records[i + col]) === f)) starts.push(i);
        }
        if (starts.length > 1) throw new Error(`第 ${page} 页首行与多处已读记录相同，无法确定位置，停止扫描。`);
        if (starts.length === 1) return { viewStart: starts[0], top };
      }
      throw new Error(`第 ${page} 页与上一页没有重叠，回滚 ${MAX_NUDGE} 格后仍对不上，可能滚动过多漏件，停止扫描。`);
    };
    const scrollPage = async () => {
      await host.move(cell(0, 0).x, cell(0, 0).y);
      for (let n = 0; n < SCROLL_CLICKS; n++) { await host.scroll(-1); await host.sleep(40); }
      await host.sleep(500);
    };
    /** 读出当前视图中尚未记录的格子；首行已读出的直接复用。 */
    const readView = async (page, viewStart, top) => {
      const end = Math.min(PAGE, total - viewStart);
      for (let p = records.length - viewStart; p < end && !gridEnd; p++) {
        if (top.has(p) && isMaterial(top.get(p))) gridEnd = true;
        else if (top.has(p)) {
          const c = at(p), ordinal = viewStart + p + 1;
          records.push(parsePanel(top.get(p), `${snapshot.scan.id}-${ordinal}`, { page, row: c.row + 1, column: c.col + 1, ordinal }));
          await save();
        } else await take(p, viewStart + p + 1, page);
      }
    };
    const unread = viewStart => viewStart + Math.min(PAGE, total - viewStart) > records.length;
    let page = 1;
    if (prior) {
      // 快进：先核对当前视图，已全部记录才翻页；每页核对首行全部 8 格，直到出现未读格子再从该页继续读取。
      while (records.length < total && !gridEnd) {
        const { viewStart, top } = await align(page, Array.from({ length: COLS }, (_, i) => i), 0);
        if (unread(viewStart)) { await readView(page, viewStart, top); break; }
        page++;
        await scrollPage();
      }
    } else {
      for (let p = 0; p < Math.min(PAGE, total) && !gridEnd; p++) await take(p, p + 1, 1);
    }
    for (let pass = 1; records.length < total && !gridEnd && pass < maxPages; pass++) {
      page++;
      await scrollPage();
      const { viewStart, top } = await align(page, Array.from({ length: COLS }, (_, i) => i), Math.max(0, Math.floor((records.length - PAGE) / COLS) * COLS));
      if (!unread(viewStart)) throw new Error(`第 ${page} 页没有新物品，滚动未前进，停止扫描。`);
      await readView(page, viewStart, top);
    }
    if (gridEnd && records.length < total) snapshot.scan.issues.push(`背包读到第 ${records.length} 件就到了末尾，但页头为 ${total} 件，可能开着筛选（如「未满级」）。请取消全部筛选后重新完整扫描。`);
    else if (records.length < total) snapshot.scan.issues.push(`仅采集 ${snapshot.artifacts.length}/${total} 件，页数受限。`);
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
