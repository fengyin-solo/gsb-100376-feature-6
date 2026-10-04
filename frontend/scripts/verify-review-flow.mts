// 业务校验点的端到端验证：用内存版 localStorage 模拟浏览器，跑完所有关键场景。
const mem = new Map<string, string>()
globalThis.window = {
  localStorage: {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  },
  addEventListener: () => {},
} as unknown as Window & typeof globalThis

const { startDetection, issueReport, reviewReport, returnReport, attachReading, shareReport } = await import(
  '../src/api/water-quality-service.ts'
)
const { runAction } = await import('../src/api/local-service.ts')
const { resetRows } = await import('../src/data/local-store.ts')

const LI = 'p-liqing' // 持证：COD/氨氮有效，总磷到期
const WANG = 'p-wanglei' // 采样员
const ZHAO = 'p-zhaomin' // 跨单位复核人

let passed = 0
let failed = 0
function check(label: string, result: { ok: boolean }, expectOk: boolean, include = '') {
  const ok = result.ok === expectOk && (include === '' || result.message.includes(include))
  if (ok) {
    passed += 1
    console.log(`  ✅ ${label}`)
  } else {
    failed += 1
    console.log(`  ❌ ${label} -> ${result.ok} "${result.message}"`)
  }
}

resetRows('waterquality')
resetRows('calibration')

console.log('1) 采样人员：只能附加读数，其余改动全部拒绝')
check('采样员开始检测被拒', startDetection(1, WANG), false, '只能附加读数')
check('采样员出具报告被拒', issueReport(2, WANG, '判定合格'), false, '只能附加读数')
check('采样员复核签发被拒', reviewReport(3, WANG, '同意'), false, '只能附加读数')
check('采样员附加读数允许', attachReading(2, WANG, '0.66'), true, '采样读数已附加')

console.log('2) 未授权项目不能改动（受控授权按检测项目划分）')
check('赵敏改市水文中心氨氮被拒（跨单位）', startDetection(1, ZHAO), false, '跨单位资料只能查看并共享')
check('赵敏可共享市水文中心报告', shareReport(1, ZHAO), true, '跨单位资料已共享')
check('李清总磷到期 -> 只读，不能复核', reviewReport(4, LI, '同意超标结论'), false, '到期，已自动转为只读')
check('李清总磷到期 -> 出具报告也不行', issueReport(4, LI, '超标'), false, '到期，已自动转为只读')
check('李清总磷到期 -> 退回报废也不行', returnReport(4, LI), false, '到期')

console.log('3) 持证复核主流程：开始检测 -> 中间结论 -> 签发')
check('李清开始检测 #1', startDetection(1, LI), true)
check('未写中间结论不能出具', issueReport(1, LI, '  '), false, '必须填写中间结论')
check('李清出具报告 #1', issueReport(1, LI, '初判合格'), true)
check('重复出具被状态拦截', issueReport(1, LI, '再判一次'), false, '需在检测中出具')
check('李清持证复核 #1', reviewReport(1, LI, '同意结论，准予签发'), true, 'WQ-COD-0101')
check('已复核后采样员不能再附加读数', attachReading(1, WANG, '9.9'), false, '已复核签发')

console.log('4) 同一授权编号只生效一次（含并发/跨入口）')
// 另一份 COD 报告 #3：凭证 WQ-COD-0101 已被 #1 消耗
check('同一凭证签发第二份报告被拒', reviewReport(3, LI, '同意'), false, '只能签发一次')
// 仪器检定入口同样使用凭证台账：COD 凭证在水质入口消耗后，检定入口也不能再用
const cali = runAction('calibration', 2, '确认合格', {
  operatorId: LI,
  credentialNo: 'WQ-NH3N-0102',
  text: '检定合格',
})
check('仪器检定确认合格需复核凭证（氨氮凭证登记成功）', cali, true, 'WQ-NH3N-0102')
// 凭证已消耗：另一条送检中记录（#1 先送出检定）再用同一编号，应被台账拦截而不是状态拦截
runAction('calibration', 1, '送出检定', { operatorId: LI })
const caliDup = runAction('calibration', 1, '确认合格', {
  operatorId: LI,
  credentialNo: 'WQ-NH3N-0102',
  text: '再签一次',
})
check('同一凭证在检定入口第二次签发被拒', caliDup, false, '只生效一次')
const caliOther = runAction('calibration', 1, '标记不合格', { operatorId: LI })
check('其他检定动作不受影响', caliOther, true)
// 并发模拟：先退回 #1 释放凭证，再在两份待签发报告上连续抢同一凭证
check('退回已复核 #1：清空中间结论并释放凭证', returnReport(1, LI), true, 'WQ-COD-0101 已释放')
check('重新出具 #1', issueReport(1, LI, '初判合格'), true)
const winA = reviewReport(1, LI, '并发抢签 A')
const winB = reviewReport(3, LI, '并发抢签 B')
check('并发抢签：第一份成功', winA, true, '已登记并消耗')
check('并发抢签：第二份被拒', winB, false, '只能签发一次')

console.log('5) 退回清空中间结论与复核信息')
check('再次退回 #1', returnReport(1, LI), true)
const { listWaterQualityRows } = await import('../src/api/water-quality-service.ts')
const row1 = listWaterQualityRows().find((r) => Number(r.id) === 1)!
const cleared =
  row1['中间结论'] === undefined &&
  row1['复核凭证'] === undefined &&
  row1['签发人'] === undefined &&
  String(row1.status) === '检测中'
if (cleared) {
  passed += 1
  console.log('  ✅ 退回后中间结论/复核意见/凭证/签发人均已清空，状态回到检测中')
} else {
  failed += 1
  console.log('  ❌ 退回清空不彻底', JSON.stringify(row1, null, 2))
}

console.log('6) 历史报告兼容')
const row6 = listWaterQualityRows().find((r) => Number(r.id) === 6)!
const legacyReadable = String(row6.status) === '已复核'
const legacyActions =
  shareReport(6, ZHAO).ok === true // 历史报告赵敏单位不同但无所属单位 -> 按本单位兼容可共享
if (legacyReadable && legacyActions) {
  passed += 1
  console.log('  ✅ 历史报告无所属单位/无凭证正常读取，按本单位兼容可共享；已复核归档')
} else {
  failed += 1
  console.log('  ❌ 历史报告兼容异常')
}

console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
