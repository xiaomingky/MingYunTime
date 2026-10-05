import { ipcMain } from 'electron'
import { esportsRequest } from './esports-service.js'

ipcMain.handle('esports:request', async (_event, { operation, params } = {}) => {
    try { return { success: true, data: await esportsRequest(operation, params) } }
    catch (error) { return { success: false, message: error.response?.status === 404 ? '该比赛的数据源暂未提供此内容' : error.message || '赛事加载失败' } }
})
