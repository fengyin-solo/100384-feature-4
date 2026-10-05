/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

/** 清理轨道动作弹窗收集的落库信息：每个阶段都要落清操作人、完成时间、遗留问题。 */
export type CleaningActionDetail = {
  operator: string
  finishedAt: string
  leftover: string
  /** 完成测绘阶段：现场测量结论与室内复核结论，冲突时以室内复核结论为准。 */
  fieldConclusion: string
  reviewConclusion: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
