// Run with electron; isolated Vue fixture, no accounts or external video sources.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mingyun-episodes-'))
app.setPath('userData', path.join(temp, 'profile'))
let win
app.whenReady().then(async () => {
    const setup = () => {
        const episodes = Array.from({ length: 40 }, (_, i) => ({ cid: i + 1, title: '第' + (i + 1) + '集 这是一个需要完整展示的长标题' }))
        const state = reactive({ open: true, episodes, currentEpisode: episodes[2], title: '统一视频选集抽屉', cover: '', localMode: false })
        window.fixture = { state, selected: null }
        createApp({ setup: () => () => h(Drawer, { ...state, onClose: () => { state.open = false }, onSelect: ep => { window.fixture.selected = ep.cid || ep.path; state.currentEpisode = ep } }) }).mount('#app')
    }
    const entry = "import {createApp,h,reactive} from 'vue';import Drawer from " + JSON.stringify(path.join(root, 'src/components/VideoEpisodeDrawer.vue').replaceAll('\\', '/')) + ';(' + setup.toString() + ')()'
    const html = path.join(temp, 'index.html'), output = path.join(temp, 'site')
    fs.writeFileSync(html, '<!doctype html><style>body{margin:0;background:#101215}#app{position:relative;width:800px;height:450px}</style><div id="app"></div><script type="module" src="/fixture.js"></script>')
    const build = `const {build}=await import('vite');const {default:vue}=await import('@vitejs/plugin-vue');await build({configFile:false,root:${JSON.stringify(temp)},base:'./',logLevel:'error',resolve:{alias:{vue:${JSON.stringify(require.resolve('vue/dist/vue.runtime.esm-bundler.js'))}}},plugins:[vue(),{name:'fixture',resolveId(id){if(id==='/fixture.js')return '\\0fixture'},load(id){if(id==='\\0fixture')return ${JSON.stringify(entry)}}}],build:{outDir:${JSON.stringify(output)},rollupOptions:{input:${JSON.stringify(html)}}}})`
    execFileSync('node', ['--input-type=module', '-e', build], { cwd: root, stdio: 'inherit', windowsHide: true, timeout: 60000 })
    win = new BrowserWindow({ show: false, width: 850, height: 520, webPreferences: { backgroundThrottling: false } })
    const js = expression => win.webContents.executeJavaScript(expression, true)
    const tick = () => new Promise(r => setTimeout(r, 450))
    win.showInactive()
    await win.loadFile(path.join(output, 'index.html'))
    await win.webContents.insertCSS('* { transition: none !important; animation: none !important; }')
    await tick()
    assert.equal(await js('document.querySelectorAll(".ved-item").length'), 40)
    assert.equal(await js('document.querySelectorAll(".ved-item.active").length'), 1, 'missing paths must not mark all online episodes as active')
    assert.ok(await js('document.querySelector(".ved-heading").textContent.includes(fixture.state.title)'))
    for (const count of [1, 2, 3]) {
        await js(`document.querySelectorAll('.ved-columns button')[${count - 1}].click()`)
        await tick()
        assert.equal(await js('getComputedStyle(document.querySelector(".ved-list")).gridTemplateColumns.split(" ").length'), count)
        assert.ok(await js('document.querySelector(".ved-list").scrollHeight > document.querySelector(".ved-list").clientHeight'), 'list scrolls within drawer')
    }
    fs.writeFileSync(path.join(root, 'dev/video-episode-drawer.png'), (await win.webContents.capturePage()).toPNG())
    await js('document.querySelectorAll(".ved-item")[5].click()')
    await tick()
    assert.equal(await js('fixture.selected'), 6)
    assert.equal(await js('!!document.querySelector(".ved-panel")'), false)
    await js(`fixture.state.localMode=true;fixture.state.episodes=[{path:'a',title:'同名视频'},{path:'b',title:'同名视频'}];fixture.state.currentEpisode=fixture.state.episodes[1];fixture.state.open=true;document.querySelector('#app').style.width='400px';document.querySelector('#app').style.height='225px'`)
    await tick()
    assert.equal(await js('document.querySelectorAll(".ved-item.active").length'), 1)
    assert.ok(await js(`(()=>{const r=document.querySelector('.ved-panel').getBoundingClientRect();return r.right<=400.5 && r.top===0 && r.bottom<=225.5})()`), 'compact drawer stays within player')
    assert.ok(await js('document.querySelectorAll(".ved-cover svg").length >= 2'), 'missing covers have placeholders')
    await js(`document.querySelector('.ved-backdrop').click()`)
    await tick()
    assert.equal(await js('fixture.state.open'), false)
    console.log('Video episode drawer: online/local selection, duplicate titles, 1/2/3 columns, scroll, compact bounds, covers and close passed')
}).then(() => { win?.destroy(); app.quit() }).catch(error => { console.error(error); win?.destroy(); app.exit(1) })
