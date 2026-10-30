import miao from '../vendor/miao-data.js';
import { MAX_ROLL } from './model.js';

/** 使用 miao-plugin 的角色权重表，不让未知角色落到通用双暴权重；角色 artis.js 有固定默认权重时优先使用。 */
export function characterWeights(name) {
  const w = miao.artisWeights?.[name] || miao.usefulAttr[name];
  return w ? { ...w } : null;
}

/** 可出现在副词条上的百分比与精通、充能、双暴键，用于判断核心副词条。 */
const CORE_CANDIDATES = ['hp', 'atk', 'def', 'mastery', 'recharge', 'cpct', 'cdmg'];

/**
 * 角色的核心副词条：miao 权重为 100 的副词条。
 * 角色未知或没有满权重词条时返回 null，由调用方使用配装数据里的 coreSubStats。
 */
export function coreSubStats(name) {
  const w = characterWeights(name);
  if (!w) return null;
  const core = CORE_CANDIDATES.filter(k => w[k] === 100);
  return core.length ? core : null;
}

/** 评分档位，与 BetterGI 圣遗物实时评分脚本（ArtifactScore）的分档一致：每 7 分一档。 */
const GRADES = [['D', 7], ['C', 14], ['B', 21], ['A', 28], ['S', 35], ['SS', 42], ['SSS', 49], ['ACE', 56]];

/** 把参考分换算为档位。 */
export function grade(score) {
  return GRADES.find(([, limit]) => score < limit)?.[0] || 'MAX';
}

/** 档位对应的最低分，用于设置毕业线。 */
export function gradeMin(name) {
  if (name === 'D') return 0;
  const i = GRADES.findIndex(([g]) => g === name);
  if (i > 0) return GRADES[i - 1][1];
  if (name === 'MAX') return GRADES.at(-1)[1];
  throw new Error(`未知档位：${name}`);
}

/** 将大小词条分开，固定数值仅作保守排序；不能用该分数单独清理。 */
export function weightsFor(build, character) {
  const w = { ...(characterWeights(character.name) || {}), ...(build.weights || {}) };
  return { ...w, hpPlus: w.hpPlus ?? (w.hp || 0) * 0.3, atkPlus: w.atkPlus ?? (w.atk || 0) * 0.3, defPlus: w.defPlus ?? (w.def || 0) * 0.3 };
}

/** 有效词条的当前投入与乐观上限，不输出伪精确概率。 */
export function potential(artifact, weights) {
  const active = artifact.subs.filter(s => s.active);
  const pending = artifact.subs.find(s => !s.active);
  const merit = s => s.value / MAX_ROLL[s.key] * (weights[s.key] || 0) / 100;
  const current = active.reduce((n, s) => n + merit(s), 0);
  const steps = artifact.rarity === 5 ? 5 - Math.floor(artifact.level / 4) : 0;
  let pool = active.map(s => (weights[s.key] || 0) / 100);
  let activation = 0;
  let upgradeSteps = steps;
  if (active.length < 4 && steps > 0) {
    activation = pending ? merit(pending) : Math.max(0, ...Object.keys(MAX_ROLL).filter(k => k !== artifact.main.key && !active.some(s => s.key === k)).map(k => (weights[k] || 0) / 100));
    pool.push(pending ? (weights[pending.key] || 0) / 100 : activation);
    upgradeSteps--;
  }
  return { current, ceiling: current + activation + Math.max(0, ...pool) * upgradeSteps, nextLevel: steps > 0 ? Math.min(20, (Math.floor(artifact.level / 4) + 1) * 4) : null };
}

// 以下参考分按 miao-plugin（MIT）models/artis/ArtisMark.js 与 ArtisMarkCfg.js 的公式移植。
// 只使用角色默认权重，未移植角色专属规则与武器加成，因此只作参考，不参与清理判断。
const MAIN_OPTIONS = { 3: ['atk', 'def', 'hp', 'mastery', 'recharge'], 4: ['atk', 'def', 'hp', 'mastery', 'dmg', 'phy'], 5: ['atk', 'def', 'hp', 'mastery', 'heal', 'cpct', 'cdmg'] };
const SUB_KEYS = ['atk', 'atkPlus', 'def', 'defPlus', 'hp', 'hpPlus', 'mastery', 'recharge', 'cpct', 'cdmg'];
const PLUS_BASE = { hpPlus: 'hp', atkPlus: 'atk', defPlus: 'def' };
const unit = key => miao.basicNum * miao.attrPct[key];

/** 每个有效词条的单位得分；小词条按角色基础属性折算为对应百分比词条。 */
function markTable(weights, baseAttr = { hp: 14000, atk: 230, def: 700 }) {
  const attrs = {};
  for (const key of Object.keys(miao.attrPct)) {
    const base = PLUS_BASE[key];
    const weight = weights[base || key];
    if (!weight) continue;
    const scale = base ? 100 / unit(base) / (baseAttr[base] + (base === 'atk' ? 520 : 0)) : 0;
    attrs[key] = base ? { weight, mark: weight * scale, fixWeight: weight * unit(key) * scale } : { weight, mark: weight / unit(key), fixWeight: weight };
  }
  return attrs;
}

/** 按 fixWeight 从高到低取前 n 个词条。 */
function topKeys(attrs, keys, n, ban) {
  return keys.filter(k => k !== ban && attrs[k]).sort((a, b) => attrs[b].fixWeight - attrs[a].fixWeight).slice(0, n);
}

/** 指定主词条下该部位的裸分上限：主词条计 2 倍（花、羽不计），最优副词条计 6 倍，其余三条各 1 倍。 */
function slotMax(attrs, mainKey, countMain = true) {
  return (countMain ? attrs[mainKey]?.fixWeight || 0 : 0) * 2 + topKeys(attrs, SUB_KEYS, 4, mainKey).reduce((n, k, i) => n + attrs[k].fixWeight * (i ? 1 : 6), 0);
}

/** 参考分，0 至 66 为常规范围；未知角色返回 null，未激活词条不计入。 */
export function referenceScore(a, character) {
  const weights = characterWeights(character.name);
  if (!weights) return null;
  const info = miao.characters[character.name] || {};
  const attrs = markTable(weights, info.baseAttr || undefined);
  const pos = a.slot + 1;
  let score = 0, fixPct = 1, max;
  if (pos < 3) max = slotMax(attrs, pos === 1 ? 'hpPlus' : 'atkPlus', false);
  else {
    const elem = character.options?.elem || info.elem || '';
    const mainKey = pos === 4 && a.main.key === elem ? 'dmg' : a.main.key;
    const bestMain = topKeys(attrs, MAIN_OPTIONS[pos], 1)[0];
    const bestMainWeight = bestMain ? attrs[bestMain].fixWeight : 0;
    // 主词条与角色需求不符时按比例折减。
    if (mainKey !== 'recharge') {
      fixPct = bestMainWeight > 0 ? Math.max(0, Math.min(1, (attrs[mainKey]?.weight || 0) / bestMainWeight)) : 1;
      if (['atk', 'hp', 'def'].includes(mainKey) && attrs[mainKey]?.weight >= 75) fixPct = 1;
    }
    score += (attrs[mainKey]?.mark || 0) * a.main.value / 4;
    max = Math.max(slotMax(attrs, bestMain || MAIN_OPTIONS[pos][0]), slotMax(attrs, mainKey));
  }
  for (const s of a.subs) if (s.active) score += (attrs[s.key]?.mark || 0) * s.value;
  return max > 0 ? Math.round(Math.min(score * (1 + fixPct) / 2 / max * 66, 70) * 10) / 10 : 0;
}

/** 仅在每个有效属性均不差时判断支配，避免把充能与双暴简单相抵。 */
export function dominates(replacement, item, weights) {
  const value = (a, key) => a.subs.filter(s => s.active && s.key === key).reduce((n, s) => n + s.value, 0);
  return Object.keys(MAX_ROLL).filter(k => (weights[k] || 0) > 0).every(k => value(replacement, k) + 1e-9 >= value(item, k));
}
