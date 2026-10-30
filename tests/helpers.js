/** 虚构库存和规则；不代表当前版本攻略或用户账号。 */
export function item(id, overrides = {}) {
  return { id, name: '虚构花', set: '绝缘之旗印', slot: 0, rarity: 5, level: 20, main: { key: 'hpPlus', value: 4780 }, subs: [{ key: 'cpct', value: 3.9, active: true }, { key: 'cdmg', value: 7.8, active: true }, { key: 'atk', value: 5.8, active: true }, { key: 'recharge', value: 19.4, active: true }], locked: false, equippedBy: '', location: { ordinal: id }, rawOcr: '虚构测试记录', ...overrides };
}

/** 创建明确核对过的模拟范围；仅用于验证算法门槛。 */
export function config(names = ['雷电将军']) {
  return { demo: true, characters: names.map((name, i) => ({ name, priority: i === 0 ? 'main' : 'reserve' })), rosterConfirmed: true, reservePerCharacter: 1, targetFreeSlots: 10, rules: Object.fromEntries(names.map(name => [name, [{ id: '虚构测试玩法', sets: ['绝缘之旗印'], mainStats: { 0: ['hpPlus'], 1: ['atkPlus'], 2: ['atk', 'recharge'], 3: ['electro', 'atk'], 4: ['cpct', 'cdmg'] }, weights: { atk: 75, recharge: 75, cpct: 100, cdmg: 100, hp: 0, def: 0, mastery: 0 }, reviewed: true, source: 'https://example.invalid/test-only', version: '虚构测试规则' }]])) };
}

/** 构造人工核对标记，调用者可覆写以测试不完整扫描。 */
export function snapshot(artifacts, scan = {}) {
  return { schemaVersion: 1, scan: { id: 'fictional', total: artifacts.length, capacity: artifacts.length, complete: true, verified: true, issues: [], ...scan }, artifacts };
}
