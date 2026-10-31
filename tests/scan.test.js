import { test, expect, describe } from 'bun:test';
import { scanInventory, fingerprint } from '../repo/js/ArtifactManager/lib/scan.js';
import { parsePanel, rarityFromMain } from '../repo/js/ArtifactManager/lib/ocr.js';

/** 第 n 件的虚构面板；数值不同以便区分每一件。 */
const panel = (n, extra = '') => `虚构之花\n生之花\n生命值\n4,780\n+20\n暴击率+${(3.1 + n / 10).toFixed(1)}%\n暴击伤害+7.8%\n攻击力+5.8%\n元素充能效率+6.5%\n绝缘之旗印:\n2件套:元素充能效率提高20%${extra}`;

/**
 * 模拟背包：8 列网格，每页 5 行。滚动位置按滚轮格数记录，每 clicksPerRow 格前进一行（默认 39 格正好 4 行），
 * 可以是小数以模拟误差累积；点击格子中心命中当时显示在该位置的那一行。滚到底时与底部对齐。
 * 只记录点击、滚动与检查点，不发送任何系统输入。
 */
function fakeBag({ count = 2, shown = count, materials = 0, header, unstable = false, failAt = Infinity, scrollRows = 4, clicksPerRow = 39 / scrollRows } = {}) {
  // shown：筛选后实际显示的件数；materials：末尾的强化材料格数。
  const items = Array.from({ length: shown }, (_, i) => panel(i));
  const cells = () => [...items, ...Array.from({ length: materials }, () => '祝圣油膏\n圣遗物强化素材\n圣遗物经验素材，含有2500点经验值。')];
  const maxPos = Math.max(0, Math.ceil((shown + materials) / 8) - 5) * clicksPerRow;
  const state = { clicks: 0, scrolls: 0, ups: 0, saves: [], pos: 0, selected: null, reads: 0, opened: false };
  const host = {
    size: async () => ({ width: 1920, height: 1080 }),
    returnMainUi: async () => {}, keyPress: async () => { state.opened = true; },
    ocr: async rect => {
      if (rect.height === 100) return header ?? `圣遗物 ${count}/2100`;
      if (unstable && state.reads++ % 2) return '不同结果';
      return state.selected === null ? '' : cells()[state.selected] ?? '';
    },
    click: async (x, y) => {
      state.clicks++;
      if (state.clicks === failAt) throw new Error('用户中断');
      if (x === 675 && y === 50) return;
      const col = Math.round((x - 180) / 145), row = Math.round((y - 253) / 166);
      const top = Number.isFinite(clicksPerRow) ? state.pos / clicksPerRow : 0;
      const index = Math.floor(top + row + 0.5) * 8 + col;
      // 点到空格时选中项不变，面板仍显示上一件。
      if (index < shown + materials) state.selected = index;
    },
    move: async () => {},
    scroll: async n => {
      state.scrolls++;
      if (n > 0) state.ups++;
      state.pos = Math.min(maxPos, Math.max(0, state.pos - n));
    },
    sleep: async () => {},
    checkpoint: async s => { state.saves.push(structuredClone(s)); },
  };
  return { host, state, items };
}

describe('背包扫描', () => {
  test('自动打开背包并完整扫描一页', async () => {
    const { host, state } = fakeBag({ count: 2 });
    const r = await scanInventory(host, { autoOpen: true });
    expect(state.opened).toBe(true);
    expect(r.artifacts).toHaveLength(2);
    expect(r.scan.complete).toBe(true);
  });
  test('错误页面或分辨率在点击格子前退出', async () => {
    const a = fakeBag({ header: '武器 2/2000' }); const ra = await scanInventory(a.host); expect(a.state.clicks).toBe(0); expect(ra.scan.complete).toBe(false);
    const b = fakeBag(); b.host.size = async () => ({ width: 1280, height: 720 }); await scanInventory(b.host); expect(b.state.clicks).toBe(0);
  });
  test('多页扫描：末页底部对齐，按顺序读到每一件', async () => {
    const { host, items } = fakeBag({ count: 93 });
    const r = await scanInventory(host);
    expect(r.scan.issues).toEqual([]);
    expect(r.scan.complete).toBe(true);
    expect(r.artifacts.map(a => a.rawOcr)).toEqual(items);
  });
  test('整页倍数的库存同样完整', async () => {
    const { host, items } = fakeBag({ count: 80 });
    const r = await scanInventory(host);
    expect(r.scan.complete).toBe(true);
    expect(r.artifacts.map(a => a.rawOcr)).toEqual(items);
  });
  test('每页多滚约 0.06 行的累积误差靠回滚自动纠正', async () => {
    const { host, items, state } = fakeBag({ count: 900, clicksPerRow: 9.6 });
    const r = await scanInventory(host);
    expect(r.scan.issues).toEqual([]);
    expect(r.scan.complete).toBe(true);
    expect(r.artifacts.map(a => a.rawOcr)).toEqual(items);
    expect(state.ups).toBeGreaterThan(0);
  });
  test('每页多滚一整行时回滚后续读', async () => {
    const { host, items } = fakeBag({ count: 300, scrollRows: 5 });
    const r = await scanInventory(host);
    expect(r.scan.complete).toBe(true);
    expect(r.artifacts.map(a => a.rawOcr)).toEqual(items);
  });
  test('滚动过多、回滚后仍无重叠时停止，不宣称完整', async () => {
    const { host } = fakeBag({ count: 120, scrollRows: 8 });
    const r = await scanInventory(host);
    expect(r.scan.complete).toBe(false);
    expect(r.artifacts).toHaveLength(40);
    expect(r.scan.issues.join()).toContain('没有重叠');
  });
  test('滚动不足时按重叠位置续读，不重复也不漏件', async () => {
    const { host, items } = fakeBag({ count: 120, scrollRows: 2 });
    const r = await scanInventory(host);
    expect(r.scan.complete).toBe(true);
    expect(r.artifacts.map(a => a.rawOcr)).toEqual(items);
  });
  test('滚动未前进时停止', async () => {
    const { host } = fakeBag({ count: 120, scrollRows: 0 });
    const r = await scanInventory(host);
    expect(r.scan.complete).toBe(false);
    expect(r.scan.issues.join()).toContain('未前进');
  });
  test('续扫：快速翻到上次停下的位置，读完剩余件', async () => {
    const first = fakeBag({ count: 500, clicksPerRow: 9.6 });
    const partial = await scanInventory(first.host, { maxPages: 6 });
    expect(partial.artifacts.length).toBeLessThan(500);
    const second = fakeBag({ count: 500, clicksPerRow: 9.6 });
    const r = await scanInventory(second.host, { resume: partial });
    expect(r.scan.complete).toBe(true);
    expect(r.artifacts.map(a => a.rawOcr)).toEqual(second.items);
    // 快进时每页只点首行 8 格，总点击远少于从头完整扫描。
    const full = fakeBag({ count: 500, clicksPerRow: 9.6 });
    await scanInventory(full.host);
    expect(second.state.clicks).toBeLessThan(full.state.clicks - partial.artifacts.length / 2);
  });
  test('续扫时背包数量变化则拒绝，检查点保留上次进度', async () => {
    const first = fakeBag({ count: 100 });
    const partial = await scanInventory(first.host, { maxPages: 1 });
    const second = fakeBag({ count: 101 });
    const r = await scanInventory(second.host, { resume: partial });
    expect(r.scan.complete).toBe(false);
    expect(r.scan.issues.join()).toContain('库存已变化');
    expect(second.state.saves.at(-1).artifacts).toHaveLength(40);
    expect(second.state.saves.at(-1).scan.total).toBe(100);
  });
  test('续扫时分辨率不符，检查点保留上次进度', async () => {
    const partial = await scanInventory(fakeBag({ count: 100 }).host, { maxPages: 1 });
    const second = fakeBag({ count: 100 });
    second.host.size = async () => ({ width: 1280, height: 720 });
    await scanInventory(second.host, { resume: partial });
    expect(second.state.saves.every(s => s.artifacts.length === 40)).toBe(true);
  });
  test('续扫：两次运行间套装效果文字识别不同，仍能快进对齐', async () => {
    const partial = await scanInventory(fakeBag({ count: 300, clicksPerRow: 9.6 }).host, { maxPages: 3 });
    const second = fakeBag({ count: 300, clicksPerRow: 9.6 });
    second.items.forEach((t, i) => { second.items[i] = t.replace('2件套:', '02件套:').replace('提高20%', '提髙20%'); });
    const r = await scanInventory(second.host, { resume: partial });
    expect(r.scan.issues).toEqual([]);
    expect(r.scan.complete).toBe(true);
    expect(r.artifacts.map(a => fingerprint(a.rawOcr))).toEqual(second.items.map(fingerprint));
    expect(second.state.clicks).toBeLessThan(300);
  });
  test('续扫：上次停在首屏中途时从首屏继续', async () => {
    const partial = await scanInventory(fakeBag({ count: 100, failAt: 11 }).host);
    expect(partial.artifacts).toHaveLength(10);
    const second = fakeBag({ count: 100 });
    const r = await scanInventory(second.host, { resume: partial });
    expect(r.scan.complete).toBe(true);
    expect(r.artifacts.map(a => a.rawOcr)).toEqual(second.items);
  });
  test('续扫：已读区域首行任一格变化则停止，不宣称完整', async () => {
    const partial = await scanInventory(fakeBag({ count: 100 }).host, { maxPages: 1 });
    const second = fakeBag({ count: 100 });
    second.items[3] = panel(999);
    const r = await scanInventory(second.host, { resume: partial });
    expect(r.scan.complete).toBe(false);
    expect(r.scan.issues.join()).toContain('背包开头与上次记录不同');
  });
  test('续扫：按获取时间排序时，开头出现新圣遗物即拒绝', async () => {
    const partial = await scanInventory(fakeBag({ count: 100 }).host, { maxPages: 1 });
    // 获得 1 件新的（排在最前）并分解 1 件旧的，总数不变。
    const second = fakeBag({ count: 100 });
    second.items.unshift(panel(999));
    second.items.pop();
    const r = await scanInventory(second.host, { resume: partial });
    expect(r.scan.complete).toBe(false);
    expect(r.scan.issues.join()).toContain('获得了新圣遗物');
    expect(second.state.ups).toBe(0);
  });
  test('末尾的强化材料与空格不计入，件数相符时完整', async () => {
    const { host, items } = fakeBag({ count: 93, materials: 2 });
    const r = await scanInventory(host);
    expect(r.scan.complete).toBe(true);
    expect(r.artifacts.map(a => a.rawOcr)).toEqual(items);
  });
  test('相邻两件属性完全相同时不误判为空格', async () => {
    const { host, items } = fakeBag({ count: 93, materials: 2 });
    items[50] = items[49]; items[51] = items[49]; items[2] = items[1];
    // 视图开头前两件相同：没有更早的不同格可作参照，改用后一格判断。
    items[1] = items[0];
    const r = await scanInventory(host);
    expect(r.scan.complete).toBe(true);
    expect(r.artifacts.map(a => a.rawOcr)).toEqual(items);
  });
  test('开着筛选时读到末尾即停止，提示取消筛选，不宣称完整', async () => {
    for (const materials of [0, 2]) {
      const { host, items } = fakeBag({ count: 120, shown: 93, materials, header: '圣遗物 120/2100' });
      const r = await scanInventory(host);
      expect(r.scan.complete).toBe(false);
      expect(r.artifacts.map(a => a.rawOcr)).toEqual(items);
      expect(r.scan.issues.join()).toContain('筛选');
    }
  });
  test('续扫时去掉旧版误记的强化材料', async () => {
    const partial = await scanInventory(fakeBag({ count: 100 }).host, { maxPages: 1 });
    partial.artifacts.push({ ...partial.artifacts[0], rawOcr: '祝圣油膏\n圣遗物强化素材' });
    const second = fakeBag({ count: 100 });
    const r = await scanInventory(second.host, { resume: partial });
    expect(r.scan.complete).toBe(true);
    expect(r.artifacts.map(a => a.rawOcr)).toEqual(second.items);
  });
  test('面板不稳定时停止，不能继续下一件', async () => {
    const { host, state } = fakeBag({ unstable: true });
    const r = await scanInventory(host);
    expect(state.clicks).toBe(1); expect(r.artifacts).toHaveLength(0); expect(r.scan.issues.join()).toContain('不稳定');
  });
  test('用户中断后保存部分扫描', async () => {
    const { host, state } = fakeBag({ count: 5, failAt: 3 });
    const r = await scanInventory(host);
    expect(r.artifacts).toHaveLength(2); expect(state.saves.at(-1).artifacts).toHaveLength(2); expect(r.scan.issues.join()).toContain('用户中断');
  });
  test('限页扫描不宣称完整', async () => {
    const { host } = fakeBag({ count: 50 });
    const r = await scanInventory(host, { maxPages: 1 });
    expect(r.artifacts).toHaveLength(40); expect(r.scan.complete).toBe(false); expect(r.scan.issues.join()).toContain('40/50');
  });
});

describe('指纹', () => {
  test('忽略套装效果文字、行首符号与全零杂行，副词条不同则不同', () => {
    const a = panel(0);
    expect(fingerprint(a.replace('提高20%', '提髙2O%'))).toBe(fingerprint(a));
    expect(fingerprint(a.replace('·', '?').replace('生命值\n4,780', '生命值\n000\n4,780'))).toBe(fingerprint(a));
    expect(fingerprint(panel(1))).not.toBe(fingerprint(a));
  });
});

describe('面板解析', () => {
  test('读出套装、主词条、副词条和五星', () => {
    const a = parsePanel(panel(0), 'a', { ordinal: 1 });
    expect(a.set).toBe('绝缘之旗印'); expect(a.main).toEqual({ key: 'hpPlus', value: 4780 }); expect(a.subs).toHaveLength(4); expect(a.rarity).toBe(5); expect(a.locked).toBeNull();
  });
  test('主词条数值前多出全零杂行时跳过', () => {
    const a = parsePanel(panel(0).replace('生命值\n4,780', '生命值\n000\n4,780'), 'a');
    expect(a.main).toEqual({ key: 'hpPlus', value: 4780 });
    expect(a.subs).toHaveLength(4);
  });
  test('部位与主词条之间多出单字杂行时跳过', () => {
    const a = parsePanel(panel(0).replace('生之花\n生命值', '生之花\n可\n生命值'), 'a');
    expect(a.main).toEqual({ key: 'hpPlus', value: 4780 });
    expect(a.rarity).toBe(5);
    expect(a.subs).toHaveLength(4);
  });
  test('行首圆点被读成其他符号时仍读出副词条', () => {
    const text = panel(0).replace('·', '').replace('暴击伤害+7.8%', '?暴击伤害+7.8%').replace('攻击力+5.8%', '。攻击力+5.8%');
    expect(parsePanel(text, 'a').subs.map(x => x.key)).toEqual(['cpct', 'cdmg', 'atk', 'recharge']);
  });
  test('有穿戴行时读出角色，无穿戴行时为未穿戴', () => {
    expect(parsePanel(panel(0, '\n雷电将军已装备'), 'a').equippedBy).toBe('雷电将军');
    expect(parsePanel(panel(0), 'a').equippedBy).toBe('');
  });
  test('按主词条数值区分五星与四星', () => {
    expect(rarityFromMain('hpPlus', 0, 717)).toBe(5);
    expect(rarityFromMain('hpPlus', 0, 645)).toBe(4);
    expect(rarityFromMain('cpct', 16, 23.2)).toBe(4);
    expect(rarityFromMain('cpct', 16, 26.8)).toBe(5);
    expect(rarityFromMain('pyro', 20, 46.6)).toBe(5);
    expect(rarityFromMain('hpPlus', 0, 1000)).toBeNull();
    // +17 以上只可能是五星，但主词条数值仍须符合五星曲线。
    expect(rarityFromMain('cpct', 20, 31.1)).toBe(5);
    expect(rarityFromMain('cpct', 20, 5)).toBeNull();
  });
});
