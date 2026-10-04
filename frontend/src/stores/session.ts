import { defineStore } from 'pinia'

import {
  credentialsOf,
  isCredentialUsable,
  operatorById,
  OPERATORS,
  ROLE_LABEL,
  todayISO,
  type Credential,
  type Operator,
} from '@/data/auth'

const SESSION_KEY = 'hydrology-monitor-station:operator-id'
const DEFAULT_OPERATOR_ID = 'chenlan'

function restoreOperatorId(): string {
  if (typeof window === 'undefined' || !window.localStorage) {
    return DEFAULT_OPERATOR_ID
  }
  const saved = window.localStorage.getItem(SESSION_KEY)
  if (saved && OPERATORS.some((item) => item.id === saved)) {
    return saved
  }
  return DEFAULT_OPERATOR_ID
}

export const useSessionStore = defineStore('session', {
  state: () => {
    const operator: Operator = operatorById(restoreOperatorId())
    return {
      operator,
      shiftLabel: '白班 08:00-20:00',
      scope: '水文监测站网管理系统',
    }
  },
  getters: {
    canOperate: (state) => state.operator.name.length > 0,
    operatorName: (state) => state.operator.name,
    operatorUnit: (state) => state.operator.unit,
    roleLabel: (state) => ROLE_LABEL[state.operator.role],
    isSampler: (state) => state.operator.role === 'sampler',
    /** 当前身份名下、今天仍有效的授权：用于页面上提示能签发哪些检测项目。 */
    activeCredentials(state): Credential[] {
      return credentialsOf(state.operator.id).filter((item) => isCredentialUsable(item, todayISO()))
    },
    expiredCredentials(state): Credential[] {
      return credentialsOf(state.operator.id).filter((item) => !isCredentialUsable(item, todayISO()))
    },
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    switchOperator(id: string) {
      this.operator = operatorById(id)
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(SESSION_KEY, id)
      }
    },
  },
})
