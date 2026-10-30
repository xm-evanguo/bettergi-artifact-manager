import { normalizeSnapshot, SLOT_NAMES } from './model.js';
import { referenceScore, grade, gradeMin } from './scoring.js';
import { coreFor, hasCore } from './upgrade.js';
import { buildSalvageFilter } from './salvage-filter.js';

/** builds.json 中沙、杯、头对应的部位编号。 */
const MAIN_SLOT = { 2: 'sands', 3: 'goblet', 4: 'circlet' };

/** 每个未毕业部位最多保留的强化候选数。 */
const UPGRADE_PER_SLOT = 2;

/** 圣遗物主词条是否符合某套配装；花和羽主词条固定，总是符合。 */
function mainFits(a, build) {
  return a.slot < 2 || build.mainStats[MAIN_SLOT[a.slot]].includes(a.main.key);
}

/**
 * 为单个角色从可用池里选一套：在推荐套装中挑一套凑 4 件，另一个部位放分数最高的任意件。
 * 凑不齐 4 件时按分数逐部位挑选，并标记为未成套。
 */
function bestLoadout(character, build, pool) {
  const score = a => referenceScore(a, character) ?? 0;
  const fits = pool.filter(a => mainFits(a, build));
  const bestOf = list => list.reduce((x, a) => (!x || score(a) > score(x) ? a : x), null);
  const anyBest = [0, 1, 2, 3, 4].map(slot => bestOf(fits.filter(a => a.slot === slot)));
  let best = null;
  for (const set of build.sets) {
    const inSet = [0, 1, 2, 3, 4].map(slot => bestOf(fits.filter(a => a.slot === slot && a.set === set)));
    if (inSet.filter(Boolean).length < 4) continue;
    // 散件部位选「任意最佳件 - 套内最佳件」差值最大的部位；缺一件套内件时散件只能放在缺口上。
    const missing = inSet.findIndex(a => !a);
    const offSlots = missing >= 0 ? [missing] : [0, 1, 2, 3, 4];
    for (const off of offSlots) {
      if (!anyBest[off]) continue;
      const pieces = inSet.map((a, slot) => (slot === off ? anyBest[off] : a));
      const total = pieces.reduce((n, a) => n + score(a), 0);
      if (!best || total > best.total) best = { set, pieces, total, complete: true };
    }
  }
  if (best) return best;
  return { set: null, pieces: anyBest, total: anyBest.reduce((n, a) => n + (a ? score(a) : 0), 0), complete: false };
}

/**
 * 从完整库存生成计划：每个角色一套最优配装、强化候选和分解清单。
 * 角色按等级从高到低依次挑选，能凑齐推荐 4 件套的角色先分配，同一件只分给一个角色。
 * 扫描未完整核对或存在识别不确定项时，原本要分解的件改为待复查。
 */
export function buildPlan(input, buildsDoc) {
  const snapshot = normalizeSnapshot(input);
  const threshold = gradeMin(buildsDoc.graduateGrade || 'SSS');
  const blockers = [...snapshot.scan.issues];
  if (snapshot.scan.complete !== true) blockers.push('扫描未确认完整，不生成分解清单');
  const characters = buildsDoc.characters.filter(c => c.builds.length).toSorted((a, b) => (b.level || 0) - (a.level || 0));
  const usable = snapshot.artifacts.filter(a => !a.issues.length && a.rarity === 5);
  const taken = new Map();
  const loadouts = [];

  // 第一轮只分配能凑齐推荐 4 件套的角色；第二轮再让凑不齐的角色从剩余件中逐部位挑选，
  // 避免高等级角色因凑不齐自身套装而拿走其他角色的整套。
  const assign = (c, lo) => {
    const slots = lo.pieces.map((a, slot) => {
      if (!a) return { slot, id: null, score: 0, grade: null, graduated: false };
      const s = referenceScore(a, c) ?? 0;
      taken.set(a.id, { character: c.name, slot });
      return { slot, id: a.id, score: s, grade: grade(s), graduated: s >= threshold };
    });
    loadouts.push({ name: c.name, level: c.level, set: lo.set, complete: lo.complete, slots });
  };
  for (const round of [true, false]) {
    for (const c of characters) {
      if (loadouts.some(lo => lo.name === c.name)) continue;
      const lo = bestLoadout(c, c.builds[0], usable.filter(a => !taken.has(a.id)));
      if (lo.complete === round) assign(c, lo);
    }
  }
  loadouts.sort((a, b) => characters.indexOf(characters.find(c => c.name === a.name)) - characters.indexOf(characters.find(c => c.name === b.name)));

  // 未毕业部位：从未分配件中选推荐套装内、主词条符合、带核心副词条、未满级的件作为强化候选。
  const upgrades = new Map();
  for (const lo of loadouts) {
    const c = characters.find(x => x.name === lo.name);
    const core = coreFor(c, 0);
    for (const s of lo.slots.filter(x => !x.graduated)) {
      const candidates = usable
        .filter(a => a.slot === s.slot && a.level < 20 && !taken.has(a.id) && !upgrades.has(a.id))
        .filter(a => c.builds[0].sets.includes(a.set) && mainFits(a, c.builds[0]) && hasCore(a, core))
        .toSorted((x, y) => (referenceScore(y, c) ?? 0) - (referenceScore(x, c) ?? 0))
        .slice(0, UPGRADE_PER_SLOT);
      for (const a of candidates) upgrades.set(a.id, { character: c.name, slot: s.slot, core, current: s.id });
    }
  }

  const records = snapshot.artifacts.map(a => {
    const base = { id: a.id, name: a.name, set: a.set, slot: a.slot, level: a.level, rarity: a.rarity, locked: a.locked, equippedBy: a.equippedBy };
    if (a.issues.length) return { ...base, category: 'review', reasons: a.issues };
    if (a.rarity !== 5) return { ...base, category: 'fodder', reasons: ['非五星，作强化材料'] };
    if (taken.has(a.id)) {
      const t = taken.get(a.id);
      const s = referenceScore(a, { name: t.character }) ?? 0;
      return { ...base, category: 'keep', character: t.character, score: s, grade: grade(s), reasons: [`${t.character} 的${SLOT_NAMES[t.slot]}`] };
    }
    if (upgrades.has(a.id)) {
      const u = upgrades.get(a.id);
      return { ...base, category: 'upgrade', character: u.character, core: u.core, reasons: [`${u.character} 的${SLOT_NAMES[u.slot]}未毕业，可试强化`] };
    }
    if (blockers.length) return { ...base, category: 'review', reasons: ['本应分解，但扫描未确认完整', ...blockers] };
    const notes = [];
    if (a.locked) notes.push('已锁定，需先解锁');
    if (a.equippedBy) notes.push(`${a.equippedBy} 正在穿戴，需先卸下`);
    return { ...base, category: 'discard', reasons: ['没有角色需要，或对应部位已毕业', ...notes] };
  });

  const discards = snapshot.artifacts.filter(a => records.find(r => r.id === a.id).category === 'discard');
  const salvage = discards.length ? buildSalvageFilter(discards, snapshot.artifacts) : { js: '', skipped: [] };
  const counts = { keep: 0, upgrade: 0, discard: 0, review: 0, fodder: 0 };
  records.forEach(r => counts[r.category]++);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    graduateGrade: buildsDoc.graduateGrade || 'SSS',
    graduateScore: threshold,
    blockers,
    counts,
    loadouts,
    records,
    salvage: { js: salvage.js, skipped: salvage.skipped.map(a => a.id) },
  };
}
