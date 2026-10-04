import { listRows, resetRows } from '@/data/local-store'
import { runAction } from '@/api/local-service'

const LEDGER_KEY = 'hydrology-monitor-station:signoff-ledger'

function fresh(module: string) {
  resetRows(module)
  window.localStorage.removeItem(LEDGER_KEY)
  return listRows(module)
}

function act(module: string, id: number, action: string, operatorId: string, payload?: Record<string, string>) {
  return runAction(module, id, action, { operatorId, payload })
}

function row(module: string, id: number) {
  return listRows(module).find((item) => Number(item.id) === id)!
}

let pass = 0
let fail = 0
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++
    console.log('  ✓ ' + name)
  } else {
    fail++
    console.log('  ✗ ' + name + (detail ? ' -> ' + detail : ''))
  }
}

export async function runTestSuite() {
  console.log('水质检测 · 持证复核')

  // 1. 采样站点人员只能附加读数
  fresh('waterquality')
  check('采样员开始检测被拒', act('waterquality', 1, '开始检测', 'wangke').ok === false)
  let r = act('waterquality', 1, '附加读数', 'wangke', { reading: '7.1' })
  check('已采样状态不能附加读数（须先检测中）', r.ok === false, r.message)
  check('采样员提交结论被拒', act('waterquality', 2, '提交结论', 'wangke').ok === false)
  check(
    '采样员签发结论被拒',
    act('waterquality', 3, '签发结论', 'wangke', { credentialCode: 'WQ-PH-2026-018' }).ok === false,
  )

  // 2. 附加读数
  r = act('waterquality', 2, '附加读数', 'wangke', { reading: '0.42' })
  check('检测中可附加读数', r.ok, r.message)
  check('读数写入检测值', String(row('waterquality', 2).检测值) === '0.42')
  check('空读数被拒', act('waterquality', 2, '附加读数', 'wangke', { reading: '   ' }).ok === false)

  // 3. 授权编号校验
  fresh('waterquality')
  check('签发必须填写授权编号', act('waterquality', 3, '签发结论', 'chenlan', { credentialCode: '' }).ok === false)
  r = act('waterquality', 3, '签发结论', 'chenlan', { credentialCode: 'NOPE-999' })
  check('不存在的授权编号被拒', r.ok === false && /未在.*台账/.test(r.message), r.message)

  // 4. 受控授权按检测项目划分
  r = act('waterquality', 4, '签发结论', 'chenlan', { credentialCode: 'WQ-PH-2026-018' })
  check('检测项目不匹配被拒（pH授权签氨氮）', r.ok === false && /受控检测项目/.test(r.message), r.message)

  // 5. 授权到期 -> 仅查看
  r = act('waterquality', 4, '签发结论', 'chenlan', { credentialCode: 'WQ-NH3N-2025-042' })
  check('到期授权不能签发（降级查看）', r.ok === false && /到期/.test(r.message), r.message)

  // 6. 跨单位只能查看并共享
  r = act('waterquality', 3, '签发结论', 'zhaolei', { credentialCode: 'WQ-TP-2026-113' })
  check('外单位授权签发本单位报告被拒', r.ok === false && /跨单位/.test(r.message), r.message)
  r = act('waterquality', 3, '附加读数', 'zhaolei', { reading: '9' })
  check('外单位不能改动（附加读数也拒）', r.ok === false && /跨单位/.test(r.message), r.message)
  r = act('waterquality', 3, '共享报告', 'zhaolei')
  check('外单位可以共享', r.ok === true && /共享码/.test(r.message), r.message)
  check('共享码写入记录', /^WQ-FX/.test(String(row('waterquality', 3).共享码)), String(row('waterquality', 3).共享码))
  check('外单位记录可正常读取', listRows('waterquality').some((item) => item.id === 5))

  // 7. 正常签发 + 凭证快照
  fresh('waterquality')
  r = act('waterquality', 3, '签发结论', 'chenlan', { credentialCode: 'WQ-PH-2026-018' })
  check('有效授权签发成功', r.ok && /核验通过/.test(r.message), r.message)
  check('签发后状态为已复核', String(row('waterquality', 3).status) === '已复核')
  check(
    '复核凭证快照固化',
    String(row('waterquality', 3).签发授权编号) === 'WQ-PH-2026-018' &&
      String(row('waterquality', 3).复核人) === '陈岚',
  )
  check('签发后 pending=false', row('waterquality', 3).pending === false)
  check('签发快照写入复核日期', String(row('waterquality', 3).复核时间) === '2026-10-04')

  // 8. 同一授权并发签发只生效一次
  r = act('waterquality', 3, '签发结论', 'chenlan', { credentialCode: 'WQ-PH-2026-018' })
  check('已终态重复签发被拒', r.ok === false, r.message)
  fresh('waterquality')
  const first = act('waterquality', 3, '签发结论', 'chenlan', { credentialCode: 'WQ-PH-2026-018' })
  const second = act('waterquality', 3, '签发结论', 'chenlan', { credentialCode: 'WQ-PH-2026-018' })
  check(
    '同一授权顺序重复签发只生效一次（终态拦截）',
    first.ok === true && second.ok === false,
    first.message + ' / ' + second.message,
  )
  // 真正的并发窗口：两次请求都在首次落库前通过状态判断，随后竞争原子核销。
  // 直接调用核销台账验证原子性：同一锁键第一次 true、第二次 false。
  const { redeemSignOffForTest } = await import('@/api/review-guard')
  fresh('waterquality')
  const winA = redeemSignOffForTest('waterquality:3')
  const winB = redeemSignOffForTest('waterquality:3')
  check('并发窗口内核销原子：同一授权只生效一次', winA === true && winB === false)

  // 9. 超标判定
  fresh('waterquality')
  // 报告4是氨氮（授权已到期）；把报告3的读数路径留作正常，超标用直接构造行验证：
  // 先把报告4走完整流程但授权到期无法签 -> 改为验证数值判定辅助路径（读数 1.36 > 1.0 已在种子）。
  // 这里通过检测中 -> 提交结论，确认中间态可重复构建。
  check('检测中可提交结论', act('waterquality', 2, '提交结论', 'liwen', { conclusion: '待复核' }).ok)
  // 超标签发：临时给报告4换检测项目不可能；改为对报告3先改读数不允许，故用种子数据说明超标列存在。
  check('超标种子报告存在（氨氮1.36>1.0 待签发）', String(row('waterquality', 4).status) === '已出报告')

  // 10. 退回清空中间结论、保留读数
  fresh('waterquality')
  r = act('waterquality', 3, '退回', 'chenlan')
  check('退回成功', r.ok && /中间结论已清空/.test(r.message), r.message)
  check('退回后回到检测中', String(row('waterquality', 3).status) === '检测中')
  check('中间结论被清空', String(row('waterquality', 3).中间结论 ?? '') === '')
  check('检测读数保留', String(row('waterquality', 3).检测值) !== '')
  check('退回标记 abnormal', row('waterquality', 3).abnormal === true)
  check('非待复核状态不能退回', act('waterquality', 1, '退回', 'chenlan').ok === false)
  check('检测中不能直接签发', act('waterquality', 3, '签发结论', 'chenlan', { credentialCode: 'WQ-PH-2026-018' }).ok === false)
  // 退回 -> 重新提交 -> 重新签发闭环
  act('waterquality', 3, '提交结论', 'liwen', { conclusion: '复检结论' })
  r = act('waterquality', 3, '签发结论', 'chenlan', { credentialCode: 'WQ-PH-2026-018' })
  check('退回后重新提交可再次签发', r.ok, r.message)

  // 11. 冒用他人授权
  fresh('waterquality')
  r = act('waterquality', 3, '签发结论', 'liwen', { credentialCode: 'WQ-PH-2026-018' })
  check('冒用他人授权编号被拒', r.ok === false && /持证人为其他人员/.test(r.message), r.message)

  // 12. 历史报告兼容
  fresh('waterquality')
  const legacy = row('waterquality', 7)
  check('历史报告状态与无凭证特征保留', String(legacy.status) === '已复核' && String(legacy.签发授权编号) === '')

  // 13. 超标判定真实路径：分析人提交 + 用 pH 授权签不了氨氮——
  //     构造一条 pH 超标报告走通：报告1 已采样 -> 检测 -> 读数 9.8（上限9.0）-> 提交 -> 签发
  fresh('waterquality')
  act('waterquality', 1, '开始检测', 'liwen')
  act('waterquality', 1, '附加读数', 'wangke', { reading: '9.8' })
  act('waterquality', 1, '提交结论', 'liwen', { conclusion: '疑似超标' })
  r = act('waterquality', 1, '签发结论', 'chenlan', { credentialCode: 'WQ-PH-2026-018' })
  check('超标读数签发后状态为超标', r.ok && String(row('waterquality', 1).status) === '超标', r.message)

  console.log('仪器检定 · 另一个检测入口的复核凭证')
  fresh('calibration')
  check('采样员不能送出检定', act('calibration', 1, '送出检定', 'wangke').ok === false)
  r = act('calibration', 1, '送出检定', 'chenlan')
  check('检测人员送出检定', r.ok, r.message)
  check('待送检以外状态重复送出被拒', act('calibration', 2, '送出检定', 'chenlan').ok === false)
  check('签发检定结论必须填编号', act('calibration', 2, '签发合格结论', 'chenlan', { credentialCode: '' }).ok === false)
  r = act('calibration', 2, '签发合格结论', 'chenlan', { credentialCode: 'WQ-PH-2026-018' })
  check('水质授权不能跨类别签发检定', r.ok === false && /不属于仪器检定/.test(r.message), r.message)
  r = act('calibration', 2, '签发不合格结论', 'chenlan', { credentialCode: 'CAL-2026-007' })
  check('仪器授权签发不合格结论', r.ok && /核验通过/.test(r.message), r.message)
  check(
    '状态为不合格并固化凭证',
    String(row('calibration', 2).status) === '不合格' &&
      String(row('calibration', 2).签发授权编号) === 'CAL-2026-007',
  )
  const secondCal = act('calibration', 2, '签发合格结论', 'chenlan', { credentialCode: 'CAL-2026-007' })
  check('检定记录重复签发被拒（只生效一次）', secondCal.ok === false, secondCal.message)
  fresh('calibration')
  const calLegacy = row('calibration', 3)
  check(
    '历史检定结论兼容（无凭证已合格）',
    String(calLegacy.status) === '已合格' && String(calLegacy.签发授权编号) === '',
  )

  console.log(`\n结果：${pass} 通过，${fail} 失败`)
  if (fail > 0) {
    process.exitCode = 1
  }
}
