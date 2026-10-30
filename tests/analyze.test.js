import { describe, test, expect } from 'bun:test';
import { analyze } from '../repo/js/ArtifactManager/lib/analyze.js';
import { normalizeSnapshot } from '../repo/js/ArtifactManager/lib/model.js';
import { potential, referenceScore } from '../repo/js/ArtifactManager/lib/scoring.js';
import { renderReport } from '../repo/js/ArtifactManager/lib/report.js';
import { item, config, snapshot } from './helpers.js';

/** 稳定的强弱对照件，弱件只能引用永久保留的满级替代件。 */
function inventory() {
  const strong = item('strong', { subs: item('x').subs.map(s => ({ ...s, value: s.value * (['cpct', 'cdmg'].includes(s.key) ? 2 : 1) })) });
  return snapshot([strong, item('weak')]);
}

describe('保守清理与范围', () => {
  test('弱满级冗余件有逐属性不差的保留替代件', () => {
    const r = analyze(inventory(), config());
    expect(r.blockers).toEqual([]);
    expect(r.counts.cleanup).toBe(1);
    expect(r.records[1].replacements).toEqual(['strong']);
    expect(r.records[0].category).toBe('keep');
    expect(r.targetGap).toBe(9);
  });
  for (const [name, change] of Object.entries({ '锁定': a => { a.locked = true; }, '穿戴': a => { a.equippedBy = '其他角色'; }, '用户保护': (_, c) => { c.protectedIds = ['weak']; } })) {
    test(`${name}优先保留`, () => { const s = inventory(), c = config(); change(s.artifacts[1], c); expect(analyze(s, c).records[1].category).toBe('keep'); });
  }
  for (const [name, change] of Object.entries({ '扫描不完整': s => { s.scan.complete = false; }, '尚未核对': s => { s.scan.verified = false; }, '数量不符': s => { s.scan.total++; }, '重复编号': s => { s.artifacts[1].id = 'strong'; }, '未知锁定': s => { s.artifacts[1].locked = null; }, '漏词条': s => { s.artifacts[1].subs.pop(); }, '未知星级': s => { s.artifacts[1].rarity = null; }, '异常记录': s => { s.scan.issues.push('翻页不确定'); } })) {
    test(`${name}关闭全部清理建议`, () => { const s = inventory(); change(s); const r = analyze(s, config()); expect(r.counts.cleanup).toBe(0); expect(r.blockers.length).toBeGreaterThan(0); });
  }
  test('规则未核对、角色未知、名单未确认分别关闭清理', () => {
    const a = config(); a.rules['雷电将军'][0].reviewed = false;
    const b = config(['不存在的角色']);
    const c = config(); c.rosterConfirmed = false;
    for (const value of [a, b, c]) expect(analyze(inventory(), value).counts.cleanup).toBe(0);
  });
  test('同属性多件不会按哈希合并且至少保留一件', () => {
    const r = analyze(snapshot([item('one'), item('two'), item('three')]), config());
    expect(r.records.length).toBe(3);
    expect(r.counts.keep).toBe(1);
    expect(r.counts.cleanup).toBe(2);
    expect(r.records.filter(x => x.category === 'cleanup').every(x => x.replacements.includes('one'))).toBe(true);
  });
  test('角色数量决定不同保留额度，主力与备用都有份额', () => {
    const r = analyze(snapshot([item('one'), item('two'), item('three')]), config(['雷电将军', '香菱']));
    expect(r.counts.keep).toBe(2);
    expect(r.counts.cleanup).toBe(1);
    expect(new Set(r.records.find(x => x.category === 'cleanup').replacements).size).toBe(2);
  });
  test('不同属性方向不由单一分数相抵', () => {
    const s = inventory(); s.artifacts[1].subs.find(x => x.key === 'recharge').value = 30;
    expect(analyze(s, config()).counts.cleanup).toBe(0);
  });
  test('其他玩法将某件视为散件时也必须满足其属性需求', () => {
    const s = inventory(), c = config(['雷电将军', '香菱']);
    c.rules['香菱'][0].sets = ['其他套装'];
    c.rules['香菱'][0].weights = { hp: 100, atk: 0, recharge: 0, cpct: 0, cdmg: 0, def: 0, mastery: 0 };
    s.artifacts[1].subs[0] = { key: 'hp', value: 5.8, active: true };
    expect(analyze(s, c).counts.cleanup).toBe(0);
  });
  test('稀缺主词条和低星过渡件保持保留', () => {
    const low = item('low', { rarity: 4, level: 16 });
    const rare = item('rare', { slot: 3, main: { key: 'electro', value: 46.6 } });
    expect(analyze(snapshot([low, rare]), config()).records.every(r => r.category === 'keep')).toBe(true);
  });
  test('穿戴在其他角色身上的强件不充当可自由分配替代件', () => {
    const s = inventory(); s.artifacts[0].equippedBy = '其他角色';
    expect(analyze(s, config()).counts.cleanup).toBe(0);
  });
  test('目标空位不会放宽清理标准', () => {
    const c = config(); c.targetFreeSlots = 9999;
    const r = analyze(inventory(), c); expect(r.counts.cleanup).toBe(1); expect(r.targetGap).toBe(9998);
  });
});

describe('强化与数据导入', () => {
  test('未满级低分但有潜力的装备不会被淘汰', () => {
    const s = inventory(); s.artifacts[1].level = 0;
    s.artifacts[1].subs.find(x => x.key === 'recharge').value = 6.5;
    const r = analyze(s, config());
    expect(r.records[1].category).not.toBe('cleanup');
    expect(r.records[1].upgrade.nextLevel).toBe(4);
    expect(r.upgradeQueue).toContain('weak');
  });
  test('等级不在四级节点仍保留正确的剩余机会', () => {
    const a = item('one', { level: 1 });
    expect(potential(a, { cpct: 100 }).ceiling - potential(a, { cpct: 100 }).current).toBe(5);
    expect(potential(a, { cpct: 100 }).nextLevel).toBe(4);
  });
  test('待激活词条不进入当前得分但保留其潜力', () => {
    const a = item('pending', { level: 0 }); a.subs[0].active = false;
    const b = structuredClone(a); b.subs = b.subs.filter(s => s.active);
    const w = { cpct: 100 };
    expect(potential(a, w).current).toBe(0);
    expect(potential(a, w).ceiling).toBeGreaterThan(0);
    expect(referenceScore(a, { name: '雷电将军' })).toBe(referenceScore(b, { name: '雷电将军' }));
  });
  test('参考分按 miao-plugin 公式计算，未知角色为空', () => {
    // 花的数值与替换前的社区模块一致；同元素杯按 miao-plugin 当前上限算法计算。
    const goblet = item('g', { slot: 3, main: { key: 'electro', value: 46.6 } });
    expect(referenceScore(item('x'), { name: '雷电将军' })).toBe(41.6);
    expect(referenceScore(goblet, { name: '雷电将军' })).toBe(45.2);
    expect(referenceScore(goblet, { name: '钟离' })).toBe(7.9);
    expect(referenceScore(item('x'), { name: '不存在的角色' })).toBeNull();
  });
  test('已满级装备不进入普通强化队列', () => expect(analyze(inventory(), config()).upgradeQueue).toEqual([]));
  test('已知四条无用词条不虚构新词条潜力', () => {
    const a = item('bad', { level: 0, subs: [{ key: 'hp', value: 4.1, active: true }, { key: 'hpPlus', value: 209, active: true }, { key: 'def', value: 5.1, active: true }, { key: 'defPlus', value: 16, active: true }] });
    // 用羽毛，避免主副词条重复。
    a.slot = 1; a.main = { key: 'atkPlus', value: 47 };
    expect(potential(a, { cpct: 100, cdmg: 100 }).ceiling).toBe(0);
  });
  test('三条词条且未知第四条时仍考虑新词条', () => {
    const a = item('one', { level: 0 }); a.subs = a.subs.slice(1);
    expect(potential(a, { cpct: 100 }).ceiling).toBeGreaterThan(0);
  });
  test('OCRArtifacts 输入保留物品数，不信任猜测星级与缺失锁定', () => {
    const r = normalizeSnapshot([{ name: '花', setType: '绝缘之旗印', slot: '生之花', star: 5, lv: '0', main: '生命值', mainVal: '717', attr: [{ '暴击率': '3.9%' }] }]);
    expect(r.artifacts).toHaveLength(1); expect(r.artifacts[0].rarity).toBeNull(); expect(r.scan.verified).toBe(false); expect(r.artifacts[0].subs[0].key).toBe('cpct');
  });
  test('拒绝无效配置，不修改输入快照', () => {
    const s = inventory(), before = JSON.stringify(s);
    analyze(s, config()); expect(JSON.stringify(s)).toBe(before);
    const c = config(); c.reservePerCharacter = 0; expect(() => analyze(s, c)).toThrow();
    const d = config(); d.rules['雷电将军'][0].mainStats[2] = ['hpPlus']; expect(() => analyze(s, d)).toThrow();
  });
  test('恶意 OCR 与角色名称在 HTML 中转义', () => {
    const s = inventory(); s.artifacts[0].name = '<img src=x onerror=alert(1)>'; s.artifacts[0].rawOcr = '</pre><script>alert(1)</script>';
    const html = renderReport(analyze(s, config()));
    expect(html).not.toContain('<img src=x'); expect(html).not.toContain('<script>alert(1)</script>'); expect(html).toContain('&lt;img');
  });
  test('OCR 错读的高数值与不符强化等级的总量关闭清理', () => {
    const a = inventory(); a.artifacts[0].subs[0].value = 39;
    const b = inventory(); b.artifacts[1].subs.forEach(s => { s.value *= 0.2; });
    for (const s of [a, b]) { const r = analyze(s, config()); expect(r.counts.cleanup).toBe(0); expect(r.blockers.length).toBeGreaterThan(0); }
  });
  test('主力的强化候选排在备用角色之前', () => {
    const c = config(['雷电将军', '香菱']); c.rules['香菱'][0].sets = ['备用套装'];
    const substats = item('x').subs.map(s => ({ ...s, value: s.key === 'recharge' ? 6.5 : s.value }));
    const s = snapshot([item('reserve', { level: 0, set: '备用套装', subs: substats }), item('main', { level: 0, subs: substats })]);
    const r = analyze(s, c); expect(r.upgradeQueue).toEqual(['main', 'reserve']); expect(r.counts.upgrade).toBe(2);
  });
});
