import { test, expect } from 'bun:test';
import { scanInventory } from '../script/ArtifactManager/lib/scan.js';
import { parsePanel } from '../script/ArtifactManager/lib/ocr.js';

const panel = '虚构之花\n生之花\n生命值\n4,780\n+20\n暴击率+3.9%\n暴击伤害+7.8%\n攻击力+5.8%\n元素充能效率+6.5%\n绝缘之旗印:\n2件套:元素充能效率提高20%';

/** 假宿主只记录点击与检查点，不发送任何系统输入。 */
function fakeHost({ count = 2, header = `圣遗物 ${count}/2100`, unstable = false, failAt = Infinity } = {}) {
  const state = { clicks: 0, scrolls: 0, saves: [] };
  const host = {
    size: async () => ({ width: 1920, height: 1080 }),
    ocr: async rect => rect.height === 100 ? header : unstable && state.reads++ % 2 ? '不同结果' : panel,
    click: async () => { state.clicks++; if (state.clicks === failAt) throw new Error('用户中断'); },
    move: async () => {}, scroll: async () => { state.scrolls++; }, sleep: async () => {},
    checkpoint: async s => { state.saves.push(structuredClone(s)); },
  };
  state.reads = 0;
  return { host, state };
}

test('未确认背包位置前不点击，错误也保存', async () => {
  const { host, state } = fakeHost(); const r = await scanInventory(host);
  expect(state.clicks).toBe(0); expect(r.scan.complete).toBe(false); expect(state.saves.length).toBeGreaterThan(0);
});
test('错误页面或分辨率在点击前退出', async () => {
  const a = fakeHost({ header: '武器 2/2000' }); await scanInventory(a.host, { prepared: true }); expect(a.state.clicks).toBe(0);
  const b = fakeHost(); b.host.size = async () => ({ width: 1280, height: 720 }); await scanInventory(b.host, { prepared: true }); expect(b.state.clicks).toBe(0);
});
test('点击后两次稳定读取，始终保留未知保护字段且不宣称完整', async () => {
  const { host, state } = fakeHost(); const r = await scanInventory(host, { prepared: true });
  expect(state.clicks).toBe(2); expect(r.artifacts.length).toBe(2); expect(r.artifacts[0].rarity).toBeNull(); expect(r.artifacts[0].locked).toBeNull(); expect(r.scan.verified).toBe(false); expect(r.scan.complete).toBe(false); expect(state.saves.at(-1).artifacts.length).toBe(2);
});
test('相同属性的两件物品仍有独立扫描编号', async () => {
  const { host } = fakeHost(); const r = await scanInventory(host, { prepared: true });
  expect(new Set(r.artifacts.map(a => a.id)).size).toBe(2);
});
test('面板不稳定时停止，不能继续下一件', async () => {
  const { host, state } = fakeHost({ unstable: true }); const r = await scanInventory(host, { prepared: true });
  expect(state.clicks).toBe(1); expect(r.artifacts).toHaveLength(0); expect(r.scan.issues.join()).toContain('不稳定');
});
test('用户中断后保存部分扫描，不重放操作', async () => {
  const { host, state } = fakeHost({ count: 5, failAt: 3 }); const r = await scanInventory(host, { prepared: true });
  expect(r.artifacts).toHaveLength(2); expect(state.clicks).toBe(3); expect(state.saves.at(-1).artifacts).toHaveLength(2); expect(r.scan.issues.join()).toContain('用户中断');
});
test('限页扫描不因达到页数而宣称成功扫完整', async () => {
  const { host, state } = fakeHost({ count: 50 }); const r = await scanInventory(host, { prepared: true, maxPages: 1 });
  expect(state.clicks).toBe(40); expect(state.scrolls).toBe(0); expect(r.scan.issues.join()).toContain('40/50');
});
test('翻页结果相同无法排除未滚动时停止并保持已存记录', async () => {
  const { host, state } = fakeHost({ count: 50 }); const r = await scanInventory(host, { prepared: true, maxPages: 2 });
  expect(state.scrolls).toBe(49); expect(state.clicks).toBe(41); expect(r.artifacts).toHaveLength(40); expect(r.scan.issues.join()).toContain('首件与前页相同');
});
test('OCR 解析不把套装推断为五星，不把缺失穿戴行视为未穿戴', () => {
  const a = parsePanel(panel, 'a', { ordinal: 1 });
  expect(a.set).toBe('绝缘之旗印'); expect(a.main).toEqual({ key: 'hpPlus', value: 4780 }); expect(a.subs).toHaveLength(4); expect(a.rarity).toBeNull(); expect(a.equippedBy).toBeNull();
});
