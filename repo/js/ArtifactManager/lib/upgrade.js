import { coreSubStats } from './scoring.js';

/** 强化检查点：+4、+8、+12 各一次副词条强化，用于判断是否歪掉。 */
export const CHECK_LEVELS = [4, 8, 12];

/** 最多容忍的歪掉次数；达到第二次即停止并标记分解。 */
export const MAX_MISSES = 1;

/**
 * 某套配装的核心副词条：配装写了 coreSubStats 就用它；
 * 未写时取 miao 权重为 100 的副词条。
 */
export function coreFor(character, index = 0) {
  const build = character.builds[index];
  const core = build?.coreSubStats || coreSubStats(character.name);
  if (!core?.length) throw new Error(`${character.name} 第 ${index + 1} 套配装缺少核心副词条。`);
  return core;
}

/** 圣遗物是否带有任一核心副词条（含待激活词条）。 */
export function hasCore(artifact, core) {
  return artifact.subs.some(s => core.includes(s.key));
}

/** 强化前后是否仍是同一件：名称、套装、部位、主词条一致，原有副词条全部保留且数值不降，最多新增一条。 */
function sameArtifact(before, after) {
  if (before.name !== after.name || before.set !== after.set || before.slot !== after.slot || before.main?.key !== after.main?.key) return false;
  const next = new Map(after.subs.map(s => [s.key, s]));
  if (after.subs.length - before.subs.length > 1 || after.subs.length < before.subs.length) return false;
  return before.subs.every(s => next.has(s.key) && next.get(s.key).value + 1e-6 >= s.value);
}

/** 比较一次强化前后的副词条，返回本次强化落在哪个词条；不是同一件或无法判断时返回 null。 */
export function rolledKey(before, after) {
  if (!sameArtifact(before, after)) return null;
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
 * 返回 continue（继续强化）、stop（停止强化，交回第 ② 步重新判断去留）、done（已满级）。
 * 停止强化不等于立即分解：这件可能仍是其他角色的候选，由完整库存分析决定是否进入分解清单。
 */
export function nextAction({ level, misses, artifact, core }) {
  if (!hasCore(artifact, core)) return 'stop';
  if (misses > MAX_MISSES) return 'stop';
  return level >= 20 ? 'done' : 'continue';
}

/**
 * 记录一次强化结果并返回新状态。
 * 每跨过一个 4 的倍数等级就有一次副词条强化；一次跨过多个时无法分别还原落点，停止判断。
 * 只在 +12 及以前的检查点计算歪掉次数；+12 时歪掉不超过一次就继续强化到 +20。
 */
export function recordRoll(state, after, newLevel) {
  const crossed = [4, 8, 12, 16, 20].filter(l => l > state.level && l <= newLevel);
  if (crossed.length !== 1) throw new Error(`本次强化从 +${state.level} 到 +${newLevel}，跨过 ${crossed.length} 个强化点，无法逐次判断，停止强化。`);
  const key = rolledKey(state.artifact, after);
  if (key === null) throw new Error('强化后不是同一件，或无法确定本次强化落在哪个副词条，停止强化。');
  const counted = CHECK_LEVELS.includes(crossed[0]);
  const miss = counted && !state.core.includes(key);
  const next = { ...state, level: newLevel, artifact: after, misses: state.misses + (miss ? 1 : 0), rolls: [...(state.rolls || []), { level: crossed[0], key, miss }] };
  return { ...next, action: nextAction(next) };
}
