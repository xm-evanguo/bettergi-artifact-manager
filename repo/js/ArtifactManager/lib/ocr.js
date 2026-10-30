import { SLOT_NAMES, statKey, MAX_ROLL } from './model.js';

/**
 * 主词条 +0 与满级数值：五星满级 +20，四星满级 +16。
 * 用于按「主词条数值 + 等级」反推星级，不依赖图片素材。
 */
const MAIN_CURVE = {
  5: { max: 20, hpPlus: [717, 4780], atkPlus: [47, 311], hp: [7.0, 46.6], atk: [7.0, 46.6], def: [8.7, 58.3], mastery: [28, 187], recharge: [7.8, 51.8], cpct: [4.7, 31.1], cdmg: [9.3, 62.2], heal: [5.4, 35.9], elem: [7.0, 46.6], phy: [8.7, 58.3] },
  4: { max: 16, hpPlus: [645, 3571], atkPlus: [42, 232], hp: [6.3, 34.8], atk: [6.3, 34.8], def: [7.9, 43.5], mastery: [25.2, 139.3], recharge: [7.0, 38.7], cpct: [4.2, 23.2], cdmg: [8.4, 46.4], heal: [4.8, 26.8], elem: [6.3, 34.8], phy: [7.9, 43.5] },
};
const ELEM_KEYS = ['pyro', 'hydro', 'cryo', 'electro', 'anemo', 'geo', 'dendro'];

/** 按主词条数值反推星级；两种星级都对不上（误差超过 6%）时返回 null。 */
export function rarityFromMain(key, level, value) {
  if (!Number.isFinite(value) || !Number.isInteger(level)) return null;
  if (level > 16) return 5;
  const curveKey = ELEM_KEYS.includes(key) ? 'elem' : key;
  let best = null;
  for (const rarity of [5, 4]) {
    const c = MAIN_CURVE[rarity];
    if (!c[curveKey] || level > c.max) continue;
    const [start, end] = c[curveKey];
    const expected = start + (end - start) * level / c.max;
    const error = Math.abs(value - expected) / expected;
    if (error < 0.06 && (!best || error < best.error)) best = { rarity, error };
  }
  return best ? best.rarity : null;
}

/** 解析一段简体中文面板；未识别字段保持未知。锁定状态背包面板无法可靠读取，固定为 null。 */
export function parsePanel(text, id, location) {
  const lines = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const slotIndex = lines.findIndex(s => SLOT_NAMES.includes(s));
  const slot = slotIndex < 0 ? -1 : SLOT_NAMES.indexOf(lines[slotIndex]);
  const setIndex = lines.findIndex(s => /2件套/.test(s));
  const level = lines.find(s => /^\+\d{1,2}$/.test(s));
  const mainName = lines[slotIndex + 1];
  const mainValue = lines[slotIndex + 2] || '';
  const subs = [];
  for (const line of lines.slice(slotIndex + 3, setIndex < 0 ? undefined : setIndex)) {
    const m = line.match(/^([^+]+)\+([\d,.]+%?)(.*)$/);
    if (!m) continue;
    const key = statKey(m[1].trim().replace(/[·•]/g, ''), m[2]);
    if (key in MAX_ROLL) subs.push({ key, value: Number(m[2].replace(/[,%]/g, '')), active: !line.includes('待激活') });
  }
  // 面板最后一行「角色名已装备」表示穿戴者；有套装行但没有该行时视为未穿戴。
  const equipLine = lines.findLast(s => s.endsWith('已装备'));
  const equippedBy = equipLine ? equipLine.replace(/已装备$/, '').trim() : setIndex >= 0 ? '' : null;
  const main = { key: statKey(mainName, mainValue), value: parseFloat(mainValue.replace(/,/g, '')) };
  const lv = level ? Number(level.slice(1)) : null;
  const rarity = rarityFromMain(main.key, lv, main.value);
  return { id, name: slotIndex > 0 ? lines[slotIndex - 1] : '', set: setIndex > 0 ? lines[setIndex - 1].replace(/[:：]$/, '') : '', slot, rarity, level: lv, main, subs, locked: null, equippedBy, rawOcr: String(text || ''), location, issues: rarity === null ? ['星级未能从主词条数值确认'] : [] };
}
