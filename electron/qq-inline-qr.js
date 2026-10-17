import axios from 'axios'
import { randomUUID } from 'node:crypto'
import { qqAccountId } from './qq-account.js'

// Official desktop scan grants served by QQ Music. Android app-switch SDKs
// cannot run on Windows; this uses the same accounts without an embedded page.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const APPID = '100497308', WX_APPID = 'wx48db31d50e334801'
const GATEWAY = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
const REDIRECT = mode => 'https://y.qq.com/portal/wx_redirect.html?login_type='+(mode === 'wechat' ? 2 : 1)+'&surl=https%3A%2F%2Fy.qq.com%2Fn%2Fryqq%2Fprofile'
const hash = (value, seed) => {let h=seed;for(const c of value)h=((h<<5)+h+c.charCodeAt(0))|0;return h&0x7fffffff}
const safeURL = value => {const u=new URL(value);if(u.protocol!=='https:'||!/(^|\.)qq\.com$/.test(u.hostname)||u.username||u.password)throw Error('官方登录重定向地址无效');return u}
const cookiePair = (name,value) => /^[\w-]+$/.test(name)&&value&&!/[;\s\x00-\x1f]/.test(value)
class LoginCookies {
    constructor(){this.entries=[]}
    put(url,lines=[]){
        const u=new URL(url)
        for(const line of [].concat(lines)){
            const [pair,...attrs]=line.split(';'),eq=pair.indexOf('=');if(eq<1)continue
            const name=pair.slice(0,eq).trim(),value=pair.slice(eq+1).trim()
            let domain=u.hostname,path='/',secure=false,hostOnly=true,expires=Infinity
            for(const attr of attrs){const [raw,...rest]=attr.trim().split('='),key=raw.toLowerCase(),v=rest.join('=');if(key==='domain'){domain=v.replace(/^\./,'').toLowerCase();hostOnly=false}else if(key==='path')path=v||'/';else if(key==='secure')secure=true;else if(key==='max-age')expires=Date.now()+Number(v)*1000;else if(key==='expires'&&expires===Infinity)expires=Date.parse(v)}
            if(domain!==u.hostname&&!u.hostname.endsWith('.'+domain))continue
            this.entries=this.entries.filter(c=>!(c.name===name&&c.domain===domain&&c.path===path))
            if(cookiePair(name,value)&&expires>Date.now())this.entries.push({name,value,domain,path,secure,hostOnly,expires})
        }
    }
    for(url){const u=new URL(url);return this.entries.filter(c=>c.expires>Date.now()&&(c.hostOnly?u.hostname===c.domain:u.hostname===c.domain||u.hostname.endsWith('.'+c.domain))&&(u.pathname===c.path||u.pathname.startsWith(c.path.endsWith('/')?c.path:c.path+'/'))&&(!c.secure||u.protocol==='https:')).sort((a,b)=>b.path.length-a.path.length).map(c=>c.name+'='+c.value).join('; ')}
    get(name,url){return this.for(url).split('; ').find(p=>p.startsWith(name+'='))?.slice(name.length+1)||''}
}
function imageData(response){const bytes=Buffer.from(response.data);let type='';if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))type='image/png';else if(bytes.subarray(0,3).toString()==='GIF')type='image/gif';else if(bytes[0]===255&&bytes[1]===216)type='image/jpeg';if(!type||bytes.length<100||bytes.length>1024*1024)throw Error('官方二维码图片未正确返回，请刷新');return 'data:'+type+';base64,'+bytes.toString('base64')}
function fields(source){
    const match=String(source).match(/^\s*ptuiCB\s*\(([^]*?)\)\s*;?\s*$/)
    if(!match)throw Error('官方扫码状态格式异常，请刷新')
    const values=[],re=/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g;let m
    while((m=re.exec(match[1])))values.push((m[1]??m[2]).replace(/\\(['"\\])/g,'$1'))
    return values
}
export class QQInlineQR {
    constructor({request=config=>axios(config),now=Date.now}={}){this.request=request;this.now=now;this.generation=0;this.context=null}
    cancel(loginId){if(loginId&&loginId!==this.context?.id)return;this.generation++;this.context?.controller.abort();this.context=null}
    current(generation){return this.context?.generation===generation&&this.generation===generation&&!this.context.controller.signal.aborted}
    async fetch(context,url,options={}){
        const captureGrant=options.captureGrant;delete options.captureGrant
        let target=safeURL(url)
        for(let redirects=0;redirects<=6;redirects++){
            if(!this.current(context.generation))throw Error('登录已取消')
            let response
            try{response=await this.request({url:target.href,method:options.data?'POST':'GET',...options,maxRedirects:0,timeout:options.timeout||15000,signal:context.controller.signal,validateStatus:()=>true,headers:{'User-Agent':UA,Referer:'https://y.qq.com/',...options.headers,...(context.cookies.for(target.href)?{Cookie:context.cookies.for(target.href)}:{})}})}catch{if(!this.current(context.generation))throw Error('登录已取消');throw Error('连接 QQ 官方登录服务失败，请检查网络后重试')}
            if(!this.current(context.generation))throw Error('登录已取消')
            context.cookies.put(target.href,response.headers?.['set-cookie'])
            if(response.status>=300&&response.status<400&&response.headers?.location){target=safeURL(new URL(response.headers.location,target).href);if(captureGrant&&target.hostname==='y.qq.com'&&target.pathname==='/portal/wx_redirect.html')return {data:{callback:target.href}};options={};continue}
            if(response.status<200||response.status>=300)throw Error('QQ 官方登录服务返回 HTTP '+response.status)
            return response
        }
        throw Error('官方登录重定向次数过多')
    }
    async create(mode='qq'){
        if(!['qq','wechat'].includes(mode))throw Error('不支持的扫码方式')
        this.cancel()
        const c={id:randomUUID(),generation:this.generation,mode,cookies:new LoginCookies(),controller:new AbortController(),expiresAt:this.now()+240000,busy:false}
        this.context=c;let image
        if(mode==='qq'){
            const page=await this.fetch(c,'https://xui.ptlogin2.qq.com/cgi-bin/xlogin?'+new URLSearchParams({appid:'716027609',daid:'383',style:'40',pt_3rd_aid:APPID,s_url:'https://graph.qq.com/oauth2.0/login_jump'}))
            c.version=String(page.data).match(/ptui_version:encodeURIComponent\("(\d+)"\)/)?.[1]||''
            if(!c.version)throw Error('QQ 官方登录协议版本无法识别')
            const result=await this.fetch(c,'https://ssl.ptlogin2.qq.com/ptqrshow?'+new URLSearchParams({appid:'716027609',e:'2',l:'M',s:'3',d:'72',v:'4',t:String(Math.random()),daid:'383',pt_3rd_aid:APPID,u1:'https://graph.qq.com/oauth2.0/login_jump'}),{responseType:'arraybuffer'})
            if(!c.cookies.get('qrsig','https://ssl.ptlogin2.qq.com/'))throw Error('QQ 未返回有效扫码会话')
            image=imageData(result)
        }else{
            const result=await this.fetch(c,'https://open.weixin.qq.com/connect/qrconnect?'+new URLSearchParams({appid:WX_APPID,redirect_uri:REDIRECT(mode),response_type:'code',scope:'snsapi_login',state:c.id,fast_login:'0'}))
            const html=String(result.data)
            c.uuid=html.match(/(?:\bG|\buuid)\s*=\s*"([a-zA-Z0-9_-]+)"/)?.[1]||html.match(/connect\/qrcode\/([a-zA-Z0-9_-]+)/)?.[1]
            if(!c.uuid)throw Error('微信未返回有效扫码会话')
            c.pollOrigin=/window\.usenewdomain\s*=\s*(?:true|1)/.test(html)?'https://lp.open.weixin.qq.com':'https://long.open.weixin.qq.com'
            image=imageData(await this.fetch(c,'https://open.weixin.qq.com/connect/qrcode/'+c.uuid,{responseType:'arraybuffer'}))
        }
        if(!this.current(c.generation))throw Error('登录已取消')
        return {code:0,data:{loginId:c.id,mode,image,expiresAt:c.expiresAt}}
    }
    async exchange(c,code){
        if(c.mode==='qq')c.cookies.put(GATEWAY,['login_type=1; Domain=qq.com; Path=/; Secure'])
        const req=c.mode==='qq'?{module:'QQConnectLogin.LoginServer',method:'QQLogin',param:{code}}:{module:'music.login.LoginServer',method:'Login',param:{strAppid:WX_APPID,code}}
        const response=await this.fetch(c,GATEWAY,{data:JSON.stringify({comm:{g_tk:hash(c.cookies.get('p_skey',GATEWAY)||c.cookies.get('skey',GATEWAY),5381),platform:'yqq',ct:24,cv:0,...(c.mode==='wechat'?{tmeAppID:'qqmusic',tmeLoginType:'1'}:{})},req}),headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:'https://y.qq.com',Referer:REDIRECT(c.mode)}})
        let body=response.data;if(typeof body==='string'){try{body=JSON.parse(body)}catch{}}
        if(body?.code!==0||body?.req?.code!==0||(body.req.subcode!==undefined&&body.req.subcode!==0)||!body.req.data||Array.isArray(body.req.data))throw Error('QQ 音乐未接受扫码授权，请刷新二维码重试')
        let data=body.req.data
        const pairs=new Map(c.cookies.for(GATEWAY).split('; ').filter(Boolean).map(pair=>{const i=pair.indexOf('=');return [pair.slice(0,i),pair.slice(i+1)]}))
        const identity=data.str_musicid||(typeof data.musicid==='string'||Number.isSafeInteger(data.musicid)?data.musicid:'')
        const uin=String(identity||qqAccountId(c.cookies.for(GATEWAY)))
        if(data.musickey&&/^[1-9]\d{0,19}$/.test(uin)&&cookiePair('musickey',data.musickey))for(const [name,value] of [['uin',uin],['qqmusic_uin',uin],['qqmusic_key',data.musickey],['qm_keyst',data.musickey]])pairs.set(name,value)
        let cookie=[...pairs].map(([name,value])=>name+'='+value).join('; ')
        if(!/(?:^|;\s*)(?:qqmusic_key|qm_keyst)=([^;]+)/.test(cookie))throw Error('扫码授权缺少音乐播放凭据，请重新扫码')
        if(!/^[1-9]\d{0,19}$/.test(uin))throw Error('扫码授权缺少有效音乐账号，请重新扫码')
        pairs.set('login_type',c.mode==='wechat'?'2':'1');cookie=[...pairs].map(([name,value])=>name+'='+value).join('; ')
        return {cookie,uin,qrGeneration:c.generation}
    }
    async qqCode(c,redirect){
        const url=safeURL(redirect)
        if(!/(^|\.)ptlogin2\.qq\.com$/.test(url.hostname))throw Error('QQ 返回的扫码跳转域名无效')
        await this.fetch(c,url.href)
        const authorize=new URLSearchParams({response_type:'code',client_id:APPID,redirect_uri:REDIRECT('qq'),scope:'get_user_info,get_app_friends',state:c.id,from_ptlogin:'1',src:'1',update_auth:'1',openapi:'1010_1030',g_tk:String(hash(c.cookies.get('p_skey','https://graph.qq.com/'),5381)),auth_time:String(this.now()),ui:randomUUID()})
        const response=await this.fetch(c,'https://graph.qq.com/oauth2.0/authorize',{captureGrant:true,data:authorize.toString(),headers:{'Content-Type':'application/x-www-form-urlencoded'}})
        const source=typeof response.data==='string'?response.data:JSON.stringify(response.data)
        let callback
        try{callback=typeof response.data==='object'?response.data.callback:JSON.parse(source.match(/\{[^]*\}/)?.[0]||'{}').callback}catch{}
        callback=callback||source.match(/["']callback["']\s*:\s*["']([^"']+)/)?.[1]||source.match(/https:\/\/y\.qq\.com\/portal\/wx_redirect\.html[^"'<>\s]*/)?.[0]
        if(!callback)throw Error('QQ 授权未返回音乐登录码，请重新扫码')
        const grant=safeURL(callback.replace(/&amp;/g,'&').replace(/\\\//g,'/'))
        if(grant.hostname!=='y.qq.com'||grant.pathname!=='/portal/wx_redirect.html'||grant.searchParams.get('state')!==c.id)throw Error('QQ 授权回调不匹配')
        const code=grant.searchParams.get('code')
        if(!code||code.length>4096)throw Error('QQ 授权码无效')
        return code
    }
    async check(loginId){
        const c=this.context
        if(!c||c.id!==loginId||!this.current(c.generation))return {code:0,status:'cancelled',message:'登录已取消'}
        if(c.expiresAt<=this.now()){this.cancel();return {code:0,status:'expired',message:'二维码已过期，请刷新'}}
        if(c.busy)return {code:0,status:'waiting',message:'正在确认扫码状态…'}
        if(c.completed)return {code:0,status:'confirmed',data:c.completed}
        c.busy=true
        try{
            let code,status,message
            if(c.mode==='qq'){
                const query=new URLSearchParams({u1:'https://graph.qq.com/oauth2.0/login_jump',ptqrtoken:String(hash(c.cookies.get('qrsig','https://ssl.ptlogin2.qq.com/'),0)),ptredirect:'1',h:'1',t:'1',g:'1',from_ui:'1',ptlang:'2052',action:'0-0-'+this.now(),js_ver:c.version,js_type:'1',login_sig:c.cookies.get('pt_login_sig','https://ssl.ptlogin2.qq.com/'),pt_uistyle:'40',aid:'716027609',daid:'383',pt_3rd_aid:APPID})
                const response=await this.fetch(c,'https://ssl.ptlogin2.qq.com/ptqrlogin?'+query)
                const values=fields(response.data);status=values[0]
                if(status==='0')code=await this.qqCode(c,values[2])
                else if(status==='65'){this.cancel(c.id);return {code:0,status:'expired',message:'二维码已过期，请刷新'}}
                else if(!['66','67'].includes(status))throw Error('QQ 未确认扫码授权，请重新扫码')
                message=status==='67'?'已扫码，请在手机 QQ 确认登录':'请使用手机 QQ 扫码'
            }else{
                const response=await this.fetch(c,c.pollOrigin+'/connect/l/qrconnect?'+new URLSearchParams({uuid:c.uuid,...(c.last?{last:c.last}:{})}),{timeout:32000})
                const source=String(response.data);status=source.match(/wx_errcode\s*=\s*(\d+)/)?.[1]
                if(!status)throw Error('微信扫码状态格式异常，请刷新')
                if(status==='405'){code=source.match(/wx_code\s*=\s*["']([a-zA-Z0-9_-]+)["']/)?.[1];if(!code)throw Error('微信未返回有效授权码')}
                else if(['402','500'].includes(status)){this.cancel(c.id);return {code:0,status:'expired',message:'二维码已过期，请刷新'}}
                else if(status==='403'){this.cancel(c.id);return {code:0,status:'cancelled',message:'已在微信取消授权，请刷新重试'}}
                else if(!['404','408'].includes(status))throw Error('微信未确认扫码授权，请刷新重试')
                c.last=status;message=status==='404'?'已扫码，请在微信中确认登录':'请使用微信扫一扫'
            }
            if(code){const data=await this.exchange(c,code);if(!this.current(c.generation))throw Error('登录已取消');c.completed=data;return {code:0,status:'confirmed',data}}
            return {code:0,status:['67','404'].includes(status)?'scanned':'waiting',message}
        }finally{c.busy=false}
    }
}
