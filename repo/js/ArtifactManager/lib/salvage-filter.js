/** 本项目词条键到 BetterGI ArtifactAffixType 枚举名的映射。 */
const AFFIX_TYPE = {
  hpPlus: 'HP', hp: 'HPPercent', atkPlus: 'ATK', atk: 'ATKPercent', defPlus: 'DEF', def: 'DEFPercent',
  cpct: 'CRITRate', cdmg: 'CRITDMG', mastery: 'ElementalMastery', recharge: 'EnergyRecharge', heal: 'HealingBonus',
  phy: 'PhysicalDMGBonus', pyro: 'PyroDMGBonus', hydro: 'HydroDMGBonus', dendro: 'DendroDMGBonus',
  electro: 'ElectroDMGBonus', anemo: 'AnemoDMGBonus', cryo: 'CryoDMGBonus', geo: 'GeoDMGBonus',
};

/** 把一件圣遗物转成可精确比对的指纹：名称、等级、主词条和全部副词条数值。 */
export function fingerprint(a) {
  const type = key => {
    if (!AFFIX_TYPE[key]) throw new Error(`未知词条：${key}`);
    return AFFIX_TYPE[key];
  };
  return { n: a.name, l: a.level, m: type(a.main.key), s: a.subs.map(s => [type(s.key), s.value]).sort() };
}

/**
 * 生成 BetterGI「自动分解」的筛选 JS。只有与清单中某件完全一致的圣遗物才输出 true。
 * 筛选器看不到快照编号，属性完全相同的多件无法区分；库存中同指纹的件只要有一件不在分解清单，
 * 这一组全部不分解，并在 skipped 中列出。
 * 锁定和穿戴中的圣遗物游戏本身不允许分解，因此清单外的保护由宿主和游戏共同保证。
 */
export function buildSalvageFilter(discards, inventory) {
  const key = a => JSON.stringify(fingerprint(a));
  const total = new Map(), chosen = new Map();
  for (const a of inventory) total.set(key(a), (total.get(key(a)) || 0) + 1);
  for (const a of discards) chosen.set(key(a), (chosen.get(key(a)) || 0) + 1);
  const safe = [], skipped = [];
  for (const a of discards) (chosen.get(key(a)) === total.get(key(a)) ? safe : skipped).push(a);
  const list = JSON.stringify(safe.map(fingerprint));
  const js = `var L=${list};
var A=ArtifactStat,M=Array.from(A.MinorAffixes);
function same(f){if(f.n!==A.Name||f.l!==A.Level||!(A.MainAffix.Type==f.m)||f.s.length!==M.length)return false;
return f.s.every(function(s){return M.some(function(x){return x.Type==s[0]&&Math.abs(x.Value-s[1])<0.06;});});}
Output=L.some(same);`;
  return { js, skipped };
}
