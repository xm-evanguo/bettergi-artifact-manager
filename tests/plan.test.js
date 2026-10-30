import { describe, test, expect } from 'bun:test';
import { buildPlan } from '../repo/js/ArtifactManager/lib/plan.js';
import { renderPlanReport } from '../repo/js/ArtifactManager/lib/plan-report.js';
import { item, snapshot } from './helpers.js';

/** 虚构配装：一名雷电将军，绝缘之旗印，充能/攻击沙、雷伤杯、双暴头。 */
function builds(characters = [{ name: '雷电将军', level: 90 }]) {
  return {
    graduateGrade: 'SSS',
    characters: characters.map(c => ({ ...c, builds: [{ sets: ['绝缘之旗印'], mainStats: { sands: ['recharge', 'atk'], goblet: ['electro'], circlet: ['cpct', 'cdmg'] }, subStats: ['cpct', 'cdmg', 'atk', 'recharge'] }] })),
  };
}

/** 构造副词条；数值按满档次数给出。 */
const sub = (key, rolls) => ({ key, value: Math.round({ cpct: 3.89, cdmg: 7.77, atk: 5.83, def: 7.29, hp: 5.83, mastery: 23.31 }[key] * rolls * 10) / 10, active: true });

/** 一套完整的虚构 +20 绝缘五件；crit 为双暴各自的强化次数，其余次数落在攻击和防御。 */
function fullSet(prefix, crit = 3) {
  const other = 4 - crit;
  const subs = [sub('cpct', crit), sub('cdmg', crit), sub('atk', other), sub('def', other)];
  const main = [{ key: 'hpPlus', value: 4780 }, { key: 'atkPlus', value: 311 }, { key: 'recharge', value: 51.8 }, { key: 'electro', value: 46.6 }, { key: 'cpct', value: 31.1 }];
  return main.map((m, slot) => item(`${prefix}${slot}`, { slot, main: m, subs: slot === 4 ? subs.filter(s => s.key !== 'cpct').concat(sub('hp', 1)) : subs }));
}

describe('配装分配与清单', () => {
  test('完整一套分给角色并全部保留', () => {
    const plan = buildPlan(snapshot(fullSet('a')), builds());
    expect(plan.loadouts[0].complete).toBe(true);
    expect(plan.loadouts[0].slots.every(s => s.id)).toBe(true);
    expect(plan.counts.keep).toBe(5);
    expect(plan.counts.discard).toBe(0);
  });
  test('更弱的同部位件进入分解清单，并生成筛选脚本', () => {
    const weak = item('weak', { subs: [sub('cpct', 1), sub('atk', 3), sub('def', 3), sub('mastery', 1)] });
    const plan = buildPlan(snapshot([...fullSet('a'), weak]), builds());
    expect(plan.records.find(r => r.id === 'weak').category).toBe('discard');
    expect(plan.salvage.js).toContain('Output=');
  });
  test('同一件只分给一个角色，高等级角色先挑', () => {
    const plan = buildPlan(snapshot(fullSet('a')), builds([{ name: '雷电将军', level: 80 }, { name: '刻晴', level: 90 }]));
    expect(plan.loadouts[0].name).toBe('刻晴');
    expect(plan.loadouts[1].slots.every(s => !s.id)).toBe(true);
  });
  test('未毕业部位保留带核心词条的未满级候选，无核心词条的分解', () => {
    const set = fullSet('a', 1);
    // crit=1 的整套分数低于毕业线。
    const hopeful = item('hope', { level: 0, subs: [sub('cpct', 1), sub('atk', 1), sub('def', 1)] });
    const hopeless = item('none', { level: 0, subs: [sub('atk', 1), sub('def', 1), sub('hp', 1)] });
    const plan = buildPlan(snapshot([...set, hopeful, hopeless]), builds());
    expect(plan.loadouts[0].slots[0].graduated).toBe(false);
    expect(plan.records.find(r => r.id === 'hope').category).toBe('upgrade');
    expect(plan.records.find(r => r.id === 'none').category).toBe('discard');
  });
  test('凑不齐自身套装的高等级角色不抢其他角色的整套', () => {
    const doc = builds([{ name: '雷电将军', level: 80 }]);
    doc.characters.unshift({ name: '芙宁娜', level: 100, builds: [{ sets: ['黄金剧团'], mainStats: { sands: ['recharge', 'hp'], goblet: ['hp', 'hydro'], circlet: ['cpct', 'cdmg'] }, subStats: ['cpct', 'cdmg'] }] });
    const plan = buildPlan(snapshot(fullSet('a')), doc);
    expect(plan.loadouts.find(l => l.name === '雷电将军').complete).toBe(true);
    expect(plan.loadouts[0].name).toBe('芙宁娜');
  });
  test('没有任何配装时关闭分解清单', () => {
    const plan = buildPlan(snapshot(fullSet('a')), { graduateGrade: 'SSS', characters: [] });
    expect(plan.counts.discard).toBe(0);
    expect(plan.blockers.join()).toContain('配装数据');
  });
  test('多套玩法时选总分更高的一套', () => {
    const doc = builds();
    doc.characters[0].builds.unshift({ sets: ['黄金剧团'], mainStats: { sands: ['atk'], goblet: ['electro'], circlet: ['cpct', 'cdmg'] }, subStats: ['cpct', 'cdmg'] });
    const plan = buildPlan(snapshot(fullSet('a')), doc);
    expect(plan.loadouts[0].build).toBe(1);
    expect(plan.loadouts[0].set).toBe('绝缘之旗印');
  });
  test('强化候选按潜力而非当前分数排序', () => {
    const set = fullSet('a', 1);
    const fresh3 = n => item(n, { level: 0, subs: [sub('cpct', 1), sub('cdmg', 1), sub('def', 1)] });
    const leveled = item('lv8', { level: 8, subs: [sub('cpct', 1), sub('atk', 2), sub('def', 2), sub('hp', 1)] });
    const plan = buildPlan(snapshot([...set, fresh3('f1'), fresh3('f2'), leveled]), builds());
    expect(plan.records.find(r => r.id === 'f1').category).toBe('upgrade');
    expect(plan.records.find(r => r.id === 'f2').category).toBe('upgrade');
    expect(plan.records.find(r => r.id === 'lv8').category).toBe('discard');
  });
  test('计划记录保留定位与完整词条', () => {
    const r = buildPlan(snapshot(fullSet('a')), builds()).records[0];
    expect(r.location).toBeDefined();
    expect(r.subs.length).toBe(4);
    expect(r.main.key).toBe('hpPlus');
  });
  test('非五星作为材料，不进入分解清单', () => {
    const plan = buildPlan(snapshot([...fullSet('a'), item('four', { rarity: 4, level: 16 })]), builds());
    expect(plan.records.find(r => r.id === 'four').category).toBe('fodder');
  });
  test('配装点名的四星套装参与分配，五星套装的四星版本仍作材料', () => {
    const doc = builds();
    doc.characters[0].builds = [{ sets: ['教官'], mainStats: { sands: ['recharge'], goblet: ['electro'], circlet: ['cpct'] }, subStats: ['cpct', 'cdmg'] }];
    const four = fullSet('t').map(a => ({ ...a, set: '教官', rarity: 4, level: 16, main: { ...a.main, value: { hpPlus: 3571, atkPlus: 232, recharge: 38.7, electro: 34.8, cpct: 23.2 }[a.main.key] } }));
    const plan = buildPlan(snapshot(four), doc);
    expect(plan.loadouts[0].complete).toBe(true);
    expect(plan.counts.keep).toBe(5);
  });
  test('另写核心副词条的玩法按自身副词条评分', () => {
    const doc = builds();
    doc.characters[0].builds = [{ sets: ['乐园遗落之花'], mainStats: { sands: ['mastery'], goblet: ['mastery'], circlet: ['mastery'] }, subStats: ['mastery'], coreSubStats: ['mastery'] }];
    const subs = [sub('mastery', 5), sub('atk', 1), sub('def', 1), sub('hp', 1)];
    const main = [{ key: 'hpPlus', value: 4780 }, { key: 'atkPlus', value: 311 }, { key: 'mastery', value: 187 }, { key: 'mastery', value: 187 }, { key: 'mastery', value: 187 }];
    const other = [sub('cpct', 1), sub('atk', 1), sub('def', 1), sub('hp', 5)];
    const set = main.map((m, slot) => item(`m${slot}`, { slot, set: '乐园遗落之花', main: m, subs: slot < 2 ? subs : other }));
    const plan = buildPlan(snapshot(set), doc);
    // 按 miao 默认权重雷电不需要精通，花羽只有 1 次攻击力有效；按精通玩法评分应明显更高。
    expect(plan.loadouts[0].slots.every(x => x.id)).toBe(true);
    expect(plan.loadouts[0].slots[0].score).toBeGreaterThan(30);
  });
  test('四件套之外的散件部位接受其他套装的强化候选', () => {
    const set = fullSet('a', 1).slice(0, 4);
    const circlet = c => item(c, { slot: 4, set: '黄金剧团', level: c === 'off' ? 20 : 0, main: { key: 'cdmg', value: c === 'off' ? 62.2 : 9.3 }, subs: [sub('cpct', 1), sub('atk', 1), sub('def', 1), ...(c === 'off' ? [sub('hp', 5)] : [])] });
    const plan = buildPlan(snapshot([...set, circlet('off'), circlet('cand')]), builds());
    expect(plan.records.find(r => r.id === 'off').category).toBe('keep');
    expect(plan.records.find(r => r.id === 'cand').category).toBe('upgrade');
  });
  test('已选用但未满级、未毕业的件列入强化', () => {
    const set = fullSet('a', 1);
    set[0] = { ...set[0], level: 8, subs: [sub('cpct', 1), sub('cdmg', 1), sub('atk', 1), sub('def', 1)] };
    const r = buildPlan(snapshot(set), builds()).records.find(x => x.id === 'a0');
    expect(r.category).toBe('upgrade');
    expect(r.reasons.join()).toContain('已选用');
  });
  test('五件同套时任一部位都接受其他套装的强化候选', () => {
    const cand = item('cand', { level: 0, set: '黄金剧团', subs: [sub('cpct', 1), sub('atk', 1), sub('def', 1)] });
    const plan = buildPlan(snapshot([...fullSet('a', 1), cand]), builds());
    expect(plan.records.find(r => r.id === 'cand').category).toBe('upgrade');
  });
  test('已毕业但未满级的已选用件仍列入强化', () => {
    const set = fullSet('a');
    set[0] = { ...set[0], level: 16 };
    const plan = buildPlan(snapshot(set), builds());
    expect(plan.loadouts[0].slots[0].graduated).toBe(true);
    expect(plan.records.find(r => r.id === 'a0').category).toBe('upgrade');
  });
  test('无核心副词条的已选用件保留但不建议强化', () => {
    const set = fullSet('a', 1);
    set[0] = { ...set[0], level: 8, subs: [sub('atk', 2), sub('def', 2), sub('hp', 1), sub('mastery', 1)] };
    expect(buildPlan(snapshot(set), builds()).records.find(r => r.id === 'a0').category).toBe('keep');
  });
  test('只要求精通的玩法，精通主词条的候选进入强化', () => {
    const doc = builds();
    doc.characters[0].builds = [{ sets: ['乐园遗落之花'], mainStats: { sands: ['mastery'], goblet: ['mastery'], circlet: ['mastery'] }, subStats: ['mastery'], coreSubStats: ['mastery'] }];
    const goblet = id => item(id, { slot: 3, set: '乐园遗落之花', level: 0, main: { key: 'mastery', value: 28 }, subs: [sub('atk', 1), sub('def', 1), sub('hp', 1)] });
    const plan = buildPlan(snapshot([goblet('g1'), goblet('g2')]), doc);
    expect(plan.records.filter(r => r.category === 'upgrade').map(r => r.id).sort()).toEqual(['g1', 'g2']);
  });
  test('存在 blocker 时四星不作材料，改为待复查', () => {
    const plan = buildPlan(snapshot([...fullSet('a'), item('four', { rarity: 4, level: 16 })], { complete: false }), builds());
    expect(plan.records.find(r => r.id === 'four').category).toBe('review');
    expect(plan.counts.fodder).toBe(0);
  });
  test('识别异常件不使计划中止', () => {
    const bad = item('bad', { main: { key: 'unknown', value: 1 } });
    const weak = item('weak', { name: '弱花', subs: [sub('cpct', 1), sub('atk', 3), sub('def', 3), sub('mastery', 1)] });
    const plan = buildPlan(snapshot([...fullSet('a'), weak, bad]), builds());
    expect(plan.records.find(r => r.id === 'bad').category).toBe('review');
    expect(plan.records.find(r => r.id === 'weak').category).toBe('discard');
  });
  test('扫描未确认完整时不生成分解清单', () => {
    const extra = item('x', { subs: [sub('atk', 3), sub('def', 3), sub('hp', 1), sub('mastery', 1)] });
    const plan = buildPlan(snapshot([...fullSet('a'), extra], { complete: false }), builds());
    expect(plan.counts.discard).toBe(0);
    expect(plan.records.find(r => r.id === 'x').category).toBe('review');
    expect(plan.salvage.js).toBe('Output=false;');
  });
  test('锁定和穿戴件也参与计算，分解时注明需先处理', () => {
    const locked = item('lk', { locked: true, equippedBy: '刻晴', subs: [sub('atk', 3), sub('def', 3), sub('hp', 1), sub('mastery', 1)] });
    const r = buildPlan(snapshot([...fullSet('a'), locked]), builds()).records.find(x => x.id === 'lk');
    expect(r.category).toBe('discard');
    expect(r.reasons.join()).toContain('解锁');
    expect(r.reasons.join()).toContain('卸下');
  });
  test('报告转义外部文字并包含筛选脚本', () => {
    const weak = item('weak', { name: '<img>', subs: [sub('cpct', 1), sub('atk', 3), sub('def', 3), sub('mastery', 1)] });
    const html = renderPlanReport(buildPlan(snapshot([...fullSet('a'), weak]), builds()));
    expect(html).toContain('&lt;img&gt;');
    expect(html).not.toContain('<img>');
    expect(html).toContain('<textarea readonly>');
    expect(html).toContain('雷电将军');
  });
});
