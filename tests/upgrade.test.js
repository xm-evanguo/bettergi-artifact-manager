import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { recordRoll, nextAction, rolledKey } from '../repo/js/ArtifactManager/lib/upgrade.js';
import { buildSalvageFilter } from '../repo/js/ArtifactManager/lib/salvage-filter.js';
import { MAX_ROLL } from '../repo/js/ArtifactManager/lib/model.js';
import { item } from './helpers.js';

const CORE = ['cpct', 'cdmg'];

/** 构造 +0 的四词条虚构圣遗物。 */
function fresh(subs = [['cpct', 3.9], ['atk', 5.8], ['def', 7.3], ['hpPlus', 299]]) {
  return item('u', { level: 0, subs: subs.map(([key, value]) => ({ key, value, active: true })) });
}

/** 模拟一次强化落在指定词条。 */
function roll(a, key) {
  const subs = a.subs.map(s => (s.key === key ? { ...s, value: Math.round((s.value + MAX_ROLL[key]) * 10) / 10 } : s));
  return { ...a, level: a.level + 4, subs };
}

/** 依次强化并返回每一步的状态。 */
function run(keys, start = fresh()) {
  let state = { level: start.level, misses: 0, artifact: start, core: CORE };
  const steps = [];
  for (const key of keys) {
    state = recordRoll(state, roll(state.artifact, key), state.level + 4);
    steps.push(state);
    if (state.action !== 'continue') break;
  }
  return steps;
}

describe('强化规则', () => {
  test('没有任何双暴词条直接分解，不强化', () => {
    const a = fresh([['atk', 5.8], ['def', 7.3], ['hpPlus', 299], ['mastery', 23]]);
    expect(nextAction({ level: 0, misses: 0, artifact: a, core: CORE })).toBe('discard');
  });
  test('+8 时已歪两次立即分解', () => {
    const steps = run(['atk', 'def']);
    expect(steps.length).toBe(2);
    expect(steps.at(-1).action).toBe('discard');
    expect(steps.at(-1).misses).toBe(2);
  });
  test('+12 只歪一次则继续强化到 +20', () => {
    const steps = run(['cpct', 'atk', 'cpct', 'def', 'hpPlus']);
    expect(steps[2].level).toBe(12);
    expect(steps[2].action).toBe('continue');
    expect(steps.at(-1).level).toBe(20);
    expect(steps.at(-1).action).toBe('done');
  });
  test('+12 之后再歪不计入，仍强化到满级', () => {
    const steps = run(['cpct', 'cpct', 'atk', 'def', 'def']);
    expect(steps.at(-1).misses).toBe(1);
    expect(steps.at(-1).action).toBe('done');
  });
  test('三词条 +4 新增词条按落点判断', () => {
    const start = fresh([['cpct', 3.9], ['atk', 5.8], ['def', 7.3]]);
    const after = { ...start, level: 4, subs: [...start.subs, { key: 'cdmg', value: 7.8, active: true }] };
    expect(rolledKey(start, after)).toBe('cdmg');
  });
  test('无法判断落点时停止', () => {
    const a = fresh();
    expect(() => recordRoll({ level: 0, misses: 0, artifact: a, core: CORE }, a, 4)).toThrow();
  });
});

/** 模拟 BetterGI 传入的 ArtifactStat；枚举与字符串宽松相等。 */
function hostStat(a, map) {
  const affix = (key, value) => ({ Type: { toString: () => map[key] }, Value: value });
  return { Name: a.name, Level: a.level, MainAffix: affix(a.main.key, a.main.value), MinorAffixes: a.subs.map(s => affix(s.key, s.value)) };
}

/** 在隔离作用域执行生成的筛选脚本。 */
function evaluate(js, stat) {
  return new Function('ArtifactStat', `var Output;${js};return Output;`)(stat);
}

describe('分解筛选脚本', () => {
  const map = { hpPlus: 'HP', cpct: 'CRITRate', cdmg: 'CRITDMG', atk: 'ATKPercent', recharge: 'EnergyRecharge', def: 'DEFPercent' };
  const target = item('t');
  const js = buildSalvageFilter([target]);
  test('完全一致的圣遗物输出 true', () => {
    expect(evaluate(js, hostStat(target, map))).toBe(true);
  });
  test('任一副词条数值不同输出 false', () => {
    const other = { ...target, subs: target.subs.map((s, i) => (i === 0 ? { ...s, value: 7.8 } : s)) };
    expect(evaluate(js, hostStat(other, map))).toBe(false);
  });
  test('等级不同输出 false', () => {
    expect(evaluate(js, hostStat({ ...target, level: 16 }, map))).toBe(false);
  });
});

describe('角色配装数据', () => {
  const data = JSON.parse(readFileSync('repo/js/ArtifactManager/data/builds.json', 'utf8'));
  const keys = new Set(['hp', 'atk', 'def', 'hpPlus', 'atkPlus', 'defPlus', 'mastery', 'recharge', 'cpct', 'cdmg', 'heal', 'phy', 'pyro', 'hydro', 'electro', 'cryo', 'anemo', 'geo', 'dendro']);
  test('词条键有效，核心副词条取自副词条清单', () => {
    for (const c of data.characters) for (const b of c.builds) {
      for (const k of [...Object.values(b.mainStats).flat(), ...b.subStats]) expect(keys.has(k)).toBe(true);
      expect(b.coreSubStats.length).toBeGreaterThan(0);
      for (const k of b.coreSubStats) expect(b.subStats).toContain(k);
    }
  });
});
