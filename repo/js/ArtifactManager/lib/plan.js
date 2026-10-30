import { normalizeSnapshot, SLOT_NAMES, MAX_ROLL } from './model.js';
import { mainAtMax } from './ocr.js';
import { referenceScore, grade, gradeMin, potential, weightsFor, buildWeights } from './scoring.js';
import { coreFor, coreForPiece, hasCore, estimateMisses, MAX_MISSES } from './upgrade.js';
import { buildSalvageFilter } from './salvage-filter.js';

/** builds.json 中沙、杯、头对应的部位编号。 */
const MAIN_SLOT = { 2: 'sands', 3: 'goblet', 4: 'circlet' };

/** 最高只有四星的套装；五星套装的四星版本仍作材料。 */
const FOUR_STAR_SETS = ['教官', '流放者', '学士', '赌徒', '奇迹', '勇士之心', '守护之心', '行者之心', '武人', '冒险家', '幸运儿', '游医'];

/** 实机扫描中核实过的套装名 OCR 错字。 */
const SET_ALIASES = { 炽城勇者绘卷: '烬城勇者绘卷', 炉火融炼之心: '炉火熔炼之心' };

/** 各星级满级。 */
const MAX_LEVEL = { 5: 20, 4: 16 };

/** 每个未毕业部位最多保留的强化候选数。 */
const UPGRADE_PER_SLOT = 2;

/**
 * 强化到满级的期望面板，只用于刷取排序，不是实际强化结果：
 * - 主词条取满级数值；
 * - 剩余强化次数先激活第四词条，其余每次按平均档位（单次最大值的 0.85 倍）平均落到 4 条副词条上；
 * - 四星副词条档位约为五星的 0.8 倍；
 * - 三词条且第四词条未知时，按所有可能词条均摊该词条的期望值。
 */
export function expectedFinal(a) {
  const max = MAX_LEVEL[a.rarity];
  if (!max || a.level >= max) return a;
  const avg = k => 0.85 * MAX_ROLL[k] * (a.rarity === 4 ? 0.8 : 1);
  let rolls = max / 4 - Math.floor(a.level / 4);
  const subs = a.subs.map(s => ({ ...s }));
  let unknown = false;
  if (subs.filter(s => s.active).length < 4) {
    const pending = subs.find(s => !s.active);
    if (pending) pending.active = true;
    else unknown = true;
    rolls--;
  }
  const share = rolls / 4;
  for (const s of subs.filter(x => x.active)) s.value += share * avg(s.key);
  if (unknown) {
    const keys = Object.keys(MAX_ROLL).filter(k => k !== a.main.key && !subs.some(s => s.key === k));
    for (const k of keys) subs.push({ key: k, value: (1 + share) * avg(k) / keys.length, active: true });
  }
  return { ...a, level: max, main: { ...a.main, value: mainAtMax(a.main.key, a.rarity) ?? a.main.value }, subs };
}

/** 圣遗物主词条是否符合某套配装；花和羽主词条固定，总是符合。 */
function mainFits(a, build) {
  return a.slot < 2 || build.mainStats[MAIN_SLOT[a.slot]].includes(a.main.key);
}

/**
 * 为单个角色从可用池里选一套：在推荐套装中挑一套凑 4 件，另一个部位放分数最高的任意件。
 * 凑不齐 4 件时按分数逐部位挑选，并标记为未成套。
 */
function bestLoadout(character, build, pool) {
  const weights = buildWeights(character, build);
  const score = a => referenceScore(a, character, weights) ?? 0;
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
  // 背包面板读不出锁定状态；锁定件游戏本身不允许分解，所以锁定未知不阻止计算。
  for (const a of snapshot.artifacts) a.issues = a.issues.filter(x => x !== '锁定状态未知');
  const threshold = gradeMin(buildsDoc.graduateGrade || 'SSS');
  const blockers = [...snapshot.scan.issues];
  if (snapshot.scan.complete !== true) blockers.push('扫描未确认完整，不生成分解清单');
  const characters = (Array.isArray(buildsDoc?.characters) ? buildsDoc.characters : []).filter(c => Array.isArray(c.builds) && c.builds.length).toSorted((a, b) => (b.level || 0) - (a.level || 0));
  // 没有任何有效配装时，所有五星都会落入分解，必须关闭分解清单。
  if (!characters.length) blockers.push('配装数据没有任何角色或玩法，不生成分解清单');
  // OCR 读错套装名：已核实的错字直接纠正；其余与推荐套装只差一个字的不猜测，转为待复查，
  // 因为它也可能是另一个真实套装。
  const knownSets = [...new Set(characters.flatMap(c => c.builds.flatMap(b => b.sets)))];
  for (const a of snapshot.artifacts) {
    if (SET_ALIASES[a.set]) a.set = SET_ALIASES[a.set];
    if (!a.set || knownSets.includes(a.set)) continue;
    if (knownSets.some(k => k.length === a.set.length && [...k].filter((ch, i) => ch !== a.set[i]).length === 1)) a.issues.push('套装名可能识别有误');
  }
  // 可分配：全部五星，以及配装点名、且最高只有四星的套装（如教官）；其余作强化材料。
  const wantedSets = new Set(characters.flatMap(c => c.builds.flatMap(b => b.sets)).filter(s => FOUR_STAR_SETS.includes(s)));
  const usable = snapshot.artifacts.filter(a => !a.issues.length && (a.rarity === 5 || (a.rarity === 4 && wantedSets.has(a.set))));
  const taken = new Map();
  const loadouts = [];

  // 第一轮只分配能凑齐推荐 4 件套的角色；第二轮再让凑不齐的角色从剩余件中逐部位挑选，
  // 避免高等级角色因凑不齐自身套装而拿走其他角色的整套。
  const assign = (c, lo) => {
    const weights = buildWeights(c, c.builds[lo.build]);
    const slots = lo.pieces.map((a, slot) => {
      if (!a) return { slot, id: null, score: 0, grade: null, graduated: false };
      const s = referenceScore(a, c, weights) ?? 0;
      taken.set(a.id, { character: c.name, slot, score: s });
      return { slot, id: a.id, score: s, grade: grade(s), graduated: s >= threshold };
    });
    loadouts.push({ name: c.name, level: c.level, build: lo.build, set: lo.set, complete: lo.complete, slots });
  };
  for (const round of [true, false]) {
    for (const c of characters) {
      if (loadouts.some(lo => lo.name === c.name)) continue;
      // 多套玩法时选总分最高的一套；每个角色只保留一套。
      const pool = usable.filter(a => !taken.has(a.id));
      const options = c.builds.map((b, index) => ({ ...bestLoadout(c, b, pool), build: index }));
      const lo = options.filter(o => o.complete === round).reduce((x, o) => (!x || o.total > x.total ? o : x), null);
      if (lo) assign(c, lo);
    }
  }
  loadouts.sort((a, b) => characters.indexOf(characters.find(c => c.name === a.name)) - characters.indexOf(characters.find(c => c.name === b.name)));

  // 未毕业部位：从未分配件中选主词条符合、带核心副词条、未满级的件作为强化候选。
  // 套装须在推荐内；四件套之外的那个散件部位不限套装，五件同套时任一部位都可作散件位。
  // 已选用但未满级的件也列入强化。
  const upgrades = new Map();
  for (const lo of loadouts) {
    const c = characters.find(x => x.name === lo.name);
    const build = c.builds[lo.build];
    const core = coreFor(c, lo.build);
    const weights = weightsFor(build, c);
    const offSlot = lo.complete ? lo.slots.find(x => x.id && usable.find(a => a.id === x.id).set !== lo.set)?.slot : undefined;
    const offOk = slot => lo.complete && (offSlot === undefined || slot === offSlot);
    // 带核心副词条，且按当前数值估算已歪不超过上限（已到 +8、+12 的件可能已经歪了两次）。
    const fitsCore = a => { const k = coreForPiece(core, a, build); return hasCore(a, k) && estimateMisses(a, k) <= MAX_MISSES; };
    for (const s of lo.slots) {
      // 已选用件未满级时继续强化：已毕业的也要升满主词条；未毕业的须带核心副词条，否则强化规则会立即停止。
      const current = s.id && usable.find(a => a.id === s.id);
      if (current && current.level < MAX_LEVEL[current.rarity] && (s.graduated || fitsCore(current))) upgrades.set(current.id, { character: c.name, slot: s.slot, core: coreForPiece(core, current, build), current: s.id });
    }
    for (const s of lo.slots.filter(x => !x.graduated)) {
      // 未满级件按强化潜力上限排序，不按当前分数，避免 +0 件因当前分低被淘汰。
      const candidates = usable
        .filter(a => a.slot === s.slot && a.level < MAX_LEVEL[a.rarity] && !taken.has(a.id) && !upgrades.has(a.id))
        .filter(a => (offOk(s.slot) || build.sets.includes(a.set)) && mainFits(a, build) && fitsCore(a))
        .toSorted((x, y) => potential(y, weights).ceiling - potential(x, weights).ceiling)
        .slice(0, UPGRADE_PER_SLOT);
      for (const a of candidates) upgrades.set(a.id, { character: c.name, slot: s.slot, core: coreForPiece(core, a, build), current: s.id });
    }
  }

  // 刷取优先级：每个部位的选项为当前件（当前分）与强化候选件（满级期望分）。
  // 对配装的每个可选套装，在能凑成 4 件该套装 + 1 件任意散件的组合中取总分最高者；
  // 都凑不成时逐部位取最高分并标记未成套。按角色总分从低到高排序，分数低的最需要继续刷。
  const farming = loadouts.map(lo => {
    const c = characters.find(x => x.name === lo.name);
    const build = c.builds[lo.build];
    const weights = buildWeights(c, build);
    const options = lo.slots.map(s => {
      const current = s.id ? [{ set: usable.find(a => a.id === s.id).set, score: s.score }] : [];
      const pieces = [...upgrades].filter(([id, u]) => u.character === c.name && u.slot === s.slot && id !== s.id).map(([id]) => usable.find(a => a.id === id));
      return [...current, ...pieces.map(a => ({ set: a.set, score: referenceScore(expectedFinal(a), c, weights) ?? 0 }))];
    });
    const bestAny = options.map(o => Math.max(0, ...o.map(x => x.score)));
    let best = null;
    for (const set of build.sets) {
      const inSet = options.map(o => Math.max(-Infinity, ...o.filter(x => x.set === set).map(x => x.score)));
      for (let off = 0; off < 5; off++) {
        if (inSet.some((v, i) => i !== off && v === -Infinity)) continue;
        const picks = inSet.map((v, i) => (i === off ? bestAny[i] : v));
        const total = picks.reduce((n, v) => n + v, 0);
        if (!best || total > best.total) best = { set, picks, total };
      }
    }
    const picks = best ? best.picks : bestAny;
    const slots = lo.slots.map((s, i) => ({ slot: s.slot, now: s.score, projected: Math.round(picks[i] * 10) / 10, graduated: picks[i] >= threshold }));
    return { name: lo.name, set: best ? best.set : lo.set || build.sets[0], complete: !!best, now: Math.round(lo.slots.reduce((n, s) => n + s.score, 0) * 10) / 10, total: Math.round(picks.reduce((n, v) => n + v, 0) * 10) / 10, slots };
  }).sort((x, y) => x.total - y.total);

  const records = snapshot.artifacts.map(a => {
    const base = { id: a.id, name: a.name, set: a.set, slot: a.slot, level: a.level, rarity: a.rarity, main: a.main, subs: a.subs, location: a.location, locked: a.locked, equippedBy: a.equippedBy };
    if (a.issues.length) return { ...base, category: 'review', reasons: a.issues };
    if (!usable.includes(a)) {
      // 当作材料同样不可逆；存在 blocker 时改为待复查。
      if (blockers.length) return { ...base, category: 'review', reasons: ['本应作材料，但计划被关闭', ...blockers] };
      return { ...base, category: 'fodder', reasons: ['非五星，且不是配装需要的四星套装，作强化材料'] };
    }
    if (taken.has(a.id) && upgrades.has(a.id)) {
      const t = taken.get(a.id);
      return { ...base, category: 'upgrade', character: t.character, score: t.score, grade: grade(t.score), core: upgrades.get(a.id).core, reasons: [`${t.character} 的${SLOT_NAMES[t.slot]}，已选用但未满级，继续强化`] };
    }
    if (taken.has(a.id)) {
      const t = taken.get(a.id);
      return { ...base, category: 'keep', character: t.character, score: t.score, grade: grade(t.score), reasons: [`${t.character} 的${SLOT_NAMES[t.slot]}`] };
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
  // 没有分解项时也输出只返回 false 的筛选脚本，覆盖上一次的旧脚本。
  const salvage = discards.length ? buildSalvageFilter(discards, snapshot.artifacts) : { js: 'Output=false;', skipped: [] };
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
    farming,
    records,
    salvage: { js: salvage.js, skipped: salvage.skipped.map(a => a.id) },
  };
}
