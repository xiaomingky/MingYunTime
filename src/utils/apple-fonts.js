// Local font data is kept in IndexedDB, separate from account storage. Online
// fonts are loaded only after an explicit selection and retain a usable fallback.
export const appleFontPresets = [
  { value:'system', label:'系统无衬线', family:'-apple-system, "Segoe UI", "Microsoft YaHei", sans-serif' },
  { value:'serif', label:'本机宋体', family:'"Songti SC", SimSun, serif' },
  { value:'mono', label:'等宽字体', family:'ui-monospace, Consolas, monospace' },
  { value:'online-sans', label:'思源黑体 · 在线', family:'"Noto Sans SC", sans-serif', remote:'Noto Sans SC' },
  { value:'online-serif', label:'思源宋体 · 在线', family:'"Noto Serif SC", serif', remote:'Noto Serif SC' },
  { value:'online-brush', label:'马善政楷书 · 在线', family:'"Ma Shan Zheng", serif', remote:'Ma Shan Zheng' }
]
let database
const faces = new Map()
function openDatabase() {
  return database ||= new Promise((resolve,reject) => {
    const request=indexedDB.open('mingyun-lyric-fonts',1)
    request.onupgradeneeded=()=>request.result.createObjectStore('fonts',{keyPath:'value'})
    request.onsuccess=()=>resolve(request.result)
    request.onerror=()=>{database=null;reject(new Error('无法读取本地字体库'))}
  })
}
async function fontsTransaction(mode, action) {
  const db=await openDatabase()
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('fonts',mode), request=action(tx.objectStore('fonts'))
    tx.oncomplete=()=>resolve(request.result)
    tx.onerror=()=>reject(new Error('字体保存失败，请检查磁盘空间'))
    tx.onabort=()=>reject(new Error('字体操作已取消'))
  })
}
export async function listAppleFonts() {
  const fonts=await fontsTransaction('readonly',store=>store.getAll())
  return fonts.map(({data,...font})=>font)
}
export async function importAppleFont(file) {
  if(!file || !/\.(ttf|otf|woff2?)$/i.test(file.name))throw new Error('请选择 TTF、OTF、WOFF 或 WOFF2 字体文件')
  if(file.size>30*1024*1024)throw new Error('字体文件不能超过 30 MB')
  const data=await file.arrayBuffer()
  const digest=await crypto.subtle.digest('SHA-256',data)
  const hash=Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('')
  const value='local-'+hash, family='MingYunFont'+hash
  const face=await new FontFace(family,data).load()
  const font={value,label:file.name.replace(/\.[^.]+$/,'')+' · 本地',family:`"${family}"`,data}
  await fontsTransaction('readwrite',store=>store.put(font))
  document.fonts.add(face);faces.set(value,Promise.resolve())
  const {data:_,...option}=font
  return option
}
export function loadAppleFont(option) {
  if(!option)return Promise.reject(new Error('字体不存在，请重新选择'))
  if(faces.has(option.value))return faces.get(option.value)
  const pending=(async()=>{
    if(option.remote) {
      const id='apple-font-'+option.value
      if(!document.getElementById(id))await new Promise((resolve,reject)=>{
        const link=document.createElement('link');link.id=id;link.rel='stylesheet'
        link.href='https://fonts.googleapis.com/css2?family='+encodeURIComponent(option.remote)+'&display=swap'
        const timer=setTimeout(()=>{link.remove();reject(new Error('在线字体加载超时，可导入本地字体'))},15000)
        link.onload=()=>{clearTimeout(timer);resolve()}
        link.onerror=()=>{clearTimeout(timer);link.remove();reject(new Error('在线字体暂不可用，可导入本地字体'))}
        document.head.appendChild(link)
      })
      const loaded=await document.fonts.load(`400 24px "${option.remote}"`,'音乐时光 Music')
      if(!loaded.length)throw new Error('在线字体未加载完成，请重试')
    } else if(option.value.startsWith('local-')) {
      const saved=await fontsTransaction('readonly',store=>store.get(option.value))
      if(!saved?.data)throw new Error('本地字体已移除，请重新导入')
      const face=await new FontFace(option.family.replace(/"/g,''),saved.data).load()
      document.fonts.add(face)
    }
  })()
  faces.set(option.value,pending)
  pending.catch(()=>faces.delete(option.value))
  return pending
}
