import { listRows, saveRows } from '@/data/local-store'
import {
  checkSignOff,
  type Credential,
  type CredentialModule,
  type Operator,
} from '@/data/auth'
import type { ActionResult, EntryRow } from '@/data/types'

/**
 * 持证复核守卫：水质检测与仪器检定两个检测入口的动作都收口到这里，
 * 页面与通用 runAction 不再各自判权限，避免绕过校验点。
 */

export type GuardedModule = CredentialModule

export const GUARDED_MODULES: GuardedModule[] = ['waterquality', 'calibration']

export function isGuardedModule(key: string): key is GuardedModule {
  return (GUARDED_MODULES as string[]).includes(key)
}

const OWNER_UNIT_FIELD = '归属单位'
const SHARE_CODE_FIELD = '共享码'
const SHARE_LOG_FIELD = '共享记录'

export const GUARD_ACTIONS: Record<GuardedModule, string[]> = {
  waterquality: ['开始检测', '附加读数', '提交结论', '退回', '签发结论', '共享报告'],
  calibration: ['送出检定', '签发合格结论', '签发不合格结论', '共享记录'],
}

const SHARE_ACTION: Record<GuardedModule, string> = {
  waterquality: '共享报告',
  calibration: '共享记录',
}

export type ActionPayload = {
  /** 附加读数：采样站点人员录入的现场检测值。 */
  reading?: string
  /** 签发结论：操作人填写的检测项目授权编号。 */
  credentialCode?: string
  /** 分析人员提交的中间结论文本。 */
  conclusion?: string
}

export type ActionAvailability = {
  action: string
  enabled: boolean
  /** enabled=false 时给出原因，页面直接展示，便于操作人理解授权边界。 */
  reason?: string
}

// 签发核销台账：同一报告的签发结论只能生效一次，重复（含并发）提交一律拒绝。
const LEDGER_KEY = 'hydrology-monitor-station:signoff-ledger'

function readLedger(): string[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  try {
    const raw = window.localStorage.getItem(LEDGER_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

/** 原子核销：同步写入 localStorage，JS 单线程下两次并发签发只有第一次返回 true。 */
function redeemSignOff(key: string): boolean {
  const ledger = readLedger()
  if (ledger.includes(key)) {
    return false
  }
  ledger.push(key)
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger))
  }
  return true
}

/** 测试辅助：直接验证并发窗口内核销的原子性。 */
export function redeemSignOffForTest(key: string): boolean {
  return redeemSignOff(key)
}

export function isExternal(operator: Operator, row: EntryRow): boolean {
  return String(row[OWNER_UNIT_FIELD] ?? '') !== operator.unit
}

function externalResult(action: string): ActionResult {
  return { ok: false, message: `跨单位检测资料只能查看并共享，不能执行「${action}」` }
}

function appendLog(row: EntryRow, field: string, line: string): string {
  const previous = String(row[field] ?? '').trim()
  return previous ? `${previous}\n${line}` : line
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  const parsed = Number.parseFloat(String(value ?? '').trim())
  return Number.isFinite(parsed) ? parsed : null
}

function stampSnapshot(
  row: EntryRow,
  credential: Credential,
  operator: Operator,
  reviewedAt: string,
): EntryRow {
  return {
    ...row,
    签发授权编号: credential.code,
    授权检测项目: credential.scopes.join('、'),
    授权有效期至: credential.validTo,
    复核人: operator.name,
    复核时间: reviewedAt,
  }
}

// ---------------- 水质检测 ----------------

const WQ_FINAL = ['已复核', '超标']

function wqAvailability(row: EntryRow, operator: Operator): ActionAvailability[] {
  const status = String(row.status)
  const external = isExternal(operator, row)
  const sameUnit = !external
  const list: ActionAvailability[] = []

  if (external) {
    for (const action of GUARD_ACTIONS.waterquality) {
      list.push({
        action,
        enabled: action === SHARE_ACTION.waterquality,
        reason: action === SHARE_ACTION.waterquality ? undefined : '跨单位资料只能查看并共享',
      })
    }
    return list
  }

  const labRole = operator.role === 'analyst' || operator.role === 'reviewer'
  list.push({
    action: '开始检测',
    enabled: sameUnit && labRole && status === '已采样',
    reason: status !== '已采样' ? '仅已采样的报告能开始检测' : undefined,
  })
  list.push({
    action: '附加读数',
    // 受控授权按检测项目划分，未授权不能改动：采样站点人员的改动边界就是附加读数。
    enabled: sameUnit && operator.role === 'sampler' && status === '检测中',
    reason:
      operator.role !== 'sampler'
        ? '读数由采样站点人员附加'
        : status !== '检测中'
          ? '报告进入检测中后才能附加读数'
          : undefined,
  })
  list.push({
    action: '提交结论',
    enabled: sameUnit && labRole && status === '检测中',
    reason: status !== '检测中' ? '检测中的报告才能提交中间结论' : undefined,
  })
  list.push({
    action: '退回',
    enabled: sameUnit && labRole && status === '已出报告',
    reason: status !== '已出报告' ? '只有已出具的中间结论能退回' : undefined,
  })
  list.push({
    action: '签发结论',
    enabled: sameUnit && labRole && status === '已出报告',
    reason: status !== '已出报告' ? '只有待复核的中间结论能持证签发' : undefined,
  })
  list.push({ action: SHARE_ACTION.waterquality, enabled: true })
  return list
}

function runWaterQuality(
  action: string,
  row: EntryRow,
  commit: (updated: EntryRow) => void,
  operator: Operator,
  payload: ActionPayload | undefined,
  today: string,
): ActionResult {
  const status = String(row.status)
  const external = isExternal(operator, row)
  const labRole = operator.role === 'analyst' || operator.role === 'reviewer'

  if (action === SHARE_ACTION.waterquality) {
    const code = shareCode('WQ', row.id)
    commit({
      ...row,
      [SHARE_CODE_FIELD]: code,
      [SHARE_LOG_FIELD]: appendLog(row, SHARE_LOG_FIELD, `${today} ${operator.name}（${operator.unit}）发起共享`),
    })
    return { ok: true, message: `报告已共享，共享码 ${code}（外单位持码仅可查看）` }
  }

  if (external) {
    return externalResult(action)
  }

  if (action === '开始检测') {
    if (!labRole) {
      return { ok: false, message: '采样站点人员只能附加读数，开始检测由检测人员执行' }
    }
    if (status !== '已采样') {
      return { ok: false, message: `报告当前为「${status}」，只有已采样的报告能开始检测` }
    }
    commit({ ...row, status: '检测中', pending: true, abnormal: false })
    return { ok: true, message: '报告已进入检测中，等待采样站点附加读数' }
  }

  if (action === '附加读数') {
    if (operator.role !== 'sampler') {
      return { ok: false, message: '采样站点人员只能附加读数，该操作仅对采样站点人员开放' }
    }
    if (status !== '检测中') {
      return { ok: false, message: `报告当前为「${status}」，检测中才能附加读数` }
    }
    const reading = (payload?.reading ?? '').trim()
    if (!reading) {
      return { ok: false, message: '请填写现场检测读数后再附加' }
    }
    commit({
      ...row,
      检测值: reading,
      读数记录: appendLog(row, '读数记录', `${today} ${operator.name} 附加读数：${reading}`),
    })
    return { ok: true, message: `读数 ${reading} 已附加，结论仍须持证人员签发` }
  }

  if (action === '提交结论') {
    if (!labRole) {
      return { ok: false, message: '采样站点人员只能附加读数，不能提交检测结论' }
    }
    if (status !== '检测中') {
      return { ok: false, message: `报告当前为「${status}」，检测中才能提交中间结论` }
    }
    if (String(row.检测值 ?? '').trim() === '') {
      return { ok: false, message: '尚未附加任何检测读数，不能提交中间结论' }
    }
    const conclusion = (payload?.conclusion ?? '').trim() || '检测分析初步结论，待持证复核签发'
    commit({
      ...row,
      status: '已出报告',
      pending: true,
      abnormal: false,
      中间结论: conclusion,
    })
    return { ok: true, message: '中间结论已提交，等待持证复核签发' }
  }

  if (action === '退回') {
    if (!labRole) {
      return { ok: false, message: '采样站点人员只能附加读数，不能退回结论' }
    }
    if (status !== '已出报告') {
      return { ok: false, message: `报告当前为「${status}」，只有已出具的中间结论能退回` }
    }
    // 退回清空中间结论：已附加的检测读数保留，报告回到检测中重做分析。
    const next: EntryRow = { ...row }
    delete next.中间结论
    commit({
      ...next,
      status: '检测中',
      pending: true,
      abnormal: true,
      退回记录: appendLog(row, '退回记录', `${today} ${operator.name} 退回：中间结论已清空，重新检测分析`),
    })
    return { ok: true, message: '报告已退回检测中，中间结论已清空，检测读数保留' }
  }

  if (action === '签发结论') {
    if (!labRole) {
      return { ok: false, message: '采样站点人员只能附加读数，不能签发结论' }
    }
    if (status !== '已出报告') {
      return { ok: false, message: `报告当前为「${status}」，只有待复核的中间结论能签发` }
    }
    const code = (payload?.credentialCode ?? '').trim()
    if (!code) {
      return { ok: false, message: '签发结论必须填写检测项目授权编号' }
    }
    const checked = checkSignOff({
      code,
      operator,
      module: 'waterquality',
      scope: String(row.检测项目 ?? ''),
      ownerUnit: String(row[OWNER_UNIT_FIELD] ?? ''),
      today,
    })
    if (!checked.ok) {
      return checked
    }
    // 凭证核验通过后原子核销：并发窗口内两次调用都通过了状态判断，
    // 只有第一次能拿到签发权，第二次直接按重复提交拒绝（只生效一次）。
    const lockKey = `waterquality:${row.id}`
    if (!redeemSignOff(lockKey)) {
      return { ok: false, message: '该报告已完成授权签发，并发的重复提交未生效' }
    }
    const value = toNumber(row.检测值)
    const limit = toNumber(row.标准上限)
    const overLimit = value !== null && limit !== null && value > limit
    const finalStatus = overLimit ? '超标' : '已复核'
    commit({
      ...stampSnapshot(row, checked.credential, operator, today),
      status: finalStatus,
      pending: false,
      abnormal: false,
      检测结论: overLimit
        ? `复核结论：检测值 ${value} 高于标准上限 ${limit}，判定超标`
        : '复核结论：检测结果符合标准，准予出具',
    })
    return {
      ok: true,
      message: `授权编号 ${checked.credential.code} 核验通过，结论已签发，报告状态「${finalStatus}」`,
    }
  }

  return { ok: false, message: `水质检测报告没有登记「${action}」这个动作` }
}

// ---------------- 仪器检定（另一个检测入口） ----------------

const CAL_FINAL = ['已合格', '不合格', '已停用']

function calAvailability(row: EntryRow, operator: Operator): ActionAvailability[] {
  const status = String(row.status)
  const external = isExternal(operator, row)
  if (external) {
    return GUARD_ACTIONS.calibration.map((action) => ({
      action,
      enabled: action === SHARE_ACTION.calibration,
      reason: action === SHARE_ACTION.calibration ? undefined : '跨单位资料只能查看并共享',
    }))
  }
  const labRole = operator.role === 'analyst' || operator.role === 'reviewer'
  const signEnabled = labRole && status === '送检中'
  return [
    {
      action: '送出检定',
      enabled: labRole && status === '待送检',
      reason: status !== '待送检' ? '只有待送检仪器能送出检定' : undefined,
    },
    {
      action: '签发合格结论',
      enabled: signEnabled,
      reason: !labRole ? '检定结论须持授权编号的检测人员签发' : status !== '送检中' ? '送检中的仪器才能签发检定结论' : undefined,
    },
    {
      action: '签发不合格结论',
      enabled: signEnabled,
      reason: !labRole ? '检定结论须持授权编号的检测人员签发' : status !== '送检中' ? '送检中的仪器才能签发检定结论' : undefined,
    },
    { action: SHARE_ACTION.calibration, enabled: true },
  ]
}

function runCalibration(
  action: string,
  row: EntryRow,
  commit: (updated: EntryRow) => void,
  operator: Operator,
  payload: ActionPayload | undefined,
  today: string,
): ActionResult {
  const status = String(row.status)
  const external = isExternal(operator, row)
  const labRole = operator.role === 'analyst' || operator.role === 'reviewer'

  if (action === SHARE_ACTION.calibration) {
    const code = shareCode('CAL', row.id)
    commit({
      ...row,
      [SHARE_CODE_FIELD]: code,
      [SHARE_LOG_FIELD]: appendLog(row, SHARE_LOG_FIELD, `${today} ${operator.name}（${operator.unit}）发起共享`),
    })
    return { ok: true, message: `检定记录已共享，共享码 ${code}（外单位持码仅可查看）` }
  }

  if (external) {
    return externalResult(action)
  }

  if (action === '送出检定') {
    if (operator.role === 'sampler') {
      return { ok: false, message: '仪器送检由检测人员办理，采样站点人员只能附加读数' }
    }
    if (status !== '待送检') {
      return { ok: false, message: `记录当前为「${status}」，只有待送检仪器能送出检定` }
    }
    commit({ ...row, status: '送检中', pending: true, abnormal: false })
    return { ok: true, message: '仪器已送出检定，检定结论须持授权编号签发' }
  }

  if (action === '签发合格结论' || action === '签发不合格结论') {
    const pass = action === '签发合格结论'
    if (!labRole) {
      return { ok: false, message: '采样站点人员只能附加读数，检定结论须持授权编号签发' }
    }
    if (status !== '送检中') {
      return { ok: false, message: `记录当前为「${status}」，只有送检中的仪器能签发检定结论` }
    }
    const code = (payload?.credentialCode ?? '').trim()
    if (!code) {
      return { ok: false, message: '签发检定结论必须填写检测项目授权编号' }
    }
    const checked = checkSignOff({
      code,
      operator,
      module: 'calibration',
      scope: '仪器检定',
      ownerUnit: String(row[OWNER_UNIT_FIELD] ?? ''),
      today,
    })
    if (!checked.ok) {
      return checked
    }
    const lockKey = `calibration:${row.id}`
    if (!redeemSignOff(lockKey)) {
      return { ok: false, message: '该检定记录已完成授权签发，并发的重复提交未生效' }
    }
    const finalStatus = pass ? '已合格' : '不合格'
    commit({
      ...stampSnapshot(row, checked.credential, operator, today),
      status: finalStatus,
      pending: false,
      abnormal: false,
      检定结论: pass ? '检定合格，准予继续使用' : '检定不合格，停用并安排更换',
    })
    return {
      ok: true,
      message: `授权编号 ${checked.credential.code} 核验通过，检定结论「${finalStatus}」已签发`,
    }
  }

  return { ok: false, message: `仪器检定记录没有登记「${action}」这个动作` }
}

// ---------------- 统一入口 ----------------

export function availableActions(
  module: GuardedModule,
  row: EntryRow,
  operator: Operator,
): ActionAvailability[] {
  return module === 'waterquality'
    ? wqAvailability(row, operator)
    : calAvailability(row, operator)
}

/** 历史报告：终态但没有签发快照，属于持证复核上线前出具的资料，原样兼容。 */
export function isLegacyReport(module: GuardedModule, row: EntryRow): boolean {
  const finals = module === 'waterquality' ? WQ_FINAL : CAL_FINAL
  return finals.includes(String(row.status)) && String(row.签发授权编号 ?? '').trim() === ''
}

export function requiresCredentialInput(action: string): boolean {
  return ['签发结论', '签发合格结论', '签发不合格结论'].includes(action)
}

function shareCode(prefix: string, id: number): string {
  const stamp = todayISO().replace(/-/g, '')
  const random = Math.floor(1000 + Math.random() * 9000)
  return `${prefix}-FX${stamp}-${String(id).padStart(3, '0')}-${random}`
}

function todayISO(): string {
  const override = (globalThis as { __TODAY__?: string }).__TODAY__
  if (override) {
    return override
  }
  return new Date().toISOString().slice(0, 10)
}

function commitFactory(
  module: GuardedModule,
  rows: EntryRow[],
  index: number,
): (updated: EntryRow) => void {
  return (updated: EntryRow) => {
    const next = [...rows]
    next[index] = updated
    // 所有改动仍走 local-store 这一条持久化通道。
    saveRows(module, next)
    rows.splice(0, rows.length, ...next)
  }
}

export function runGuardedAction(
  module: GuardedModule,
  id: number,
  action: string,
  operator: Operator,
  payload?: ActionPayload,
): ActionResult {
  const rows = listRows(module)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    const entity = module === 'waterquality' ? '水质检测报告' : '仪器检定记录'
    return { ok: false, message: `没有找到编号为 ${id} 的${entity}` }
  }
  const commit = commitFactory(module, rows, index)
  return module === 'waterquality'
    ? runWaterQuality(action, rows[index], commit, operator, payload, todayISO())
    : runCalibration(action, rows[index], commit, operator, payload, todayISO())
}
