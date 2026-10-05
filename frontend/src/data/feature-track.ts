import { listRows, saveRows } from '@/data/local-store'
import type { CleaningActionDetail, EntryRow } from '@/data/types'

// 清理轨道：开始清理 → 完成测绘 → 执行解剖，只能顺向流转，不可跨阶段、不可回退。
export const CLEANING_STAGES = [
  { action: '开始清理', target: '清理中', prefix: '清理' },
  { action: '完成测绘', target: '已完绘', prefix: '测绘' },
  { action: '执行解剖', target: '已解剖', prefix: '解剖' },
] as const

const FEATURE_KEY = 'feature'
const PHOTOGRAPHY_KEY = 'photography'

// 旧遗迹可能缺少「开口层位」：读侧沿用历史记录回填，找不到再标注待补，兼容历史数据。
export function normalizeFeatureRow(row: EntryRow): EntryRow {
  const raw = row['开口层位']
  const legacy = String(row['历史开口层位'] ?? '').trim()
  const opening = typeof raw === 'string' && raw.trim() !== '' ? raw : legacy
  return { ...row, 开口层位: opening || '历史记录待补' }
}

export function nowStamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function runCleaningAction(
  id: number,
  action: string,
  detail: CleaningActionDetail,
): { ok: boolean; message: string } {
  const stageIndex = CLEANING_STAGES.findIndex((item) => item.action === action)
  if (stageIndex < 0) {
    return { ok: false, message: `遗迹没有登记「${action}」这个动作` }
  }
  const stage = CLEANING_STAGES[stageIndex]

  const rows = listRows(FEATURE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的遗迹` }
  }
  const target = rows[index]

  // 同一遗迹重复提交同一阶段（含完成测绘）只能生效一次：已落账即拦回。
  if (target[`${stage.prefix}完成时间`]) {
    return { ok: false, message: `该遗迹「${stage.action}」已提交过，不能重复生效` }
  }

  const current = String(target.status)
  // 顺向门禁：开始清理要求「已揭露」，其后每一步要求正好停在上一阶段。
  const requiredCurrent = stageIndex === 0 ? '已揭露' : CLEANING_STAGES[stageIndex - 1].target
  if (current !== requiredCurrent) {
    return {
      ok: false,
      message:
        current === '已解剖'
          ? '该遗迹已完成解剖，清理轨道已走完'
          : stageIndex === 0
            ? `当前状态为「${current}」，仅「已揭露」的遗迹可以开始清理`
            : `请先完成「${CLEANING_STAGES[stageIndex - 1].action}」，阶段状态只能顺向流转`,
    }
  }

  const operator = detail.operator.trim()
  const finishedAt = detail.finishedAt.trim()
  const leftover = detail.leftover.trim()
  if (!operator || !finishedAt) {
    return { ok: false, message: `请填写${stage.action}的操作人与完成时间` }
  }

  const updated: EntryRow = {
    ...target,
    status: stage.target,
    pending: stage.target !== '已解剖',
    [`${stage.prefix}操作人`]: operator,
    [`${stage.prefix}完成时间`]: finishedAt,
    [`${stage.prefix}遗留问题`]: leftover || '无',
  }

  let message = `遗迹已${action}，当前状态「${stage.target}」`

  if (action === '完成测绘') {
    const fieldConclusion = detail.fieldConclusion.trim()
    const reviewConclusion = detail.reviewConclusion.trim()
    if (!fieldConclusion || !reviewConclusion) {
      return { ok: false, message: '完成测绘需同时填写现场测量结论与室内复核结论' }
    }
    const conflict = fieldConclusion !== reviewConclusion
    // 现场测量结论与室内复核结论冲突时，以室内复核结论为准。
    updated['现场测量结论'] = fieldConclusion
    updated['室内复核结论'] = reviewConclusion
    updated['测绘采用结论'] = reviewConclusion
    updated['测绘结论冲突'] = conflict
    if (conflict) {
      message += '；现场测量与室内复核结论冲突，已按室内复核结论采用'
    }
  }

  saveRows(FEATURE_KEY, [...rows.slice(0, index), updated, ...rows.slice(index + 1)])

  // 清理结束（执行解剖）后，影像记录中必须新增一张待复拍事项。
  if (action === '执行解剖') {
    const photo = buildReshootPhoto(updated, leftover)
    if (photo) {
      saveRows(PHOTOGRAPHY_KEY, [...listRows(PHOTOGRAPHY_KEY), photo])
      message += `；已在影像记录中新增待复拍事项「${photo.影像编号}」`
    }
  }

  return { ok: true, message }
}

// 幂等：同一遗迹已存在待复拍事项时不重复新增。
function buildReshootPhoto(feature: EntryRow, leftover: string): EntryRow | null {
  const photos = listRows(PHOTOGRAPHY_KEY)
  const featureCode = String(feature['遗迹编号'] ?? feature.id)
  const exists = photos.some(
    (row) => String(row['关联遗迹'] ?? '') === featureCode && String(row['待复拍事项'] ?? '') !== '',
  )
  if (exists) {
    return null
  }
  const nextId = photos.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  return {
    id: nextId,
    status: '需重拍',
    pending: true,
    abnormal: false,
    影像编号: `PHOT-RS-${String(nextId).padStart(4, '0')}`,
    拍摄对象: featureCode,
    拍摄类型: '清理后复拍',
    拍摄方位: '待复拍',
    拍摄日期: String(feature['解剖完成时间'] ?? ''),
    摄影人员: String(feature['解剖操作人'] ?? ''),
    存储路径: '待复拍后补录',
    影像状态: '需重拍',
    关联遗迹: featureCode,
    待复拍事项: leftover || `${featureCode} 清理结束，现场影像需复拍存档`,
  }
}
