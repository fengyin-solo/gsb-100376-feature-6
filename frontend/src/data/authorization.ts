/**
 * 受控授权目录：授权按「检测项目」逐项发放，凭证编号与项目、所属单位、有效期绑定。
 * 纯前端演示用：换成后端时，这里的查询对应「人员授权台账」接口，页面与业务服务不用改。
 */

export type OperatorRole = 'reviewer' | 'sampler'

export type Grant = {
  /** 检测项目授权编号：签发结论时必须填写/核验的凭证号 */
  credentialNo: string
  /** 授权覆盖的检测项目（与水质报告的「检测项目」严格匹配） */
  item: string
  /** 授权发放单位：只可签发本单位资料，跨单位仅查看与共享 */
  unit: string
  /** 有效期至（含当天），到期后该项目自动转为只读 */
  expireAt: string
}

export type Operator = {
  id: string
  name: string
  title: string
  role: OperatorRole
  unit: string
  grants: Grant[]
}

export const OPERATORS: Operator[] = [
  {
    id: 'p-liqing',
    name: '李清',
    title: '水质复核工程师',
    role: 'reviewer',
    unit: '市水文中心',
    grants: [
      { credentialNo: 'WQ-COD-0101', item: '高锰酸盐指数', unit: '市水文中心', expireAt: '2027-12-31' },
      { credentialNo: 'WQ-NH3N-0102', item: '氨氮', unit: '市水文中心', expireAt: '2027-12-31' },
      // 总磷授权已于 2026-08-31 到期：当前日期 2026-10-04，命中「到期转只读」
      { credentialNo: 'WQ-TP-0103', item: '总磷', unit: '市水文中心', expireAt: '2026-08-31' },
    ],
  },
  {
    id: 'p-wanglei',
    name: '王磊',
    title: '城东采样站采样员',
    role: 'sampler',
    unit: '市水文中心',
    grants: [],
  },
  {
    id: 'p-zhaomin',
    name: '赵敏',
    title: '流域水质复核工程师',
    role: 'reviewer',
    unit: '省流域监测中心',
    grants: [
      { credentialNo: 'WQ-COD-0201', item: '高锰酸盐指数', unit: '省流域监测中心', expireAt: '2027-06-30' },
    ],
  },
]

export function operatorOf(id: string): Operator {
  return OPERATORS.find((person) => person.id === id) ?? OPERATORS[0]
}

export function isExpired(grant: Grant, today: Date = new Date()): boolean {
  const expire = new Date(`${grant.expireAt}T23:59:59`)
  return today.getTime() > expire.getTime()
}

export type GrantState = 'valid' | 'expired'

export function grantState(grant: Grant): GrantState {
  return isExpired(grant) ? 'expired' : 'valid'
}

/** 找到该项目下本人的授权（不论是否到期），用于区分「未授权」与「授权到期」 */
export function findGrant(person: Operator, item: string): Grant | undefined {
  return person.grants.find((grant) => grant.item === item && grant.unit === person.unit)
}

/** 有效授权：项目匹配且未到期；到期授权自动降为只读，不返回 */
export function effectiveGrant(person: Operator, item: string): Grant | undefined {
  const grant = findGrant(person, item)
  return grant && !isExpired(grant) ? grant : undefined
}

/** 资料归属判断：缺「所属单位」的是历史报告，按本单位历史资料兼容处理 */
export function isSameUnit(person: Operator, row: { [field: string]: unknown }): boolean {
  const ownerUnit = row['所属单位']
  return ownerUnit === undefined || ownerUnit === '' || ownerUnit === person.unit
}
