import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionExtra, ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 遗迹清理轨道：开始清理→完成测绘→执行解剖，状态只能按这个顺序顺向流转。
const FEATURE_KEY = 'feature'
const FEATURE_FLOW = [
  { action: '开始清理', status: '清理中' },
  { action: '完成测绘', status: '已完绘' },
  { action: '执行解剖', status: '已解剖' },
] as const

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string, extra: ActionExtra = {}): ActionResult {
  if (key === FEATURE_KEY) {
    return runFeatureAction(id, action, extra)
  }
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// 遗迹清理轨道专用流转：顺向校验 + 每段落清操作人/完成时间/遗留问题 + 测绘幂等 + 清理结束影像联动。
function runFeatureAction(id: number, action: string, extra: ActionExtra): ActionResult {
  const meta = moduleMeta(FEATURE_KEY)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const stepIndex = FEATURE_FLOW.findIndex((step) => step.action === action)
  if (stepIndex < 0) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(FEATURE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的遗迹` }
  }
  const row = rows[index]
  const current = String(row.status)

  // 清理轨道只能顺向流转：已揭露→清理中→已完绘→已解剖；已归档等其他状态不接受清理动作。
  const orderedStatuses = ['已揭露', ...FEATURE_FLOW.map((step) => step.status), '已归档']
  const currentOrder = orderedStatuses.indexOf(current)
  const targetOrder = orderedStatuses.indexOf(target)
  if (currentOrder < 0) {
    return { ok: false, message: `遗迹当前状态「${current}」不在清理轨道上，无法${action}` }
  }
  if (currentOrder >= targetOrder) {
    // 同一遗迹重复提交完成测绘只能生效一次：已完绘之后再提交直接拒绝，其余阶段同理。
    return { ok: false, message: `遗迹当前为「${current}」，「${action}」已提交过或不能逆向流转` }
  }
  if (targetOrder !== currentOrder + 1) {
    return { ok: false, message: `清理轨道只能顺向推进，请先完成「${orderedStatuses[currentOrder + 1]}」阶段` }
  }

  const operator = extra.operator?.trim() || '值班管理员'
  const finishedAt = nowText()
  const issue = extra.issue?.trim() || '无'
  const updated: EntryRow = {
    ...row,
    status: target,
    pending: target !== '已解剖' && target !== '已归档',
    abnormal: false,
  }

  if (action === '开始清理') {
    updated['清理操作人'] = operator
    updated['清理时间'] = finishedAt
    updated['清理遗留问题'] = issue
  } else if (action === '完成测绘') {
    // 测绘阶段要同时带出现场测量结论与室内复核结论；二者冲突时以室内复核结论为准，并在遗留问题里留痕。
    const fieldSurvey = extra.fieldSurvey?.trim() ?? ''
    const labReview = extra.labReview?.trim() ?? ''
    if (!fieldSurvey || !labReview) {
      return { ok: false, message: '完成测绘需同时填写现场测量结论与室内复核结论' }
    }
    const conflict = normalizeConclusion(fieldSurvey) !== normalizeConclusion(labReview)
    updated['测绘操作人'] = operator
    updated['测绘时间'] = finishedAt
    // 裁决规则：现场测量结论与室内复核结论冲突时，以室内复核结论为准（在室内复核完成、资料更齐全的前提下定）。
    updated['测绘采用结论'] = conflict ? `以室内复核为准：${labReview}` : labReview
    updated['现场测量结论'] = fieldSurvey
    updated['室内复核结论'] = labReview
    updated['测绘遗留问题'] = conflict
      ? `${issue === '无' ? '' : `${issue}；`}现场测量与室内复核结论冲突，已按室内复核「${labReview}」采用`.replace(/^；/, '')
      : issue
  } else {
    updated['解剖操作人'] = operator
    updated['解剖时间'] = finishedAt
    updated['解剖遗留问题'] = issue
  }

  const next = [...rows]
  next[index] = updated
  saveRows(FEATURE_KEY, next)

  // 清理结束（执行解剖成功）后，影像记录里必须新增一张该遗迹的待复拍事项。
  let suffix = ''
  if (action === '执行解剖') {
    suffix = appendRephotographTodo(updated)
  }
  return { ok: true, message: `遗迹已${action}，当前状态「${target}」（操作人：${operator}，完成时间：${finishedAt}）${suffix}` }
}

// 给影像记录模块追加一张「需重拍」的待复拍事项；同一遗迹已存在待复拍事项则不重复新增。
function appendRephotographTodo(feature: EntryRow): string {
  const PHOTO_KEY = 'photography'
  const photoRows = listRows(PHOTO_KEY)
  const subject = `遗迹${String(feature['遗迹编号'] ?? '')}清理结束复拍`
  const already = photoRows.some(
    (item) => String(item.status) === '需重拍' && String(item['拍摄对象'] ?? '') === subject,
  )
  if (already) {
    return '；影像记录中已有该遗迹的待复拍事项，未重复新增'
  }
  const nextId = photoRows.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
  const seq = String(nextId).padStart(4, '0')
  const todo: EntryRow = {
    id: nextId,
    status: '需重拍',
    pending: true,
    abnormal: false,
    影像编号: `PHOT-${seq}`,
    拍摄对象: subject,
    拍摄类型: '清理结束复拍',
    拍摄方位: '待定',
    拍摄日期: nowText().slice(0, 10),
    摄影人员: String(feature['解剖操作人'] ?? '值班管理员'),
    存储路径: '待复拍',
    影像状态: '待复拍',
  }
  saveRows(PHOTO_KEY, [...photoRows, todo])
  return '；已在影像记录中新增一张待复拍事项'
}

function normalizeConclusion(text: string): string {
  return text.replace(/\s+/g, '')
}

function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
