import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

// Read the extracted evidence and existing coverage without changing either.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, 'docs/api-review')
const platforms = { qishui: '汽水音乐', qq: 'QQ 音乐', netease: '网易云音乐', kugou: '酷狗概念版' }
const kinds = { 'http-declaration': 'HTTP 声明', 'rpc-pair': 'RPC 配对', 'path-literal': '路径候选', 'url-literal': 'URL 候选', 'rpc-module-literal': 'RPC 模块候选' }
const statuses = { connected: '已映射实现', 'contract-research-pending': '声明合约待研究', 'candidate-review-pending': '字符串用途待核', excluded: '已排除' }
const verifications = { 'guest-live-tested': '游客实测', 'automated-tested-account-pending': '自动测试；真人账号待测', 'automated-tested-live-pending': '自动测试；真实接口待测' }
const exclusions = { advertising: '广告', telemetry: '埋点', 'crash-reporting': '崩溃上报', 'push-sdk': '推送 SDK', 'image-resource': '纯图片资源' }
const cell = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('|', '&#124;').replace(/[\r\n]+/g, ' ')
const code = value => '<code>' + cell(value).replaceAll('`', '&#96;') + '</code>'
const link = (label, file, line) => `[${cell(label)}](<${path.resolve(root, file).replaceAll('\\', '/')}${line ? ':' + line : ''}>)`
const authPattern = /passport|(?:^|[/.::_-])(?:login|logout|oauth|qrcode|qrconnect|captcha)(?:[/.::_-]|$)|login_by_|send_mobile_code|ssoLogin|willLogin|codeAuthToken|netInfoAuthToken/i
const isLogin = record => record.category === '登录与会话' || authPattern.test(record.endpoint)

function parameters(record) {
  const e = record.evidence?.[0] || {}
  const parts = (e.parameters || []).map(p => `${p.in || '参数'}:${p.name || '?'} (${p.type || '类型未恢复'}${p.nullable === true ? '，可空' : ''})`)
  if (e.bodyType) parts.push('请求体模型: ' + e.bodyType)
  if (e.bodyFields?.length) parts.push('请求体字段线索: ' + JSON.stringify(e.bodyFields))
  if (record.queryKeys?.length) parts.push('URL 查询键: ' + record.queryKeys.join(', '))
  if (e.bodySchemaStatus) parts.push('模型状态: ' + e.bodySchemaStatus)
  return parts.length ? parts.join('；') : '当前提取未恢复；回查调用方，不能猜请求方法或字段'
}

function purpose(record, coverage) {
  if (coverage.name) return coverage.name
  const e = record.evidence?.[0] || {}
  const clues = []
  if (e.signature) clues.push('声明: ' + e.signature)
  if (e.rpcMethod) clues.push('RPC 方法: ' + e.rpcMethod)
  if (e.sourceMethod) clues.push('源码方法: ' + e.sourceMethod)
  if (e.methodCandidates?.length) clues.push('邻近方法（未证实配对）: ' + e.methodCandidates.map(m => m.method).join(', '))
  return '用途待核' + (clues.length ? '；' + clues.join('；') : '')
}

function state(coverage) {
  return [statuses[coverage.status] || coverage.status, coverage.verification && (verifications[coverage.verification] || coverage.verification), coverage.contractMatch && ('契约: ' + coverage.contractMatch), coverage.implementation && ('实现: ' + coverage.implementation)].filter(Boolean).join('；')
}

function row(record, coverage) {
  const e = record.evidence?.[0]
  const method = record.kind === 'rpc-pair' ? 'RPC' : record.httpMethod && record.httpMethod !== 'UNKNOWN' ? record.httpMethod : '方法未恢复'
  return `| ${record.id} | ${cell(record.category)} / ${cell(record.family)} | ${kinds[record.kind] || cell(record.kind)} | ${code(method)} ${code(record.endpoint)} | ${cell(purpose(record, coverage))} | ${cell(parameters(record))} | ${cell(state(coverage))} | ${e ? link('源码', e.file, e.line) : '未提供'}；证据 ${record.evidence?.length || 0} 处 |`
}

const tableHeader = ['| 原 ID | 原分类 / 归属线索 | 证据 | 方法与路径 / RPC | 用途或声明线索 | 参数与模型线索（首处证据） | 当前保守映射与验证 | 源码 |', '| --- | --- | --- | --- | --- | --- | --- | --- |']
const totals = []
const excludedRows = []
const loginDocument = ['# 登录、验证与会话逐项审阅', '', '先读 [业务与登录方式概览](../API_OPERATIONS_REVIEW.md)。这里保留原“登录与会话”分类及其他分类中命中登录关键词的记录，包含主登录、验证、会话和归属待核项。关键词筛选会包含 AI 聊天 session、音乐人 author、视频权限、上传授权等误分线索，不能把本表条数当成登录方式数量。', '', '汽水通用字节账号 SDK、网易 URS、QQ/微信/微博授权 SDK 和运营商 SDK 的存在，仅证明 APK 包含相应线索。是否由音乐业务启用、参数、签名和桌面适用性仍需恢复与测试。Cookie 是项目已有凭据导入方式，官方 Web 补充实现另见概览，不伪造为 APK 原始接口。', '', '状态沿用现有覆盖账本；“未映射”不等于没有功能，“已映射”不等于真人账号已验收。这里只做静态审阅，不执行登录或发送验证码。', '']

fs.mkdirSync(output, { recursive: true })
const sourceFiles = new Map()
for (const [platform, name] of Object.entries(platforms)) {
  const sourcePath = `反编译/api-analysis/${platform}-api.json`
  const original = JSON.parse(fs.readFileSync(path.join(root, sourcePath), 'utf8'))
  const ledger = JSON.parse(fs.readFileSync(path.join(root, `docs/platform-coverage/${platform}.json`), 'utf8'))
  const coverage = new Map(ledger.records.map(r => [r.id, r]))
  assert.equal(coverage.size, original.records.length, platform + ': coverage count mismatch')
  assert.equal(new Set(original.records.map(r => r.id)).size, original.records.length, platform + ': duplicate source ID')
  const retained = [], excluded = [], login = []
  for (const record of original.records) {
    const current = coverage.get(record.id)
    assert.ok(current, 'Missing coverage: ' + record.id)
    assert.equal(current.endpoint, record.endpoint, 'Stale coverage endpoint: ' + record.id)
    assert.equal(current.kind, record.kind, 'Stale coverage kind: ' + record.id)
    for (const evidence of record.evidence || []) {
      assert.ok(evidence.file, 'Missing evidence file: ' + record.id)
      if (!sourceFiles.has(evidence.file)) sourceFiles.set(evidence.file, fs.existsSync(path.resolve(root, evidence.file)))
      assert.ok(sourceFiles.get(evidence.file), 'Missing source: ' + evidence.file)
      assert.ok(Number.isInteger(evidence.line) && evidence.line > 0, 'Invalid source line: ' + record.id)
    }
    if (current.status === 'excluded') excluded.push(record)
    else {
      retained.push(record)
      if (isLogin(record)) login.push(record)
    }
  }
  const categories = [...new Set(retained.map(r => r.category))]
  const counts = categories.map(category => ({ category, total: original.records.filter(r => r.category === category).length, retained: retained.filter(r => r.category === category).length }))
  const declared = original.records.filter(r => ['http-declaration', 'rpc-pair'].includes(r.kind)).length
  const stats = { platform, name, total: original.records.length, declared, retained: retained.length, excluded: excluded.length, mapped: retained.filter(r => coverage.get(r.id).status === 'connected').length, loginCandidates: login.length, categories: counts }
  totals.push(stats)
  const lines = [`# ${name}：逐条 API 与候选操作`, '', `原始记录 ${stats.total} 条；HTTP/RPC 明确声明 ${declared} 条；现有账本排除 ${stats.excluded} 条；其余 ${stats.retained} 条保留审阅，其中 ${stats.mapped} 条有保守实现映射。以上均为提取记录数，不是独立业务功能数量。`, '', `原始证据与全部模型：${link(platform + '-api.json', sourcePath)}。每条用原 ID 检索；表格展示首个证据，其他证据仍完整保存在原 JSON。`, '', '[返回概览](../API_OPERATIONS_REVIEW.md) · [登录逐项表](LOGIN-OPERATIONS.md) · [已排除项](EXCLUDED-RECORDS.md)', '', '“原分类”由旧提取器生成，可能误分；资源目录、网页、文件系统路径、SDK 常量也可能混在候选中，仍需核用途。只有 HTTP 声明/RPC 明确配对能作为已恢复操作的较强证据，不能把普通路径默认成 GET。已排除项沿用现有保守账本，尚未识别出的资源/SDK不自动变为待开发功能。', '', '| 原分类 | 提取记录 | 保留审阅 |', '| --- | ---: | ---: |', ...counts.map(c => `| ${c.category} | ${c.total} | ${c.retained} |`), '']
  for (const category of categories) {
    lines.push(`## ${category}`, '', ...tableHeader)
    for (const r of retained.filter(r => r.category === category)) lines.push(row(r, coverage.get(r.id)))
    lines.push('')
  }
  const renderedIds = lines.filter(line => line.startsWith(`| ${platform}-`)).map(line => line.split(' | ')[0].slice(2))
  assert.deepEqual([...renderedIds].sort(), retained.map(r => r.id).sort(), platform + ': rendered records incomplete')
  fs.writeFileSync(path.join(output, platform + '.md'), lines.join('\n') + '\n')
  loginDocument.push(`## ${name}（${login.length} 条候选记录）`, '', ...tableHeader, ...login.map(r => row(r, coverage.get(r.id))), '')
  for (const r of excluded) {
    const current = coverage.get(r.id), e = r.evidence?.[0]
    excludedRows.push(`| ${r.id} | ${name} | ${cell(exclusions[current.exclusion] || current.exclusion)} | ${code(r.endpoint)} | ${e ? link('源码', e.file, e.line) : '未提供'} |`)
  }
  assert.equal(retained.length + excluded.length, original.records.length)
}
fs.writeFileSync(path.join(output, 'LOGIN-OPERATIONS.md'), loginDocument.join('\n') + '\n')
fs.writeFileSync(path.join(output, 'EXCLUDED-RECORDS.md'), ['# 已有账本明确排除的记录', '', '按用户此前指定的范围排除：广告、埋点、崩溃上报、推送 SDK 和纯图片资源。沿用已有保守规则，未将“其他”分类整体排除。候选表中如仍混有资源或 SDK，需继续核用途，不能承诺全部变为产品功能。', '', '| 原 ID | 平台 | 已有排除理由 | 原路径 | 源码 |', '| --- | --- | --- | --- | --- |', ...excludedRows, ''].join('\n'))
const summary = { generatedFrom: 'APK extraction + existing conservative platform coverage; no live requests', totals, totalRecords: totals.reduce((a, t) => a + t.total, 0), retainedRecords: totals.reduce((a, t) => a + t.retained, 0), excludedRecords: excludedRows.length, verifiedSourceFiles: sourceFiles.size }
assert.equal(summary.totalRecords, summary.retainedRecords + summary.excludedRecords)
fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify(summary, null, 2))
