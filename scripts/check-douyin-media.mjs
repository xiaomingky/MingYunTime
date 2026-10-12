import assert from 'node:assert/strict'
import { extractShareUrl, extractDouyinId, extractDouyinMedia, extractDouyinPage } from '../electron/douyin-media.js'

const id = '7674192044255989034'
const share = '6.46 09/25 y@g.Bt MwS:/ 35分钟的时长！ https://v.douyin.com/WE5UOpOcnMY/ 复制此链接，打开Dou音搜索'
assert.equal(extractShareUrl(share), 'https://v.douyin.com/WE5UOpOcnMY/')
assert.equal(extractShareUrl('链接：https://www.douyin.com/video/' + id + '。'), 'https://www.douyin.com/video/' + id)
assert.equal(extractShareUrl('没有链接'), '')
for (const path of [`/video/${id}`, `/note/${id}`, `/share/slides/${id}/`, `/?modal_id=${id}`, `/?aweme_id=${id}`]) {
    assert.equal(extractDouyinId('https://www.douyin.com' + path), id)
}
assert.equal(extractDouyinId(`https://example.com/video/${id}`), '')

const video = { aweme_id: id, desc: '测试视频', video: {
    cover: { url_list: ['https://p.douyinpic.com/cover.webp'] },
    bit_rate: [
        { play_addr: { url_list: ['https://v.douyinvod.com/play-low'], width: 1280, height: 720 } },
        { play_addr: { url_list: ['https://www.douyin.com/aweme/v1/playwm/?video_id=test'], width: 1080, height: 1920 } }
    ]
} }
const result = extractDouyinMedia({ aweme_detail: video }, id)
assert.equal(result.title, '测试视频')
assert.equal(result.streams.length, 2)
assert.equal(result.streams[0].quality, '1080p')
assert.match(result.streams[0].url, /\/play\//)
assert.equal(result.streams[1].type, 'mp4', 'extensionless URLs in play_addr are playable videos')
assert.equal(extractDouyinMedia({ aweme_detail: { ...video, aweme_id: '1234567890123456789' } }, id), null)
assert.equal(extractDouyinMedia({ cover: video.video.cover }, id), null, 'a cover is not a video')

const gallery = { aweme_id: id, aweme_type: '68', desc: '图集', images: [
    { url_list: ['https://p.douyinpic.com/a~tplv-dy-water-v2.webp', 'https://p.douyinpic.com/a.webp'] },
    { display_image: { url_list: ['https://p.douyinpic.com/b.webp'] } }
], music: { play_url: { url_list: ['https://music.example.com/bgm.mp3'] } }, video: video.video }
const imageResult = extractDouyinMedia({ item_list: [gallery] }, id)
assert.deepEqual(imageResult.streams.map(s => s.type), ['image', 'image', 'mp3'])
assert.equal(imageResult.streams[0].url, 'https://p.douyinpic.com/a.webp')
assert.deepEqual(imageResult.streams[0].imageList, ['https://p.douyinpic.com/a.webp', 'https://p.douyinpic.com/b.webp'])
assert.equal(imageResult.streams[1].isImage, true)
assert.equal(extractDouyinMedia({ ...gallery, images: [] }, id), null, 'empty galleries must not return BGM as video')
const camel = { awemeId: id, desc: 'camel', imagePostInfo: { images: [{ displayImage: { urlList: ['https://p.douyinpic.com/c.webp'] } }] } }
assert.equal(extractDouyinMedia(camel, id).streams[0].type, 'image')
assert.equal(extractDouyinMedia({ awemeId: id, video: { playAddr: { urlList: ['https://cdn.example.com/play'] } } }, id).streams[0].type, 'mp4')

const data = { loaderData: { 'video_(id)/page': { videoInfoRes: { item_list: [gallery] } } } }
const json = JSON.stringify(data)
assert.equal(extractDouyinPage(`<script>window._ROUTER_DATA = ${json};</script>`, id).streams[0].isImage, true)
assert.equal(extractDouyinPage(`<script id="RENDER_DATA">${encodeURIComponent(json)}</script>`, id).streams.length, 3)
assert.equal(extractDouyinPage(`<script id='_ROUTER_DATA'>${json}</script>`, id).title, '图集')
assert.equal(extractDouyinPage('<script>window._ROUTER_DATA = alert("unsafe")</script>', id), null)
assert.equal(extractDouyinPage('<script>window._ROUTER_DATA = {"loaderData":{"video_layout":null}}</script>', id), null)
const cyclic = {}; cyclic.self = cyclic
assert.equal(extractDouyinMedia(cyclic, id), null)
console.log('Douyin share text, IDs, video qualities, galleries, SSR and target filtering passed.')
