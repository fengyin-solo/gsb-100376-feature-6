/**
 * 仪器检定入口的「复核凭证」：确认合格视同签发检定结论，
 * 与水质持证复核共用同一套检测项目授权编号台账，同一授权编号只能签发一次。
 * 历史「已合格」记录没有复核凭证，照常展示，不做补录。
 */
import { consumeCredential, listRows, saveRows } from '@/data/local-store'
import { effectiveGrant, findGrant, operatorOf, type Operator } from '@/data/authorization'
import type { ActionResult, EntryRow } from '@/data/types'

export const CALIBRATION_KEY = 'calibration'

function todayLabel(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/**
 * 确认合格：检定结论的签发动作，必须登记复核凭证。
 * 仪器检定沿用检测项目授权：以仪器名称对应的检测项目核验授权编号。
 */
export function confirmCalibration(
  id: number,
  operatorId: string,
  credentialNo: string,
  opinion: string,
): ActionResult {
  const person: Operator = operatorOf(operatorId)
  const credential = credentialNo.trim()
  if (!credential) {
    return { ok: false, message: '确认合格属于结论签发，必须新增登记复核凭证（检测项目授权编号）' }
  }
  const rows = listRows(CALIBRATION_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的仪器检定记录` }
  }
  const record = rows[index]
  if (String(record.status) !== '送检中') {
    return { ok: false, message: `记录当前为「${String(record.status)}」，只有送检中的仪器可以确认合格` }
  }
  // 凭证必须是本人名下、编号一致且在有效期内的授权
  const item = String(record['仪器名称'] ?? '')
  const grant = person.grants.find((candidate) => candidate.credentialNo === credential)
  if (!grant) {
    return { ok: false, message: `复核凭证 ${credential} 不在 ${person.name} 名下，不能冒用他人授权签发` }
  }
  if (grant.item !== item) {
    return {
      ok: false,
      message: `复核凭证 ${credential} 授权项目为「${grant.item}」，与检定仪器「${item}」不匹配，受控授权按项目划分`,
    }
  }
  if (!effectiveGrant(person, item) || findGrant(person, item)?.credentialNo !== credential) {
    return { ok: false, message: `复核凭证 ${credential} 已过有效期（至 ${grant.expireAt}），到期自动转为只读` }
  }
  const ownerRef = `CALI-${id}`
  const consumed = consumeCredential(credential, ownerRef)
  if (!consumed.ok) {
    return {
      ok: false,
      message: `复核凭证 ${credential} 已在 ${consumed.ownerRef} 上签发生效，同一授权编号并发/重复签发只生效一次`,
    }
  }
  const updated = [...rows]
  updated[index] = {
    ...record,
    status: '已合格',
    pending: false,
    abnormal: false,
    检定结论: opinion.trim() || '检定合格',
    复核凭证: credential,
    签发人: person.name,
    签发时间: todayLabel(),
  }
  saveRows(CALIBRATION_KEY, updated)
  return { ok: true, message: `复核凭证 ${credential} 已登记并消耗，检定结论由 ${person.name} 签发为「已合格」` }
}
