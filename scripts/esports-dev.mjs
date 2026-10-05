import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { esportsRequest } from '../electron/esports-service.js'
import fs from 'node:fs/promises'
const samples = JSON.parse(await fs.readFile('preview/esports/live-check.json','utf8'))

const server = await createServer({
    configFile:false, root:process.cwd(), plugins:[vue(), {
        name:'esports-development',
        configureServer(server) {
            server.middlewares.use('/__esports_api', async (req,res) => {
                try {
                    const url = new URL(req.url,'http://localhost')
                    const operation = url.searchParams.get('operation'), params = JSON.parse(url.searchParams.get('params') || '{}')
                    let data
                    if (url.searchParams.has('fixture')) {
                        const game = params.game || 'csgo'
                        let key = `${game}-${operation}`
                        if (operation === 'ranking') key = params.kind === 'player' ? 'csgo-players' : game==='csgo' && params.source==='vrs' ? 'csgo-vrs-ranking' : `${game}-ranking`
                        if (operation === 'event-stats') key += `-${params.kind}`
                        if (operation === 'detail' && params.id === samples[`${game}-live-detail`]?.match?.mc_info?.id) key = `${game}-live-detail`
                        data = samples[key] || {items:[]}
                    } else data = await esportsRequest(operation,params)
                    res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({success:true,data}))
                } catch(error) { res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:false,message:error.message})) }
            })
            server.middlewares.use('/__esports', async (_req,res) => {
                res.setHeader('Content-Type','text/html; charset=utf-8')
                res.end(await server.transformIndexHtml('/__esports.html',`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"></div><script type="module">
                import {createApp,h} from 'vue';import {createPinia} from 'pinia';import {createRouter,createWebHashHistory,RouterView} from 'vue-router';
                import Esports from '/src/views/Esports.vue';import EsportsMatch from '/src/views/EsportsMatch.vue';import EsportsEvent from '/src/views/EsportsEvent.vue';import '/src/style.css';
                window.bridge={invoke:async(channel,{operation,params})=>{window.calls.push({operation,params,time:Date.now()});return (await fetch('/__esports_api?operation='+encodeURIComponent(operation)+'&params='+encodeURIComponent(JSON.stringify(params))+(location.search.includes('fixture')?'&fixture=1':''))).json()},send:()=>{}};window.calls=[];
                window.router=createRouter({history:createWebHashHistory(),routes:[{path:'/entertainment',component:Esports},{path:'/entertainment/:game/match/:matchId',component:EsportsMatch},{path:'/entertainment/:game/event/:eventId',component:EsportsEvent},{path:'/:pathMatch(.*)*',redirect:'/entertainment'}]});
                const app=createApp({render:()=>h(RouterView)});app.use(createPinia());app.use(window.router);app.mount('#app');window.ready=true;
                </script></body></html>`))
            })
        }
    }], server:{host:'127.0.0.1',port:Number(process.env.ESPORTS_DEV_PORT)||5176,strictPort:true},build:{target:'chrome108'}
})
await server.listen();server.printUrls()
