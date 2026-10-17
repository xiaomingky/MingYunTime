import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'

// Execute the production loader against controlled responses. No account writes
// or network requests are made by this suite.
const source=readFileSync(new URL('../src/views/PlaylistDetail.vue',import.meta.url),'utf8')
const loader=source.slice(source.indexOf('const fetchComments = async'),source.indexOf('\nwatch(() => userStore.revision'))
let responder
const ref=value=>({value})
const ctx=vm.createContext({playlist:ref({id:1}),userStore:{revision:1},comments:ref([]),playlistCommentsCount:ref(0),commentsLoading:ref(false),commentsError:ref(''),getCommentPlaylist:(...args)=>responder(...args)})
vm.runInContext(`let commentRevision=0;${loader};globalThis.load=fetchComments;globalThis.cancel=()=>commentRevision++;`,ctx)
let checks=0
const ok=(value,label)=>{assert.ok(value,label);checks++}
responder=async()=>({code:200,hotComments:[],comments:[{commentId:1,content:'Latest'}],total:23})
await ctx.load()
ok(ctx.comments.value[0].content==='Latest'&&ctx.playlistCommentsCount.value===23,'empty hot comments must not hide ordinary comments')
responder=async()=>({code:200,hotComments:[{commentId:2,content:'Hot'}],comments:[{commentId:1}],total:23})
await ctx.load();ok(ctx.comments.value[0].content==='Hot','nonempty hot comments remain supported')
responder=async()=>({code:200,comments:[],total:0});await ctx.load()
ok(ctx.comments.value.length===0&&!ctx.commentsError.value&&!ctx.commentsLoading.value,'a genuine empty result stays distinct from a failure')
responder=async()=>{throw Error('upstream unavailable')};await ctx.load()
ok(ctx.commentsError.value==='upstream unavailable'&&!ctx.commentsLoading.value,'failed reads expose an error for the retry UI')
responder=async()=>({code:403,message:'denied'});await ctx.load()
ok(ctx.commentsError.value==='denied','non-success responses are not presented as empty comments')
responder=async()=>({code:200,total:1});await ctx.load()
ok(!!ctx.commentsError.value,'malformed success payload is rejected')
let resolve
responder=()=>new Promise(r=>resolve=r)
let pending=ctx.load();ctx.playlist.value={id:2};resolve({code:200,comments:[{commentId:99}],total:1});await pending
ok(ctx.comments.value.length===0,'an old playlist response cannot populate the next playlist')
pending=ctx.load();ctx.cancel();ctx.commentsLoading.value=true;resolve({code:200,comments:[{commentId:99}],total:1});await pending
ok(ctx.comments.value.length===0&&ctx.commentsLoading.value,'cancelled requests cannot overwrite the new request loading state')
pending=ctx.load();ctx.userStore.revision++;resolve({code:200,comments:[{commentId:99}],total:1});await pending
ok(ctx.comments.value.length===0,'an old account response cannot populate the new account')
responder=async()=>({code:200,comments:[{commentId:3}],total:1});await ctx.load()
ok(ctx.comments.value[0].commentId===3&&!ctx.commentsError.value&&!ctx.commentsLoading.value,'retry recovers and clears the previous error')
console.log(`Playlist comment checks passed: ${checks} assertions.`)
