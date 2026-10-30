/** 游戏词条与导入数据共用的标准键。百分比以 46.6 表示 46.6%。 */
export const SLOT_NAMES = ['生之花', '死之羽', '时之沙', '空之杯', '理之冠'];
export const MAX_ROLL = { hpPlus: 298.75, atkPlus: 19.45, defPlus: 23.15, hp: 5.83, atk: 5.83, def: 7.29, mastery: 23.31, recharge: 6.48, cpct: 3.89, cdmg: 7.77 };
const MAX_MAIN = { hpPlus: 4780, atkPlus: 311, hp: 46.6, atk: 46.6, def: 58.3, mastery: 187, recharge: 51.8, cpct: 31.1, cdmg: 62.2, heal: 35.9, pyro: 46.6, hydro: 46.6, cryo: 46.6, electro: 46.6, anemo: 46.6, geo: 46.6, dendro: 46.6, phy: 58.3 };
export const MAIN_KEYS = [
  ['hpPlus'], ['atkPlus'], ['hp', 'atk', 'def', 'mastery', 'recharge'],
  ['hp', 'atk', 'def', 'mastery', 'pyro', 'hydro', 'cryo', 'electro', 'anemo', 'geo', 'dendro', 'phy'],
  ['hp', 'atk', 'def', 'mastery', 'cpct', 'cdmg', 'heal'],
];
const ALIASES = { '暴击率': 'cpct', '暴击伤害': 'cdmg', '元素精通': 'mastery', '元素充能效率': 'recharge', '治疗加成': 'heal', '物理伤害加成': 'phy', '火元素伤害加成': 'pyro', '水元素伤害加成': 'hydro', '冰元素伤害加成': 'cryo', '雷元素伤害加成': 'electro', '风元素伤害加成': 'anemo', '岩元素伤害加成': 'geo', '草元素伤害加成': 'dendro' };

/** 根据名称及百分号区分固定值与百分比，拒绝猜测星级。 */
export function statKey(name, value) {
  const base = { '生命值': 'hp', '攻击力': 'atk', '防御力': 'def' }[name];
  return base ? base + (String(value).includes('%') ? '' : 'Plus') : (ALIASES[name] || name);
}

/** 转换 OCRArtifacts 的数组格式；缺失的保护字段保持未知。 */
export function importOcrArtifacts(records) {
  return { schemaVersion: 1, scan: { id: 'ocr-import', total: records.length, complete: false, verified: false, source: 'OCRArtifacts', issues: ['外部数组未提供扫描完整性，星级由上游猜测，不作为可信字段。'] }, artifacts: records.map((r, i) => ({
    id: `ocr-import-${i + 1}`, name: r.name, set: r.setType, slot: SLOT_NAMES.indexOf(r.slot),
    rarity: null, level: /^\d+$/.test(String(r.lv)) ? Number(r.lv) : null,
    main: { key: statKey(r.main, r.mainVal), value: parseFloat(String(r.mainVal).replace(/,/g, '')) },
    subs: (r.attr || []).flatMap(a => Object.keys(a).filter(k => !['active', 'isPercent'].includes(k)).map(k => ({ key: statKey(k, a.isPercent ? `${a[k]}%` : a[k]), value: parseFloat(a[k]), active: a.active !== false }))),
    locked: null, equippedBy: r.equip || null, location: { ordinal: i + 1 }, rawOcr: JSON.stringify(r),
  })) };
}

/** 规范化快照并收集逐件错误。相同属性的两件物品不会合并。 */
export function normalizeSnapshot(input) {
  const source = Array.isArray(input) ? importOcrArtifacts(input) : input;
  if (!source || source.schemaVersion !== 1 || !source.scan || !Array.isArray(source.artifacts)) throw new Error('需要 schemaVersion=1 的快照或 OCRArtifacts 数组。');
  const scan = { ...source.scan, issues: [...(source.scan.issues || [])] };
  const ids = new Set();
  const positions = new Set();
  const artifacts = source.artifacts.map((item, index) => {
    const a = { ...item, id: item.id || `${scan.id || 'scan'}-${index + 1}`, subs: Array.isArray(item.subs) ? item.subs.map(s => ({ ...s })) : [], issues: [...(item.issues || [])] };
    if (ids.has(a.id)) scan.issues.push(`物品编号重复：${a.id}`);
    ids.add(a.id);
    const p = a.location;
    if (p && [p.page, p.row, p.column].every(Number.isInteger)) {
      const key = `${p.page}:${p.row}:${p.column}`;
      if (positions.has(key)) scan.issues.push(`扫描坐标重复：${key}`);
      positions.add(key);
    }
    if (!a.name || !a.set) a.issues.push('名称或套装未知');
    if (!Number.isInteger(a.slot) || a.slot < 0 || a.slot > 4) a.issues.push('部位未知');
    if (!Number.isInteger(a.rarity) || a.rarity < 1 || a.rarity > 5) a.issues.push('星级未知');
    if (!Number.isInteger(a.level) || a.level < 0 || a.level > ({ 1: 4, 2: 4, 3: 12, 4: 16, 5: 20 }[a.rarity] || 20)) a.issues.push('等级无效');
    if (!a.main || !MAIN_KEYS[a.slot]?.includes(a.main.key) || !Number.isFinite(a.main.value) || a.main.value <= 0) a.issues.push('主词条无效');
    if (a.main?.value > (MAX_MAIN[a.main.key] || 0) + 0.1) a.issues.push('主词条数值超出范围');
    if (typeof a.locked !== 'boolean') a.issues.push('锁定状态未知');
    if (typeof a.equippedBy !== 'string') a.issues.push('穿戴状态未知');
    if (a.subs.length > 4) a.issues.push('副词条数量无效');
    const keys = new Set();
    for (const s of a.subs) {
      if (!(s.key in MAX_ROLL) || !Number.isFinite(s.value) || s.value <= 0 || typeof s.active !== 'boolean') a.issues.push('副词条无效');
      if (s.value > (MAX_ROLL[s.key] || 0) * 6 + 1) a.issues.push('副词条数值超出范围');
      if (keys.has(s.key) || s.key === a.main?.key) a.issues.push('词条重复');
      keys.add(s.key);
    }
    const active = a.subs.filter(s => s.active).length;
    if (a.rarity === 5 && (active < 3 || (a.level >= 4 && active !== 4))) a.issues.push('五星副词条缺失');
    if (a.rarity === 5) {
      const equivalent = a.subs.filter(s => s.active).reduce((n, s) => n + s.value / MAX_ROLL[s.key], 0);
      const minimum = (a.level < 4 ? active : 3 + Math.floor(a.level / 4)) * 0.7;
      const maximum = 4 + Math.floor(a.level / 4);
      if (equivalent < minimum - 0.2 || equivalent > maximum + 0.2) a.issues.push('副词条总量与强化等级不符');
    }
    if (a.subs.filter(s => !s.active).length > 1 || (a.subs.some(s => !s.active) && (a.level >= 4 || active !== 3))) a.issues.push('待激活词条状态无效');
    if (!a.location && !a.rawOcr) a.issues.push('缺少定位信息或原始记录');
    return a;
  });
  if (!Number.isInteger(scan.total) || scan.total !== artifacts.length) scan.issues.push('库存总数与逐件记录不符');
  if (scan.capacity !== undefined && (!Number.isInteger(scan.capacity) || scan.capacity < scan.total)) scan.issues.push('背包容量无效');
  return { schemaVersion: 1, scan, artifacts };
}
