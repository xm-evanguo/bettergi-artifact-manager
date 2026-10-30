import { SLOT_NAMES, statKey, MAX_ROLL } from './model.js';

/** 解析一段简体中文面板；未识别字段保持未知，不猜测锁定、穿戴或星级。 */
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
  return { id, name: slotIndex > 0 ? lines[slotIndex - 1] : '', set: setIndex > 0 ? lines[setIndex - 1].replace(/[:：]$/, '') : '', slot, rarity: null, level: level ? Number(level.slice(1)) : null, main: { key: statKey(mainName, mainValue), value: parseFloat(mainValue.replace(/,/g, '')) }, subs, locked: null, equippedBy: null, rawOcr: String(text || ''), location, issues: ['实验扫描尚不能可靠确认星级、锁定与穿戴状态'] };
}
