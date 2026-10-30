import { test, expect, describe } from 'bun:test';
import { scanInventory } from '../repo/js/ArtifactManager/lib/scan.js';
import { parsePanel, rarityFromMain } from '../repo/js/ArtifactManager/lib/ocr.js';

/** 第 n 件的虚构面板；数值不同以便区分每一件。 */
const panel = (n, extra = '') => `虚构之花\n生之花\n生命值\n4,780\n+20\n暴击率+${(3.1 + n / 10).toFixed(1)}%\n暴击伤害+7.8%\n攻击力+5.8%\n元素充能效率+6.5%\n绝缘之旗印:\n2件套:元素充能效率提高20%${extra}`;

/**
 * 模拟背包：8 列网格，每页 5 行；每滚 39 格前进 scrollRows 行，滚到底时与底部对齐。
 * 只记录点击、滚动与检查点，不发送任何系统输入。
 */
function fakeBag({ count = 2, header, unstable = false, failAt = Infinity, scrollRows = 4 } = {}) {
  const items = Array.from({ length: count }, (_, i) => panel(i));
  const totalRows = Math.ceil(count / 8);
  const state = { clicks: 0, scrolls: 0, saves: [], offset: 0, ticks: 0, selected: null, reads: 0, opened: false };
  const host = {
    size: async () => ({ width: 1920, height: 1080 }),
    returnMainUi: async () => {}, keyPress: async () => { state.opened = true; },
    ocr: async rect => {
      if (rect.height === 100) return header ?? `圣遗物 ${count}/2100`;
      if (unstable && state.reads++ % 2) return '不同结果';
      return state.selected === null ? '' : items[state.selected] ?? '';
    },
    click: async (x, y) => {
      state.clicks++;
      if (state.clicks === failAt) throw new Error('用户中断');
      const col = Math.round((x - 180) / 145), row = Math.round((y - 253) / 166);
      if (x === 675 && y === 50) return;
      state.selected = (state.offset + row) * 8 + col;
    },
    move: async () => {},
    scroll: async n => {
      state.scrolls++;
      if (n < 0 && ++state.ticks === 39) { state.ticks = 0; state.offset = Math.min(state.offset + scrollRows, Math.max(0, totalRows - 5)); }
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
  test('滚动过多（超过 4 行）时没有重叠，停止且不宣称完整', async () => {
    const { host } = fakeBag({ count: 120, scrollRows: 6 });
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

describe('面板解析', () => {
  test('读出套装、主词条、副词条和五星', () => {
    const a = parsePanel(panel(0), 'a', { ordinal: 1 });
    expect(a.set).toBe('绝缘之旗印'); expect(a.main).toEqual({ key: 'hpPlus', value: 4780 }); expect(a.subs).toHaveLength(4); expect(a.rarity).toBe(5); expect(a.locked).toBeNull();
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
