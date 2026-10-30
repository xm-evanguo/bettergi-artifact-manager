import { coreSubStats } from './scoring.js';

/** 强化检查点：+4、+8、+12 各一次副词条强化，用于判断是否歪掉。 */
export const CHECK_LEVELS = [4, 8, 12];

/** 最多容忍的歪掉次数；达到第二次即停止并标记分解。 */
export const MAX_MISSES = 1;

/**
 * 某套配装的核心副词条：配装写了 coreSubStats 就用它；
 * 第一套配装未写时取 miao 权重为 100 的副词条。
 */
export function coreFor(character, index = 0) {
  const build = character.builds[index];
  const core = build?.coreSubStats || (index === 0 ? coreSubStats(character.name) : null);
  if (!core?.length) throw new Error(`${character.name} 第 ${index + 1} 套配装缺少核心副词条。`);
  return core;
}

/** 圣遗物是否带有任一核心副词条（含待激活词条）。 */
export function hasCore(artifact, core) {
  return artifact.subs.some(s => core.includes(s.key));
}

/** 比较一次强化前后的副词条，返回本次强化落在哪个词条；无法判断时返回 null。 */
export function rolledKey(before, after) {
  const prev = new Map(before.subs.map(s => [s.key, s]));
  const changed = after.subs.filter(s => {
    const p = prev.get(s.key);
    // 新出现的词条、待激活词条被激活、或数值上升，都算本次强化的落点。
    return !p || (s.active && !p.active) || s.value > p.value + 1e-6;
  });
  return changed.length === 1 ? changed[0].key : null;
}

/**
 * 根据当前状态决定下一步。
 * state: { level, misses, artifact, core }
 * 返回 continue（继续强化）、discard（停止并分解）、done（已满级）。
 */
export function nextAction({ level, misses, artifact, core }) {
  if (!hasCore(artifact, core)) return 'discard';
  if (misses > MAX_MISSES) return 'discard';
  return level >= 20 ? 'done' : 'continue';
}

/**
 * 记录一次强化结果并返回新状态。
 * 只在 +12 及以前的检查点计算歪掉次数；+12 时歪掉不超过一次就继续强化到 +20。
 */
export function recordRoll(state, after, newLevel) {
  const key = rolledKey(state.artifact, after);
  if (key === null) throw new Error('无法确定本次强化落在哪个副词条，停止强化。');
  const counted = CHECK_LEVELS.includes(newLevel);
  const miss = counted && !state.core.includes(key);
  const next = { ...state, level: newLevel, artifact: after, misses: state.misses + (miss ? 1 : 0), rolls: [...(state.rolls || []), { level: newLevel, key, miss }] };
  return { ...next, action: nextAction(next) };
}
