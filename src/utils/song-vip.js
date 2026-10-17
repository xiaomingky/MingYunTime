const flag = value => value === true || value === 1 || value === '1'

export function kugouVipPlayRequired(song = {}) {
  const trans = song.TransParam || song.trans_param || {}
  if (flag(trans.all_quality_free) || flag(trans.free_limited)) return false
  const play = song.vipPlayRequired ?? song.only_vip_playable
  if (play !== undefined) return flag(play)
  const advance = trans.musicpack_advance ?? trans.musicpackAdvance
  if (advance !== undefined) return flag(advance)
  const standard = song.Privilege ?? song.privilege ?? song.media_privilege ?? song.MediaPrivilege
  if (standard !== undefined) return [8, 10].includes(Number(standard) & 15)
  return flag(song.isVip) || Number(song.fee) === 1
}

// Track labels describe the recording's rights, independently of the signed-in
// user's membership. Never derive a song badge from account VIP or preview state.
export function songVip(song, requestedPlatform = '') {
  if (!song || typeof song !== 'object') return null
  const platform = requestedPlatform || song.platform || (song.qishuiId ? 'qishui' : song.songmid ? 'qq' : song.hash ? 'kugou' : 'netease')
  if (platform === 'qq') {
    const play = song.pay?.payplay ?? song.pay?.pay_play ?? song.vipPlayRequired ?? song.isVip
    if (!flag(play)) return null
    return { platform, icon: './membership/qq-song-vip.png', label: 'QQ 音乐 VIP 歌曲', title: '此歌曲需要 QQ 音乐 VIP 播放' }
  }
  if (platform === 'qishui') {
    const labels = song.label_info || song.labelInfo || {}
    const play = flag(labels.only_vip_playable ?? labels.onlyVipPlayable ?? song.vipPlayRequired ?? song.isVip)
    if (!play) return null
    return { platform, icon: './membership/qishui-vip.png', label: '汽水 VIP 歌曲', title: '此歌曲需要汽水音乐 VIP 播放' }
  }
  if (platform === 'netease' && Number(song.fee ?? song.song?.fee ?? song.privilege?.fee) === 1) {
    return { platform, icon: './membership/netease-vip.png', label: '网易云音乐 VIP 歌曲', title: '网易云音乐 VIP 歌曲，播放以账号实际授权为准' }
  }
  if (platform === 'kugou' && kugouVipPlayRequired(song)) {
    return { platform, icon: './membership/kugou-song-vip.webp', label: '酷狗 VIP 歌曲', title: '酷狗 VIP 歌曲，播放以账号实际授权为准' }
  }
  return null
}
