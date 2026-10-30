import { normalizeSnapshot, MAIN_KEYS } from './model.js';
import { characterWeights, weightsFor, potential, referenceScore, dominates } from './scoring.js';

/** 验证配置；错误配置不能产生清理建议。 */
export function validateConfig(config) {
  if (!config || !Array.isArray(config.characters)) throw new Error('配置需要 characters 数组。');
  const names = new Set();
  for (const c of config.characters) {
    if (!c.name || names.has(c.name) || !['main', 'reserve'].includes(c.priority)) throw new Error('角色名称重复或优先级无效。');
    names.add(c.name);
    const builds = config.rules?.[c.name] || [];
    if (!Array.isArray(builds)) throw new Error('角色玩法规则需要数组。');
    for (const b of builds) {
      if (!Array.isArray(b.sets) || !b.sets.length || b.sets.some(s => typeof s !== 'string' || !s) || !b.mainStats) throw new Error('玩法规则需要 sets 和 mainStats。');
      for (let slot = 0; slot < 5; slot++) if (!Array.isArray(b.mainStats[slot]) || !b.mainStats[slot].length || b.mainStats[slot].some(k => !MAIN_KEYS[slot].includes(k))) throw new Error('玩法必须正确覆盖五个部位；不完整规则不能用于清理。');
      if (b.weights && Object.values(b.weights).some(v => !Number.isFinite(v) || v < 0 || v > 100)) throw new Error('词条权重须在 0 至 100 之间。');
    }
  }
  const target = config.targetFreeSlots ?? 0;
  const quota = config.reservePerCharacter ?? 2;
  if (!Number.isInteger(target) || target < 0 || !Number.isInteger(quota) || quota < 1 || quota > 20) throw new Error('空位目标或保留数量无效。');
  if (config.protectedIds !== undefined && (!Array.isArray(config.protectedIds) || config.protectedIds.some(id => typeof id !== 'string'))) throw new Error('protectedIds 需要物品编号数组。');
}

/** 主力排在备用之前的排序值。 */
const rank = priority => (priority === 'main' ? 0 : 1);

/** 某件对指定角色（缺省为任一角色）的最高指标。 */
const best = (r, field, name) => Math.max(0, ...r.internalMatches.filter(m => !name || m.character === name).map(m => m[field]));

/** 单件对某角色玩法的适配，套外件只提供散件参考。 */
function matches(a, c, b) {
  if (!b.mainStats[a.slot]?.includes(a.main?.key)) return null;
  const weights = weightsFor(b, c);
  return { character: c.name, priority: c.priority, build: b.id || '默认玩法', inSet: b.sets.includes(a.set), weights, ...potential(a, weights), referenceScore: referenceScore(a, c), source: b.source || '', version: b.version || '' };
}

/** 生成解释、保留项和强化队列。报告没有可驱动游戏操作的执行清单。 */
export function analyze(input, config) {
  validateConfig(config);
  const quota = config.reservePerCharacter ?? 2;
  const target = config.targetFreeSlots ?? 0;
  const snapshot = normalizeSnapshot(input);
  const blockers = [];
  if (snapshot.scan.complete !== true || snapshot.scan.verified !== true) blockers.push('扫描尚未人工核对完整性');
  blockers.push(...snapshot.scan.issues);
  if (config.rosterConfirmed !== true || !config.characters.length) blockers.push('持有角色与玩法范围尚未确认');
  const missing = config.characters.filter(c => !characterWeights(c.name) || !config.rules?.[c.name]?.length || config.rules[c.name].some(b => b.reviewed !== true || !b.source || !b.version)).map(c => c.name);
  if (missing.length) blockers.push(`规则未核对或缺失：${missing.join('、')}`);
  if (snapshot.artifacts.some(a => a.issues.length)) blockers.push('存在识别不确定项，清理建议暂时关闭');
  const protectedIds = new Set(config.protectedIds || []);
  const records = snapshot.artifacts.map(a => {
    const applicable = a.issues.length ? [] : config.characters.flatMap(c => (config.rules?.[c.name] || []).map(b => matches(a, c, b)).filter(Boolean));
    const r = { artifact: a, category: 'review', reasons: [], matches: applicable.map(({ weights, ...m }) => m), replacements: [], upgrade: null };
    if (a.locked === true || a.equippedBy || protectedIds.has(a.id)) {
      r.category = 'keep';
      r.reasons.push(a.locked ? '已锁定' : a.equippedBy ? `正在由 ${a.equippedBy} 穿戴` : '用户保护');
    } else if (a.issues.length) r.reasons.push(...a.issues);
    else if (a.rarity < 5) { r.category = 'keep'; r.reasons.push('低星过渡装备，首版不自动给出去留结论'); }
    else if (['mastery', 'recharge', 'heal', 'pyro', 'hydro', 'cryo', 'electro', 'anemo', 'geo', 'dendro', 'phy'].includes(a.main.key)) { r.category = 'keep'; r.reasons.push('保守保护稀缺或功能主词条'); }
    else if (applicable.some(m => !m.inSet && m.current >= 4)) { r.category = 'keep'; r.reasons.push('保留有价值的套外散件'); }
    return { ...r, internalMatches: applicable };
  });

  // 按同套装、部位、主词条建立用途池，每个角色分别预留数量，避免多角色共用一份保留额度。
  const groups = new Map();
  for (const r of records) {
    const a = r.artifact;
    if (a.issues.length || a.rarity !== 5) continue;
    const key = JSON.stringify([a.set, a.slot, a.main.key]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  for (const group of groups.values()) {
    const names = [...new Set(group.flatMap(r => r.internalMatches.map(m => m.character)))];
    const needed = names.length * quota;
    if (!needed) continue;
    const pool = group.filter(r => r.artifact.equippedBy === '');
    const maxed = pool.filter(r => r.artifact.level === 20).sort((a, b) => best(b, 'current') - best(a, 'current'));
    const reserves = new Set();
    // 同一组内分配互不重叠的保留额度；不同组只是候选保留，不声称完成最终配装。
    for (const c of config.characters.toSorted((a, b) => rank(a.priority) - rank(b.priority))) {
      if (!names.includes(c.name)) continue;
      const candidates = pool.filter(r => !reserves.has(r) && r.internalMatches.some(m => m.character === c.name)).sort((a, b) => best(b, 'ceiling', c.name) - best(a, 'ceiling', c.name));
      candidates.slice(0, quota).forEach(r => { reserves.add(r); r.category = 'keep'; r.reasons.push(`为${c.priority === 'main' ? '主力' : '备用'} ${c.name} 预留候选`); });
    }
    // 首批满级替代件永久保留，不允许清理建议互相引用而使整组消失。
    const replacements = maxed.slice(0, needed);
    replacements.forEach(r => { r.category = 'keep'; r.reasons.push('保留为冗余判断的满级替代件'); });
    for (const r of group) {
      // 存在阻断项时不产生任何清理建议。
      const uses = r.internalMatches;
      if (blockers.length || r.category === 'keep' || !uses.length) continue;
      const better = replacements.filter(other => other !== r && uses.every(m => {
        // 未满级且仍能获得任一有效属性时不按当前低分淘汰。
        if (r.artifact.level < 20 && m.ceiling > m.current + 1e-9) return false;
        return dominates(other.artifact, r.artifact, m.weights);
      }));
      if (better.length >= needed) {
        r.category = 'cleanup'; r.replacements = better.map(o => o.artifact.id);
        r.reasons.push(`同套装、部位、主词条已有 ${better.length} 件保留的满级替代件，各已配置用途的有效属性均不差，保留额度为 ${needed}`);
      }
    }
  }

  // 强化建议与清理判断分开：所有有潜力件先保留，满级件不进入强化队列。
  for (const r of records) {
    const a = r.artifact;
    if (a.issues.length || a.rarity !== 5 || a.level >= 20 || r.category === 'cleanup') continue;
    const best = r.internalMatches.filter(m => m.inSet && m.ceiling > m.current).sort((x, y) => rank(x.priority) - rank(y.priority) || y.ceiling - x.ceiling)[0];
    if (best) {
      if (!a.locked && !a.equippedBy && !protectedIds.has(a.id)) r.category = 'upgrade';
      r.upgrade = { character: best.character, priority: best.priority, nextLevel: best.nextLevel, currentMerit: best.current, optimisticCeiling: best.ceiling, continueIf: '下一检查点复扫；仅在有效属性改善、仍有升级潜力或该角色缺装备时继续。', stopIf: '停止投入后先保留；按新快照重新评估，不自动作为材料。' };
      r.reasons.push(`可为 ${best.character} 试强化至 +${best.nextLevel}；潜力上限不是成功概率`);
    } else if (!r.reasons.length) r.reasons.push('没有足够依据清理；检查未覆盖玩法、散件价值与强化潜力');
  }
  const output = records.map(({ internalMatches, ...r }) => r);
  const counts = { keep: 0, upgrade: 0, cleanup: 0, review: 0 };
  output.forEach(r => counts[r.category]++);
  const currentFree = Number.isInteger(snapshot.scan.capacity) ? snapshot.scan.capacity - snapshot.scan.total : null;
  const upgradeQueue = output.filter(r => r.upgrade).sort((a, b) => rank(a.upgrade.priority) - rank(b.upgrade.priority) || b.upgrade.optimisticCeiling - a.upgrade.optimisticCeiling).map(r => r.artifact.id);
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), demo: config.demo === true, scan: snapshot.scan, blockers: [...new Set(blockers)], missingRules: missing, counts, currentFree, projectedFree: currentFree === null ? null : currentFree + counts.cleanup, targetFreeSlots: target, targetGap: Math.max(0, target - (currentFree ?? 0) - counts.cleanup), upgradeQueue, records: output, notice: '仅为本次角色与规则范围内的建议。没有执行清理或强化，也未完成全局配装搜索。' };
}
