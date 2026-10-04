/**
 * 持证复核的授权模型：人员、检测项目授权编号、单位归属都在这里登记。
 * 纯前端演示版写死在代码里；换回后端时这层对应「人员-授权证书」接口，页面不用改。
 */

export type OperatorRole = 'sampler' | 'analyst' | 'reviewer'

export type CredentialModule = 'waterquality' | 'calibration'

export type Operator = {
  id: string
  name: string
  role: OperatorRole
  /** 所属管理单位：报告只认归属本单位的改动，外单位只能查看并共享。 */
  unit: string
}

export type Credential = {
  /** 检测项目授权编号，签发结论时必须填写并核验。 */
  code: string
  operatorId: string
  module: CredentialModule
  /** 受控授权按检测项目划分：水质为检测项目，仪器检定统一为「仪器检定」。 */
  scopes: string[]
  unit: string
  validFrom: string
  validTo: string
}

export const ROLE_LABEL: Record<OperatorRole, string> = {
  sampler: '采样站点人员',
  analyst: '检测分析人员',
  reviewer: '持证复核人员',
}

export const MODULE_SCOPE_LABEL: Record<CredentialModule, string> = {
  waterquality: '水质检测',
  calibration: '仪器检定',
}

// 演示账号：在页面顶栏切换即可验证不同身份的校验结果。
export const OPERATORS: Operator[] = [
  { id: 'chenlan', name: '陈岚', role: 'reviewer', unit: '市水文水资源检测站' },
  { id: 'liwen', name: '李雯', role: 'analyst', unit: '市水文水资源检测站' },
  { id: 'wangke', name: '王珂', role: 'sampler', unit: '市水文水资源检测站' },
  { id: 'zhaolei', name: '赵磊', role: 'reviewer', unit: '流域水环境监测中心' },
]

// 授权台账：注意陈岚的氨氮授权已到期（用于演示到期降级为查看），
// 赵磊持外单位授权（用于演示跨单位只能查看并共享）。
export const CREDENTIALS: Credential[] = [
  {
    code: 'WQ-PH-2026-018',
    operatorId: 'chenlan',
    module: 'waterquality',
    scopes: ['pH值'],
    unit: '市水文水资源检测站',
    validFrom: '2026-01-01',
    validTo: '2026-12-31',
  },
  {
    code: 'WQ-NH3N-2025-042',
    operatorId: 'chenlan',
    module: 'waterquality',
    scopes: ['氨氮'],
    unit: '市水文水资源检测站',
    validFrom: '2025-06-01',
    validTo: '2026-06-30',
  },
  {
    code: 'CAL-2026-007',
    operatorId: 'chenlan',
    module: 'calibration',
    scopes: ['仪器检定'],
    unit: '市水文水资源检测站',
    validFrom: '2026-01-01',
    validTo: '2027-01-01',
  },
  {
    code: 'WQ-TP-2026-113',
    operatorId: 'zhaolei',
    module: 'waterquality',
    scopes: ['总磷'],
    unit: '流域水环境监测中心',
    validFrom: '2026-01-01',
    validTo: '2026-12-31',
  },
]

export function operatorById(id: string): Operator {
  const operator = OPERATORS.find((item) => item.id === id)
  if (!operator) {
    throw new Error(`没有登记编号为 ${id} 的操作人员`)
  }
  return operator
}

export function credentialsOf(operatorId: string): Credential[] {
  return CREDENTIALS.filter((item) => item.operatorId === operatorId)
}

/** 以当天日期为准；测试里可用 globalThis.__TODAY__ 覆盖。 */
export function todayISO(): string {
  const override = (globalThis as { __TODAY__?: string }).__TODAY__
  if (override) {
    return override
  }
  return new Date().toISOString().slice(0, 10)
}

export type CredentialStatus = 'valid' | 'expired' | 'future'

export function credentialStatus(credential: Credential, today: string = todayISO()): CredentialStatus {
  if (credential.validTo < today) {
    return 'expired'
  }
  if (credential.validFrom > today) {
    return 'future'
  }
  return 'valid'
}

export function isCredentialUsable(credential: Credential, today: string = todayISO()): boolean {
  return credentialStatus(credential, today) === 'valid'
}

/** 授权编号查台账：编号不存在直接拒绝签发。 */
export function findCredential(code: string): Credential | undefined {
  const normalized = code.trim()
  return CREDENTIALS.find((item) => item.code === normalized)
}

export type SignOffCheck =
  | { ok: true; credential: Credential }
  | { ok: false; message: string }

/**
 * 签发结论的授权核验（报告数据归属的校验点）：
 * 编号存在 → 属于当前操作人 → 模块一致 → 检测项目命中 → 在有效期内 → 单位一致。
 * 授权到期不收回查看权：这里只拦签发，页面仍允许查看与共享。
 */
export function checkSignOff(params: {
  code: string
  operator: Operator
  module: CredentialModule
  scope: string
  ownerUnit: string
  today?: string
}): SignOffCheck {
  const today = params.today ?? todayISO()
  const credential = findCredential(params.code)
  if (!credential) {
    return { ok: false, message: `授权编号「${params.code.trim()}」未在检测项目授权台账中登记，不能签发结论` }
  }
  if (credential.operatorId !== params.operator.id) {
    return { ok: false, message: `授权编号 ${credential.code} 持证人为其他人员，不能冒用他人授权签发` }
  }
  if (credential.module !== params.module) {
    return { ok: false, message: `授权编号 ${credential.code} 不属于${MODULE_SCOPE_LABEL[params.module]}项目，不能跨检测类别签发` }
  }
  if (!credential.scopes.includes(params.scope)) {
    return { ok: false, message: `授权编号 ${credential.code} 的受控检测项目为「${credential.scopes.join('、')}」，不含本报告的「${params.scope}」，未授权不能签发` }
  }
  const status = credentialStatus(credential, today)
  if (status === 'expired') {
    return { ok: false, message: `授权编号 ${credential.code} 已于 ${credential.validTo} 到期，授权已转为仅查看，不能再签发结论` }
  }
  if (status === 'future') {
    return { ok: false, message: `授权编号 ${credential.code} 自 ${credential.validFrom} 才生效，当前不能签发` }
  }
  if (credential.unit !== params.ownerUnit) {
    return { ok: false, message: `本报告归属「${params.ownerUnit}」，授权编号 ${credential.code} 归属外单位「${credential.unit}」，跨单位资料只能查看并共享` }
  }
  return { ok: true, credential }
}
