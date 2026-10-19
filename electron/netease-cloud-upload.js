import fs from 'node:fs'
import path from 'node:path'
import { createHash, createCipheriv, randomBytes } from 'node:crypto'
import { neteaseWebRequest } from './netease-operations.js'

const nativeRoutes = new Set(['/api/cloud/upload/check', '/api/upload/cloud/info/v2', '/api/cloud/pub/v2'])
export async function cloudNativeRequest(client, route, data, cookie) {
    if (!nativeRoutes.has(route) || /[\r\n]/.test(cookie)) throw new Error('云盘请求无效')
    const cookies = Object.fromEntries(String(cookie).split(';').map(x => x.trim()).filter(x => x.includes('=')).map(x => [x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]))
    const header = { os:'pc', appver:'3.1.17.204416', osver:'Microsoft-Windows-10-Professional-build-19045-64bit', channel:'netease', versioncode:'140', resolution:'1920x1080', buildver:String(Math.floor(Date.now()/1000)), requestId:Date.now()+'_'+randomBytes(4).toString('hex'), __csrf:cookies.__csrf || '', ...(cookies.MUSIC_U ? { MUSIC_U:cookies.MUSIC_U } : {}), ...(cookies.MUSIC_A ? { MUSIC_A:cookies.MUSIC_A } : {}) }
    const json = JSON.stringify({...data, header, e_r:false})
    const digest = createHash('md5').update(`nobody${route}use${json}md5forencrypt`).digest('hex')
    const cipher = createCipheriv('aes-128-ecb', Buffer.from('e82ckenh8dichen8'), null)
    const params = Buffer.concat([cipher.update(`${route}-36cd479b6b5-${json}-36cd479b6b5-${digest}`), cipher.final()]).toString('hex').toUpperCase()
    const response = await client.request({url:'https://interfacepc.music.163.com/eapi/'+route.slice(5),method:'POST',data:new URLSearchParams({params}).toString(),timeout:30000,maxRedirects:0,headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) NeteaseMusicDesktop/3.1.17.204416',Cookie:Object.entries(header).map(([k,v])=>k+'='+v).join('; ')}})
    if (!Number.isInteger(response.data?.code)) throw new Error('网易云云盘返回无效响应')
    return response.data
}

function accepted(result, stage) {
    if (result?.code !== 200) throw new Error(`${stage}：${result?.message || result?.msg || '请求被拒绝'}（${result?.code || '响应异常'}）`)
    return result
}
export async function uploadNeteaseCloud(client, input, progress = () => {}, wait = ms => new Promise(r => setTimeout(r,ms))) {
    const {filePath, cookie, song, artist, album} = input
    if (!cookie || /[\r\n]/.test(cookie)) throw new Error('请重新登录网易云后上传')
    const filename = input.filename || path.basename(filePath)
    const stat = await fs.promises.stat(filePath)
    if (!stat.isFile() || !stat.size) throw new Error('请选择非空音乐文件')
    progress(0,'计算文件指纹...')
    const hash = createHash('md5')
    for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk)
    const md5 = hash.digest('hex')
    progress(0,'获取上传凭证...')
    const checked = accepted(await cloudNativeRequest(client,'/api/cloud/upload/check',{bitrate:'999000',ext:'',length:stat.size,md5,songId:'0',version:1},cookie),'云盘文件检查失败')
    if (![true,false,0,1].includes(checked.needUpload) || !checked.songId) throw new Error('云盘文件检查响应不完整')
    const bucket = 'jd-musicrep-privatecloud-audio-public'
    const allocation = accepted(await neteaseWebRequest(client,'/api/nos/token/alloc',{bucket,ext:path.extname(filename).slice(1)||'mp3',filename:filename.replace(/\.[^.]+$/,'').replace(/\s/g,'').replace(/\./g,'_'),local:false,nos_product:3,type:'audio',md5},cookie),'获取上传凭证失败')
    const {resourceId,token,objectKey} = allocation.result || {}
    if (!resourceId) throw new Error('上传凭证缺少资源 ID')
    if (checked.needUpload) {
        if (!token || !objectKey) throw new Error('上传凭证不完整')
        const lbs = await client.request({url:'https://wanproxy.127.net/lbs',method:'GET',params:{version:'1.0',bucketname:bucket},timeout:10000,maxRedirects:0})
        if (!lbs.data?.upload?.[0]) throw new Error('获取上传服务器地址失败')
        const host = new URL(lbs.data.upload[0])
        if (!['http:','https:'].includes(host.protocol) || !/(^|\.)127\.net$/.test(host.hostname) || host.username || host.password) throw new Error('云盘上传服务器无效')
        host.protocol='https:'
        const url = `${host.origin}/${bucket}/${encodeURIComponent(objectKey)}?offset=0&complete=true&version=1.0`
        const stream = fs.createReadStream(filePath)
        let sent=0
        stream.on('data',chunk=>{sent+=chunk.length;progress(Math.min(99,Math.round(sent/stat.size*100)),'上传中...')})
        try {
            const types={'.mp3':'audio/mpeg','.flac':'audio/flac','.ogg':'audio/ogg','.opus':'audio/ogg','.m4a':'audio/mp4','.aac':'audio/aac','.wav':'audio/wav'}
            const response = await client.request({url,method:'POST',data:stream,timeout:300000,maxRedirects:0,maxContentLength:Infinity,maxBodyLength:Infinity,headers:{'x-nos-token':token,'Content-MD5':md5,'Content-Length':String(stat.size),'Content-Type':types[path.extname(filename).toLowerCase()]||'application/octet-stream'}})
            if (response.status !== 200) throw new Error(`云存储上传失败（HTTP ${response.status}）`)
        } finally { stream.destroy() }
    }
    progress(99, checked.needUpload ? '完成导入...' : '秒传命中，完成导入...')
    let info, lastError
    for (let attempt=0;attempt<3;attempt++) {
        try {
            if (!info) info=accepted(await cloudNativeRequest(client,'/api/upload/cloud/info/v2',{md5,songid:checked.songId,filename,song:song||filename.replace(/\.[^.]+$/,''),artist:artist||'未知艺术家',album:album||'未知专辑',bitrate:'999000',resourceId},cookie),'云盘信息导入失败')
            if (!info.songId) throw new Error('云盘导入响应缺少歌曲 ID')
            accepted(await cloudNativeRequest(client,'/api/cloud/pub/v2',{songid:info.songId},cookie),'云盘发布失败')
            progress(100,'上传完成')
            return {success:true,songId:info.songId,resourceId,needUpload:!!checked.needUpload}
        } catch (error) {lastError=error;if(attempt<2) await wait(2000)}
    }
    throw lastError
}
