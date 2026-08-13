// native-api/ncm.js
// 网易云 MV 搜索模块 - 从 electron/main.js 提取（去除 ipcMain / electron 依赖）
import axios from 'axios'

// 获取网易云 MV 搜索结果（按歌名匹配）
async function ncmMvSearch(keyword) {
  try {
    const apiBase = process.env.NCM_API_BASE || 'https://api.xiaomingky.cn'
    const res = await axios.get(`${apiBase}/cloudsearch`, {
      params: { keywords: keyword, type: 1004, timestamp: Date.now() },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://music.163.com/'
      },
      timeout: 15000,
      validateStatus: () => true
    })
    if (res.status === 200 && res.data?.code === 200) {
      const mvs = res.data?.result?.mvs || []
      return {
        success: true,
        mvs: mvs.map(m => ({
          id: m.id,
          name: m.name || '',
          artistName: m.artistName || '',
          duration: m.duration || 0,
          cover: m.cover || '',
          playCount: m.playCount || 0
        }))
      }
    }
    return { success: false, message: res.data?.msg || `HTTP ${res.status}` }
  } catch (err) {
    return { success: false, message: err.message }
  }
}

export {
  ncmMvSearch
}
