import { defineStore } from 'pinia'

import { OPERATORS, operatorOf } from '@/data/authorization'

export const useSessionStore = defineStore('session', {
  state: () => ({
    // 默认以持证复核人登录，可在页面上切换为采样人员、跨单位复核人验证校验点。
    operatorId: OPERATORS[0].id,
    shiftLabel: '白班 08:00-20:00',
    scope: '水文监测站网管理系统',
  }),
  getters: {
    operator: (state) => operatorOf(state.operatorId),
    canOperate(): boolean {
      return this.operator.name.length > 0
    },
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setOperator(id: string) {
      this.operatorId = id
    },
  },
})
