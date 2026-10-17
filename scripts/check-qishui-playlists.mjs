import assert from 'node:assert/strict'
import {canManageQishuiPlaylist as can} from '../src/utils/qishui-playlists.js'
const owned = {id:'90071992547409971',type:2,ownerId:'90071992547409973'}
const account = {isLoggedIn:true,profile:{userId:'90071992547409973'},playlists:[owned]}
assert.ok(can(owned,account))
assert.ok(!can(owned,{...account,isLoggedIn:false}))
assert.ok(!can(owned,{...account,profile:null}))
assert.ok(!can({...owned,ownerId:'90071992547409974'},account))
assert.ok(!can({...owned,type:1},account))
assert.ok(!can({...owned,type:4},account))
assert.ok(!can({...owned,type:undefined},account))
assert.ok(!can({...owned,id:''},account))
assert.ok(can({id:owned.id,type:2},account))
assert.ok(!can({id:'unknown',type:2},account))
assert.ok(can({id:3,type:'2',ownerId:123},{isLoggedIn:true,profile:{userId:'123'}}))
assert.ok(!can({id:owned.id,type:2},{...account,playlists:[]}))
assert.ok(can({...owned,type:3},account))
assert.ok(can({...owned,type:'3'},account))
assert.ok(!can({...owned,type:3,ownerId:'another'},account))
assert.ok(can({id:owned.id,type:3},account))
console.log('Qishui playlist ownership checks passed: 16 assertions; native custom type3, legacy type2, account isolation, 64-bit IDs and detail fallback.')
