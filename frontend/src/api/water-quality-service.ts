/**
 * 水质检测报告「持证复核」业务服务：报告授权数据流上的所有校验点集中在这里。
 *
 * 数据流：已采样 →（开始检测）→ 检测中 →（出具报告：写中间结论）→
 *         已出报告/超标 →（持证复核：消耗授权编号、写复核凭证）→ 已复核
 *         任一结论态 →（退回：清空中间结论与复核凭证、释放授权）→ 检测中
 *
 * 校验点：
 *  1. 跨单位资料：只能查看与共享，不能改动（无所属单位的历史报告按本单位兼容）；
 *  2. 受控授权按检测项目划分：未取得该项目授权编号不能改动，采样站点人员只能附加读数；
 *  3. 授权到期自动降为只读（决策：到期不允许补签，需续期后恢复签发权限）；
 *  4. 持证复核时原子消耗授权编号，同一授权编号并发签发只生效一次；
 *  5. 历史报告无新字段时正常读取，不强制补凭证；一旦退回，中间结论与复核信息全部清空。
 */
import {
  consumeCredential,
  listRows,
  releaseCredential,
  saveRows,
} from '@/data/local-store'
import {
  effectiveGrant,
  findGrant,
  isSameUnit,
  operatorOf,
  type Operator,
} from '@/data/authorization'
import type { ActionResult, EntryRow } from '@/data/types'

export const WATER_QUALITY_KEY = 'waterquality'

export function listWaterQualityRows(): EntryRow[] {
  return listRows(WATER_QUALITY_KEY)
}

function todayLabel(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function loadReport(id: number): { rows: EntryRow[]; index: number; report: EntryRow } | ActionResult {
  const rows = listRows(WATER_QUALITY_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的水质检测报告` }
  }
  return { rows, index, report: rows[index] }
}

/** 校验点 1：跨单位资料只能查看与共享；历史报告（无所属单位）视为本单位资料 */
function requireSameUnit(person: Operator, report: EntryRow): ActionResult | null {
  if (isSameUnit(person, report)) {
    return null
  }
  return {
    ok: false,
    message: `该报告归属${String(report['所属单位'] ?? '其他单位')}，跨单位资料只能查看并共享，不能改动`,
  }
}

/** 校验点 2/3：按检测项目逐项校验授权；采样人员没有授权，只能附加读数 */
function requireItemGrant(person: Operator, report: EntryRow): ActionResult | null {
  const item = String(report['检测项目'] ?? '')
  if (effectiveGrant(person, item)) {
    return null
  }
  if (person.role === 'sampler') {
    return {
      ok: false,
      message: `采样站点人员只能附加读数，不能签发或改动结论；如需签发请由持有「${item}」授权编号的复核人操作`,
    }
  }
  const expired = findGrant(person, item)
  if (expired) {
    return {
      ok: false,
      message: `检测项目「${item}」的授权编号 ${expired.credentialNo} 已于 ${expired.expireAt} 到期，已自动转为只读，请续期后再签发`,
    }
  }
  return {
    ok: false,
    message: `未取得检测项目「${item}」的检测项目授权编号，受控授权按项目划分，不能改动该报告`,
  }
}

function persist(rows: EntryRow[], index: number, next: EntryRow): EntryRow[] {
  const updated = [...rows]
  updated[index] = next
  saveRows(WATER_QUALITY_KEY, updated)
  return updated
}

function exceedsStandard(report: EntryRow): boolean {
  const value = Number.parseFloat(String(report['检测值'] ?? ''))
  const limit = Number.parseFloat(String(report['标准上限'] ?? ''))
  return Number.isFinite(value) && Number.isFinite(limit) && value > limit
}

/** 开始检测：已采样 → 检测中（本单位 + 项目有效授权） */
export function startDetection(id: number, operatorId: string): ActionResult {
  const person = operatorOf(operatorId)
  const loaded = loadReport(id)
  if ('ok' in loaded) return loaded
  const { rows, index, report } = loaded
  const denied = requireSameUnit(person, report) ?? requireItemGrant(person, report)
  if (denied) return denied
  if (String(report.status) !== '已采样') {
    return { ok: false, message: `报告当前为「${String(report.status)}」，只有「已采样」可以开始检测` }
  }
  persist(rows, index, { ...report, status: '检测中', pending: true, abnormal: false })
  return { ok: true, message: `报告已进入检测中，由 ${person.name} 承接检测` }
}

/** 出具报告：检测中 → 已出报告/超标，只写入中间结论，不代表最终签发 */
export function issueReport(id: number, operatorId: string, conclusion: string): ActionResult {
  const person = operatorOf(operatorId)
  const text = conclusion.trim()
  if (!text) {
    return { ok: false, message: '出具报告必须填写中间结论（检测初步判定）' }
  }
  const loaded = loadReport(id)
  if ('ok' in loaded) return loaded
  const { rows, index, report } = loaded
  const denied = requireSameUnit(person, report) ?? requireItemGrant(person, report)
  if (denied) return denied
  if (String(report.status) !== '检测中') {
    return {
      ok: false,
      message: `报告当前为「${String(report.status)}」，需在检测中出具；已签发报告请先退回再改`,
    }
  }
  const over = exceedsStandard(report)
  const next: EntryRow = {
    ...report,
    status: over ? '超标' : '已出报告',
    pending: true,
    abnormal: over,
    中间结论: text,
    检测人: `${person.name}（${effectiveGrant(person, String(report['检测项目']))?.credentialNo}）`,
  }
  persist(rows, index, next)
  return {
    ok: true,
    message: over
      ? `中间结论已保存，检测值超标准上限，报告标记为「超标」，待持证复核签发`
      : `中间结论已保存，报告为「已出报告」，待持证复核签发`,
  }
}

/** 持证复核：已出报告/超标 → 已复核。原子消耗授权编号，并发只生效一次 */
export function reviewReport(id: number, operatorId: string, opinion: string): ActionResult {
  const person = operatorOf(operatorId)
  const text = opinion.trim()
  if (!text) {
    return { ok: false, message: '持证复核必须填写复核意见' }
  }
  const loaded = loadReport(id)
  if ('ok' in loaded) return loaded
  const { rows, index, report } = loaded
  const denied = requireSameUnit(person, report) ?? requireItemGrant(person, report)
  if (denied) return denied
  const status = String(report.status)
  if (status !== '已出报告' && status !== '超标') {
    return { ok: false, message: `报告当前为「${status}」，只有待签发的报告可以持证复核` }
  }
  const grant = effectiveGrant(person, String(report['检测项目']))!
  const ownerRef = `WQ-${id}`
  // 校验点 4：先占台账再写报告，重复/并发的第二次签发占不到编号
  const consumed = consumeCredential(grant.credentialNo, ownerRef)
  if (!consumed.ok) {
    return {
      ok: false,
      message: `授权编号 ${grant.credentialNo} 已在报告 ${consumed.ownerRef} 上签发生效，同一授权编号只能签发一次`,
    }
  }
  persist(rows, index, {
    ...report,
    status: '已复核',
    pending: false,
    abnormal: false,
    复核意见: text,
    复核凭证: grant.credentialNo,
    签发人: person.name,
    签发时间: todayLabel(),
  })
  return {
    ok: true,
    message: `复核凭证 ${grant.credentialNo} 已登记并消耗，报告由 ${person.name} 签发为「已复核」`,
  }
}

/** 退回：清空中间结论与全部复核信息、释放授权占用，回到检测中 */
export function returnReport(id: number, operatorId: string): ActionResult {
  const person = operatorOf(operatorId)
  const loaded = loadReport(id)
  if ('ok' in loaded) return loaded
  const { rows, index, report } = loaded
  // 退回报废的是本单位结论；跨单位仍只能看，历史报告按本单位兼容可查看
  const sameUnit = requireSameUnit(person, report)
  if (sameUnit) return sameUnit
  const status = String(report.status)
  if (status === '已采样') {
    return { ok: false, message: '报告尚未开始检测，没有可退回的结论' }
  }
  // 到期转只读、未授权不能改动：退回同样作废结论，按项目授权把关（历史报告无项目授权，归档不可退）
  const denied = requireItemGrant(person, report)
  if (denied) return denied
  const credentialNo = String(report['复核凭证'] ?? '')
  if (credentialNo) {
    releaseCredential(credentialNo, `WQ-${id}`)
  }
  const next: EntryRow = { ...report }
  delete next['中间结论']
  delete next['复核意见']
  delete next['复核凭证']
  delete next['签发人']
  delete next['签发时间']
  next.status = '检测中'
  next.pending = true
  next.abnormal = false
  persist(rows, index, next)
  return {
    ok: true,
    message: credentialNo
      ? `报告已退回检测中，中间结论与复核信息已清空，授权编号 ${credentialNo} 已释放可重新签发`
      : '报告已退回检测中，中间结论已清空',
  }
}

/** 附加读数：采样站点人员唯一允许的写入动作；不改状态、不动结论；跨单位不行 */
export function attachReading(id: number, operatorId: string, reading: string): ActionResult {
  const person = operatorOf(operatorId)
  const value = reading.trim()
  if (!value) {
    return { ok: false, message: '附加读数不能为空' }
  }
  const loaded = loadReport(id)
  if ('ok' in loaded) return loaded
  const { rows, index, report } = loaded
  const denied = requireSameUnit(person, report)
  if (denied) return denied
  if (String(report.status) === '已复核') {
    return { ok: false, message: '报告已复核签发，结论不可改动；如需补测请先发起退回' }
  }
  const previous = Array.isArray(report['附加读数']) ? (report['附加读数'] as string[]) : []
  const entry = `${todayLabel()} ${person.name}：${value}`
  persist(rows, index, {
    ...report,
    检测值: value,
    附加读数: [...previous, entry],
  })
  return { ok: true, message: `采样读数已附加（${person.name}），检测值更新为 ${value}，结论仍待持证复核` }
}

/** 共享：查看之外对跨单位唯一开放的动作，只记共享轨迹，不动报告数据 */
export function shareReport(id: number, operatorId: string): ActionResult {
  const person = operatorOf(operatorId)
  const loaded = loadReport(id)
  if ('ok' in loaded) return loaded
  const { rows, index, report } = loaded
  const previous = Array.isArray(report['共享记录']) ? (report['共享记录'] as string[]) : []
  persist(rows, index, {
    ...report,
    共享记录: [...previous, `${todayLabel()} ${person.unit}·${person.name} 调阅共享`],
  })
  return {
    ok: true,
    message: isSameUnit(person, report)
      ? `报告已在单位内共享给 ${person.unit}`
      : `跨单位资料已共享：${person.unit} 可查看该报告（只读）`,
  }
}
