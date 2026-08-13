// QQ 音乐 API 命令(完全对齐 electron/qq-music.js 的实现)
// - 子进程代理: http://127.0.0.1:3200/*,通过 X-Custom-Cookie header 传递 cookie
// - 直接调用上游 QQ API 的命令(用户类/评论/歌单操作)用 reqwest 直连 y.qq.com / c6.y.qq.com / u.y.qq.com
// - g_tk 签名: hash33 算法(基于 qrsig)
// - 响应解包: body.response ?? body(登录类 API 无 response 包裹,原样返回)
use serde_json::{json, Value};

const QQ_API_BASE: &str = "http://127.0.0.1:3200";
const QQ_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ===================== 通用工具函数 =====================

/// QQ 音乐 g_tk 算法(hash33,基于 qrsig)
/// 绝大多数写操作接口(收藏/创建歌单等)的签名必填
fn hash33(s: &str) -> i32 {
    let mut hash: i32 = 0;
    for c in s.chars() {
        // JS: hash += (hash << 5) + charCodeAt(i)
        // 用 wrapping_* 避免 i32 溢出 panic(对齐 JS 32 位有符号整数语义)
        hash = hash.wrapping_add(hash.wrapping_shl(5).wrapping_add(c as i32));
    }
    hash & 0x7FFFFFFF // JS: hash & 2147483647
}

/// 从 cookie 字符串提取 qrsig 并计算 g_tk
fn calc_g_tk(cookie: &str) -> i32 {
    for part in cookie.split(';').map(|s| s.trim()) {
        if let Some(rest) = part.strip_prefix("qrsig") {
            let rest = rest.trim_start();
            if let Some(v) = rest.strip_prefix('=') {
                return hash33(v.trim());
            }
        }
    }
    0
}

/// 从 cookie 字符串提取 loginUin(明文数字 QQ)
/// 匹配 `uin=o0123456789` 或 `uin=123456789`,去掉前缀 o/O 和前导 0
fn extract_login_uin(cookie: &str) -> String {
    for part in cookie.split(';').map(|s| s.trim()) {
        if let Some(rest) = part.strip_prefix("uin").map(|s| s.trim_start()) {
            if let Some(v) = rest.strip_prefix('=') {
                let v = v.trim();
                let v = v.trim_start_matches(|c| c == 'o' || c == 'O');
                let v = v.trim_start_matches('0');
                if !v.is_empty() && v.chars().all(|c| c.is_ascii_digit()) {
                    return v.to_string();
                }
            }
        }
    }
    "0".to_string()
}

/// 从 payload 提取 cookie 字符串
fn get_cookie(payload: &Value) -> String {
    payload.get("cookie").and_then(|v| v.as_str()).unwrap_or("").to_string()
}

/// 通用 QQ API GET 请求(子进程代理)
/// - 通过 X-Custom-Cookie header 传递 cookie
/// - 解包 response 字段: body.response ?? body
async fn qq_get(endpoint: &str, params: &[(&str, String)], cookie: &str) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let url = format!("{}{}", QQ_API_BASE, endpoint);
    let mut req = client.get(&url);
    if !cookie.is_empty() {
        req = req.header("X-Custom-Cookie", cookie);
    }
    let query: Vec<(String, String)> = params.iter().map(|(k, v)| (k.to_string(), v.clone())).collect();
    let resp = req.query(&query).send().await.map_err(|e| format!("QQ API 请求失败: {}", e))?;
    let body: Value = resp.json().await.map_err(|e| format!("解析失败: {}", e))?;
    Ok(body.get("response").cloned().unwrap_or(body))
}

/// 通用 QQ API POST 请求(子进程代理)
async fn qq_post(endpoint: &str, body: &Value, cookie: &str) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let url = format!("{}{}", QQ_API_BASE, endpoint);
    let mut req = client.post(&url).json(body);
    if !cookie.is_empty() {
        req = req.header("X-Custom-Cookie", cookie);
    }
    let resp = req.send().await.map_err(|e| format!("QQ API 请求失败: {}", e))?;
    let body: Value = resp.json().await.map_err(|e| format!("解析失败: {}", e))?;
    Ok(body.get("response").cloned().unwrap_or(body))
}

// ===================== 直接调用上游 QQ API 的辅助函数 =====================

/// 获取用户主页信息(对应 fetchQQUserInfo / fetchLikedSongsDirect / fetchUserPlaylistsDirect 的第一步)
/// 接口: https://c6.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg
/// 关键: uin 必须字符串传递(wxuin 超过 2^53,parseInt 会丢精度导致 code=1000)
async fn fetch_profile_homepage(uin: &str, cookie: &str) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let now = chrono::Utc::now().timestamp_millis();
    let uin_str = uin.to_string();
    let params: Vec<(&str, String)> = vec![
        ("_", now.to_string()),
        ("cv", "4747474".into()),
        ("ct", "24".into()),
        ("format", "json".into()),
        ("inCharset", "utf-8".into()),
        ("outCharset", "utf-8".into()),
        ("notice", "0".into()),
        ("platform", "yqq.json".into()),
        ("needNewCode", "0".into()),
        ("uin", uin_str.clone()),
        ("g_tk_new_20200303", "0".into()),
        ("g_tk", "0".into()),
        ("cid", "205360838".into()),
        ("userid", uin_str.clone()),
        ("reqfrom", "1".into()),
        ("reqtype", "0".into()),
        ("hostUin", "0".into()),
        ("loginUin", uin_str),
    ];
    let resp = client.get("https://c6.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg")
        .query(&params)
        .header("Referer", format!("https://y.qq.com/portal/profile.html?uin={}", uin))
        .header("Cookie", cookie)
        .header("User-Agent", QQ_UA)
        .send().await.map_err(|e| format!("请求失败: {}", e))?;
    let body: Value = resp.json().await.map_err(|e| format!("解析失败: {}", e))?;
    Ok(body)
}

/// fetchQQUserInfo - 用采集到的 cookie + uin 直接调用上游 QQ API 获取真实昵称和头像
/// 返回: { nickname, avatarUrl, isVip, vipLevel, vipIcon }
async fn fetch_qq_user_info(cookie: &str, uin: &str) -> Value {
    if uin.is_empty() || cookie.is_empty() {
        return json!({ "nickname": "", "avatarUrl": "", "isVip": false, "vipLevel": 0, "vipIcon": "" });
    }
    let profile = match fetch_profile_homepage(uin, cookie).await {
        Ok(p) => p,
        Err(_) => return json!({ "nickname": "", "avatarUrl": "", "isVip": false, "vipLevel": 0, "vipIcon": "" }),
    };
    if profile.get("code").and_then(|v| v.as_i64()) != Some(0) {
        return json!({ "nickname": "", "avatarUrl": "", "isVip": false, "vipLevel": 0, "vipIcon": "" });
    }
    let creator = profile.get("data").and_then(|d| d.get("creator")).cloned().unwrap_or(Value::Null);
    let nickname = creator.get("nick").and_then(|v| v.as_str())
        .or_else(|| creator.get("nickname").and_then(|v| v.as_str()))
        .or_else(|| creator.get("Nick").and_then(|v| v.as_str()))
        .unwrap_or("").to_string();
    let avatar_url = creator.get("headpic").and_then(|v| v.as_str())
        .or_else(|| creator.get("avatar").and_then(|v| v.as_str()))
        .or_else(|| creator.get("pic").and_then(|v| v.as_str()))
        .or_else(|| creator.get("avatarUrl").and_then(|v| v.as_str()))
        .or_else(|| creator.get("logo").and_then(|v| v.as_str()))
        .unwrap_or("").to_string();
    // VIP 状态:从 lvinfo[] 数组提取
    let mut is_vip = false;
    let mut vip_level = 0i64;
    let mut vip_icon = String::new();
    if let Some(lvinfo) = creator.get("lvinfo").and_then(|v| v.as_array()) {
        for lv in lvinfo {
            let icon = lv.get("iconurl").and_then(|v| v.as_str()).unwrap_or("");
            let lower = icon.to_lowercase();
            if lower.contains("svip") {
                is_vip = true; vip_level = 2; vip_icon = icon.to_string(); break;
            }
            if lower.contains("sui") || lower.contains("vip") {
                is_vip = true; vip_level = 1; vip_icon = icon.to_string(); break;
            }
        }
    }
    json!({
        "nickname": nickname,
        "avatarUrl": avatar_url,
        "isVip": is_vip,
        "vipLevel": vip_level,
        "vipIcon": vip_icon
    })
}

/// fetchQQSongDetail - 获取歌曲详情(用于无封面兜底 + VIP 标识 + 评论的 songid 补全)
/// 接口: https://u.y.qq.com/cgi-bin/musicu.fcg (统一网关)
/// 返回统一结构: { code:0, data: { track_info: { id, mid, name, singer, album:{mid,name}, pay, interval } } }
async fn fetch_qq_song_detail(songmid: &str, cookie: &str) -> Result<Value, String> {
    if songmid.is_empty() {
        return Err("缺少 songmid 参数".to_string());
    }
    let login_uin = extract_login_uin(cookie);
    let body = json!({
        "req_0": {
            "module": "music.pf_song_detail_svr",
            "method": "get_song_detail",
            "param": { "song_mid": songmid }
        },
        "comm": { "uin": login_uin, "platform": "yqq.json" }
    });
    let client = reqwest::Client::new();
    let resp = client.post("https://u.y.qq.com/cgi-bin/musicu.fcg")
        .header("Content-Type", "application/json")
        .header("Referer", "https://y.qq.com/")
        .header("Cookie", cookie)
        .header("User-Agent", QQ_UA)
        .json(&body)
        .send().await.map_err(|e| format!("请求失败: {}", e))?;
    let res: Value = resp.json().await.map_err(|e| format!("解析失败: {}", e))?;
    let ti = res.get("req_0").and_then(|r| r.get("data")).and_then(|d| d.get("track_info")).cloned().unwrap_or(Value::Null);
    if ti.is_null() || ti.get("id").is_none() {
        return Ok(json!({ "code": -1, "message": "未找到歌曲", "data": { "track_info": null } }));
    }
    let id = ti.get("id").cloned().unwrap_or(json!(0));
    let mid = ti.get("mid").and_then(|v| v.as_str()).unwrap_or(songmid).to_string();
    let name = ti.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let singer = ti.get("singer").cloned().unwrap_or(json!([]));
    let album_mid = ti.get("album").and_then(|a| a.get("mid")).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let album_name = ti.get("album").and_then(|a| a.get("name")).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let pay = ti.get("pay").cloned().unwrap_or(json!({}));
    let interval = ti.get("interval").and_then(|v| v.as_i64()).unwrap_or(0);
    Ok(json!({
        "code": 0,
        "data": {
            "track_info": {
                "id": id,
                "mid": mid,
                "name": name,
                "singer": singer,
                "album": { "mid": album_mid, "name": album_name },
                "pay": pay,
                "interval": interval
            }
        }
    }))
}

/// fetchQQCommentsDirect - 直接调用上游评论接口
/// 接口: https://c.y.qq.com/base/fcgi-bin/fcg_global_comment_h5.fcg
/// 关键: topid 必须是数字 songid(不是 songmid!)
async fn fetch_qq_comments_direct(songid: i64, cmd: i64, pagenum: i64, pagesize: i64, lasthotcommentid: &str, cookie: &str) -> Result<Value, String> {
    if songid == 0 {
        return Err("缺少 songid(歌曲对象未包含 songid 字段,无法获取评论)".to_string());
    }
    let g_tk = calc_g_tk(cookie);
    let login_uin = extract_login_uin(cookie);
    let now = chrono::Utc::now().timestamp_millis();
    let client = reqwest::Client::new();
    let params: Vec<(&str, String)> = vec![
        ("_", now.to_string()),
        ("biztype", "1".into()),                  // 1=歌曲
        ("topid", songid.to_string()),            // 数字 songid(非 songmid!)
        ("cmd", cmd.to_string()),                 // 6=热评, 8=最新
        ("pagenum", pagenum.to_string()),
        ("pagesize", pagesize.to_string()),
        ("lasthotcommentid", lasthotcommentid.to_string()),
        ("format", "json".into()),
        ("inCharset", "utf-8".into()),
        ("outCharset", "utf-8".into()),
        ("notice", "0".into()),
        ("platform", "yqq.json".into()),
        ("needNewCode", "0".into()),
        ("g_tk", g_tk.to_string()),
        ("loginUin", login_uin),
        ("hostUin", "0".into()),
    ];
    let resp = client.get("https://c.y.qq.com/base/fcgi-bin/fcg_global_comment_h5.fcg")
        .query(&params)
        .header("Referer", "https://y.qq.com/")
        .header("Cookie", cookie)
        .header("User-Agent", QQ_UA)
        .send().await.map_err(|e| format!("请求失败: {}", e))?;
    let res: Value = resp.json().await.map_err(|e| format!("解析失败: {}", e))?;
    let comment_data = res.get("comment").cloned().unwrap_or(json!({}));
    let raw_list = comment_data.get("commentlist").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    // 归一化为网易云兼容格式
    let mut comments = Vec::new();
    for c in &raw_list {
        let reply = c.get("replyedcomment").cloned().unwrap_or(Value::Null);
        let r_nick = reply.get("nick").and_then(|v| v.as_str()).unwrap_or("");
        let be_replied = if !r_nick.is_empty() {
            let r_avatar = reply.get("avatarurl").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let r_content = reply.get("middlecommentcontent").and_then(|v| v.as_str())
                .or_else(|| reply.get("rootcommentcontent").and_then(|v| v.as_str()))
                .unwrap_or("").to_string();
            json!([{
                "user": { "avatarUrl": r_avatar, "nickname": r_nick },
                "content": r_content
            }])
        } else {
            Value::Null
        };
        let time_sec = c.get("time").and_then(|v| v.as_i64()).unwrap_or(0);
        comments.push(json!({
            "commentId": c.get("commentid").cloned().unwrap_or(json!("")),
            "content": c.get("rootcommentcontent").and_then(|v| v.as_str())
                .or_else(|| c.get("middlecommentcontent").and_then(|v| v.as_str()))
                .unwrap_or(""),
            "time": time_sec * 1000, // QQ 时间戳是秒,转毫秒
            "likedCount": c.get("praisenum").cloned().unwrap_or(json!(0)),
            "liked": c.get("ispraise").and_then(|v| v.as_bool()).unwrap_or(false),
            "user": {
                "avatarUrl": c.get("avatarurl").and_then(|v| v.as_str()).unwrap_or(""),
                "nickname": c.get("nick").and_then(|v| v.as_str()).unwrap_or("匿名用户"),
                "userId": c.get("encrypt_uin").cloned().unwrap_or_else(|| c.get("uin").cloned().unwrap_or(json!("")))
            },
            "beReplied": be_replied
        }));
    }
    let last_id = raw_list.last().and_then(|c| c.get("commentid")).and_then(|v| v.as_str()).unwrap_or("").to_string();
    Ok(json!({
        "code": 0,
        "data": {
            "comments": comments,
            "total": comment_data.get("commenttotal").cloned().unwrap_or(json!(0)),
            "hasMore": comments.len() as i64 >= pagesize,
            "lasthotcommentid": last_id
        }
    }))
}

/// operMyLikeSonglist - 我喜欢歌单收藏/取消收藏(对应线上红心)
/// 接口: https://u.y.qq.com/cgi-bin/musicu.fcg (统一网关)
/// cmd: 1=添加(收藏红心), 2=删除(取消红心)
async fn oper_mylike_songlist(cmd: i64, songmid: &str, cookie: &str, dissid: &str, songid: i64) -> Result<Value, String> {
    if songmid.is_empty() { return Err("缺少 songmid".into()); }
    if cookie.is_empty() { return Err("未登录,缺少 cookie".into()); }
    if dissid.is_empty() { return Err("缺少\"我喜欢\"歌单 ID".into()); }
    let is_add = cmd == 1;
    let (module, method) = if is_add {
        ("music.musicPlaylist.PlaylistAddSong", "AddSong")
    } else {
        ("music.musicPlaylist.PlaylistDelSong", "DelSong")
    };
    let login_uin = extract_login_uin(cookie);
    let dissid_n: i64 = dissid.parse().unwrap_or(0);
    let body = json!({
        "comm": { "uin": login_uin, "format": "json", "ct": 24, "cv": 0 },
        "req": {
            "module": module,
            "method": method,
            "param": {
                "disstid": dissid_n,
                "song_mid": [songmid.to_string()],
                "song_id": [songid],
                "song_type": [0],
                "in_ftype": 0
            }
        }
    });
    let client = reqwest::Client::new();
    let resp = client.post("https://u.y.qq.com/cgi-bin/musicu.fcg")
        .header("Content-Type", "application/json")
        .header("Referer", "https://y.qq.com/")
        .header("Origin", "https://y.qq.com")
        .header("Cookie", cookie)
        .header("User-Agent", QQ_UA)
        .json(&body)
        .send().await.map_err(|e| format!("请求失败: {}", e))?;
    let res: Value = resp.json().await.map_err(|e| format!("解析失败: {}", e))?;
    let ret = res.get("req").cloned().unwrap_or(Value::Null);
    let code = ret.get("code").and_then(|v| v.as_i64())
        .or_else(|| ret.get("data").and_then(|d| d.get("code")).and_then(|v| v.as_i64()));
    if code == Some(0) {
        return Ok(json!({ "code": 0 }));
    }
    let msg = ret.get("message").and_then(|v| v.as_str())
        .or_else(|| ret.get("msg").and_then(|v| v.as_str()))
        .unwrap_or("操作失败");
    Ok(json!({ "code": code.unwrap_or(-1), "message": msg }))
}

/// operSonglist - 歌单创建/删除 + 添加歌曲到歌单
/// 接口: https://c.y.qq.com/qzone/fcg-bin/fcg_music_custom_oper_songlist.fcg
/// cmd: 'add'=创建歌单, 'del'=删除歌单, 'addsong'=添加歌曲到歌单, 'delsong'=从歌单删除歌曲
async fn oper_songlist_direct(cmd: &str, dissid: &str, songmids: &Value, name: &str, cookie: &str) -> Result<Value, String> {
    if cookie.is_empty() { return Err("未登录,缺少 cookie".into()); }
    let g_tk = calc_g_tk(cookie);
    let now = chrono::Utc::now().timestamp_millis();
    let mut body = json!({ "cmd": cmd });
    match cmd {
        "add" => {
            body["name"] = json!(if name.is_empty() { "新建歌单" } else { name });
        }
        "del" => {
            body["dissid"] = json!(dissid);
        }
        "addsong" | "delsong" => {
            body["dissid"] = json!(dissid);
            let song_mids_str = if let Some(arr) = songmids.as_array() {
                arr.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join(",")
            } else {
                songmids.as_str().unwrap_or("").to_string()
            };
            body["song_mids"] = json!(song_mids_str);
        }
        _ => {}
    }
    let client = reqwest::Client::new();
    let params: Vec<(&str, String)> = vec![
        ("_", now.to_string()),
        ("format", "json".into()),
        ("inCharset", "utf-8".into()),
        ("outCharset", "utf-8".into()),
        ("notice", "0".into()),
        ("platform", "yqq.json".into()),
        ("needNewCode", "0".into()),
        ("g_tk", g_tk.to_string()),
        ("loginUin", "0".into()),
        ("hostUin", "0".into()),
    ];
    let resp = client.post("https://c.y.qq.com/qzone/fcg-bin/fcg_music_custom_oper_songlist.fcg")
        .query(&params)
        .header("Content-Type", "application/json")
        .header("Referer", "https://y.qq.com/")
        .header("Origin", "https://y.qq.com")
        .header("Cookie", cookie)
        .header("User-Agent", QQ_UA)
        .json(&body)
        .send().await.map_err(|e| format!("请求失败: {}", e))?;
    let res: Value = resp.json().await.map_err(|e| format!("解析失败: {}", e))?;
    Ok(res)
}

/// fetchUserPlaylistsDirect - 直接调用上游获取用户歌单列表
/// 复用 fetch_profile_homepage 的 mymusic 数组
/// 返回: { code:0, data: { playlists: [...] } }
async fn fetch_user_playlists_direct(uin: &str, cookie: &str, _offset: i64, _limit: i64) -> Result<Value, String> {
    if uin.is_empty() { return Err("缺少 uin 参数".into()); }
    let profile = fetch_profile_homepage(uin, cookie).await?;
    if profile.get("code").and_then(|v| v.as_i64()) != Some(0) {
        let msg = profile.get("msg").and_then(|v| v.as_str())
            .or_else(|| profile.get("message").and_then(|v| v.as_str()))
            .unwrap_or("获取用户主页失败");
        return Err(msg.to_string());
    }
    let mymusic = profile.get("data").and_then(|d| d.get("mymusic")).and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let mut playlists = Vec::new();
    for item in &mymusic {
        // id 可能是字符串或数字
        let dissid = item.get("id").and_then(|v| v.as_str()).map(|s| s.to_string())
            .or_else(|| item.get("id").and_then(|v| v.as_i64()).map(|n| n.to_string()))
            .unwrap_or_default();
        if !dissid.is_empty() {
            playlists.push(json!({
                "dissid": dissid,
                "diss_name": item.get("title").and_then(|v| v.as_str())
                    .or_else(|| item.get("name").and_then(|v| v.as_str()))
                    .unwrap_or(""),
                "picurl": item.get("picurl").and_then(|v| v.as_str())
                    .or_else(|| item.get("pic").and_then(|v| v.as_str()))
                    .unwrap_or(""),
                "song_count": item.get("num0").cloned().unwrap_or(json!(0)),
                "type": item.get("type").cloned().unwrap_or(json!(0)),
                "listennum": item.get("listennum").cloned().unwrap_or(json!(0))
            }));
        }
    }
    Ok(json!({ "code": 0, "data": { "playlists": playlists } }))
}

/// fetchLikedSongsDirect - 直接调用上游获取"我喜欢"歌曲
/// 两步链路:
///   1. GET fcg_get_profile_homepage.fcg 拿 mymusic,找 type===1 项的 id 作为 dissid
///   2. GET fcg_ucc_getcdinfo_byids_cp.fcg 传 disstid,返回 cdlist[0].songlist
async fn fetch_liked_songs_direct(uin: &str, cookie: &str, _offset: i64, _limit: i64) -> Result<Value, String> {
    if uin.is_empty() { return Err("缺少 uin 参数".into()); }
    let profile = fetch_profile_homepage(uin, cookie).await?;
    if profile.get("code").and_then(|v| v.as_i64()) != Some(0) {
        let msg = profile.get("msg").and_then(|v| v.as_str())
            .or_else(|| profile.get("message").and_then(|v| v.as_str()))
            .unwrap_or("获取用户主页失败");
        return Err(msg.to_string());
    }
    let mymusic = profile.get("data").and_then(|d| d.get("mymusic")).and_then(|v| v.as_array()).cloned().unwrap_or_default();
    // 找"我喜欢"歌单(type===1 或 title 含"喜欢")
    let mut liked_info: Option<Value> = None;
    for item in &mymusic {
        let t = item.get("type").and_then(|v| v.as_i64()).unwrap_or(0);
        let title = item.get("title").and_then(|v| v.as_str()).unwrap_or("");
        if t == 1 || title.contains("喜欢") {
            liked_info = Some(item.clone());
            break;
        }
    }
    let liked_info = match liked_info {
        Some(v) => v,
        None => return Ok(json!({ "code": 0, "data": { "songs": [], "total": 0, "hasMore": false } }))
    };
    let dissid = liked_info.get("id").and_then(|v| v.as_str()).map(|s| s.to_string())
        .or_else(|| liked_info.get("id").and_then(|v| v.as_i64()).map(|n| n.to_string()))
        .unwrap_or_default();
    if dissid.is_empty() {
        return Ok(json!({ "code": 0, "data": { "songs": [], "total": 0, "hasMore": false } }));
    }
    // 步骤 2: 用 dissid 拿歌单详情
    let client = reqwest::Client::new();
    let uin_str = uin.to_string();
    let params: Vec<(&str, String)> = vec![
        ("type", "1".into()),
        ("json", "1".into()),
        ("utf8", "1".into()),
        ("onlysong", "0".into()),
        ("new_format", "1".into()),
        ("disstid", dissid.clone()),
        ("format", "json".into()),
        ("outCharset", "utf-8".into()),
        ("g_tk", "0".into()),
        ("loginUin", uin_str.clone()),
        ("hostUin", "0".into()),
        ("inCharset", "utf-8".into()),
        ("notice", "0".into()),
        ("platform", "yqq.json".into()),
        ("needNewCode", "0".into()),
    ];
    let resp = client.get("https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg")
        .query(&params)
        .header("Referer", "https://y.qq.com/portal/player.html")
        .header("Cookie", cookie)
        .header("User-Agent", QQ_UA)
        .send().await.map_err(|e| format!("请求失败: {}", e))?;
    let cd: Value = resp.json().await.map_err(|e| format!("解析失败: {}", e))?;
    if cd.get("code").and_then(|v| v.as_i64()) != Some(0) {
        let msg = cd.get("msg").and_then(|v| v.as_str())
            .or_else(|| cd.get("message").and_then(|v| v.as_str()))
            .unwrap_or("获取歌单详情失败");
        return Err(msg.to_string());
    }
    let cdlist = cd.get("cdlist").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let cd0 = cdlist.first().cloned().unwrap_or(Value::Null);
    let songs = cd0.get("songlist").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let total = cd0.get("total_song_num").and_then(|v| v.as_i64()).unwrap_or(songs.len() as i64);
    let liked_title = liked_info.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let liked_num0 = liked_info.get("num0").and_then(|v| v.as_i64()).unwrap_or(songs.len() as i64);
    let cover = cd0.get("picurl").and_then(|v| v.as_str())
        .or_else(|| cd0.get("logo").and_then(|v| v.as_str()))
        .unwrap_or("").to_string();
    Ok(json!({
        "code": 0,
        "data": {
            "songs": songs,
            "total": total,
            "hasMore": false,
            "info": {
                "title": liked_title,
                "songCount": liked_num0,
                "id": dissid,
                "cover": cover
            }
        }
    }))
}

// ===================== 搜索类(3) =====================

#[tauri::command]
pub async fn qq_search(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    let key = payload["key"].as_str().unwrap_or("");
    let limit = payload["limit"].as_i64().unwrap_or(30);
    let page = payload["page"].as_i64().unwrap_or(1);
    // catZhida 默认 1,需保留 0 显式传入的情况
    let cat_zhida = if payload.get("catZhida").is_none() { 1i64 } else { payload["catZhida"].as_i64().unwrap_or(1) };
    qq_get("/getSearchByKey", &[
        ("key", key.to_string()),
        ("limit", limit.to_string()),
        ("page", page.to_string()),
        ("catZhida", cat_zhida.to_string()),
    ], &cookie).await
}

#[tauri::command]
pub async fn qq_smartbox(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    let key = payload["key"].as_str().unwrap_or("");
    qq_get("/getSmartbox", &[
        ("key", key.to_string()),
    ], &cookie).await
}

#[tauri::command]
pub async fn qq_hotkey(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    qq_get("/getHotkey", &[], &cookie).await
}

// ===================== 音乐类(5) =====================

#[tauri::command]
pub async fn qq_song_info(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    let songmid = payload["songmid"].as_str().unwrap_or("");
    qq_get("/getSongInfo", &[
        ("songmid", songmid.to_string()),
    ], &cookie).await
}

#[tauri::command]
pub async fn qq_song_play(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    let songmid = payload["songmid"].as_str().unwrap_or("");
    let quality = payload["quality"].as_str().unwrap_or("128");
    qq_get("/getMusicPlay", &[
        ("songmid", songmid.to_string()),
        ("quality", quality.to_string()),
    ], &cookie).await
}

#[tauri::command]
pub async fn qq_lyric(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    let songmid = payload["songmid"].as_str().unwrap_or("");
    // isFormat 默认 1,需保留 0 显式传入的情况
    let is_format = if payload.get("isFormat").is_none() { 1i64 } else { payload["isFormat"].as_i64().unwrap_or(1) };
    qq_get("/getLyric", &[
        ("songmid", songmid.to_string()),
        ("isFormat", is_format.to_string()),
    ], &cookie).await
}

#[tauri::command]
pub async fn qq_album_info(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    let albummid = payload["albummid"].as_str().unwrap_or("");
    qq_get("/getAlbumInfo", &[
        ("albummid", albummid.to_string()),
    ], &cookie).await
}

#[tauri::command]
pub async fn qq_batch_song_info(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    let songs = payload.get("songs").cloned().unwrap_or(json!([]));
    let body = json!({ "songs": songs });
    qq_post("/batchGetSongInfo", &body, &cookie).await
}

// ===================== 歌手类(7) =====================

#[tauri::command]
pub async fn qq_singer_list(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    // QQ API "全部"标签 id 为 -100(非 -1),-1 会返回空列表
    let area = if payload.get("area").is_none() { -100i64 } else { payload["area"].as_i64().unwrap_or(-100) };
    let sex = if payload.get("sex").is_none() { -100i64 } else { payload["sex"].as_i64().unwrap_or(-100) };
    let genre = if payload.get("genre").is_none() { -100i64 } else { payload["genre"].as_i64().unwrap_or(-100) };
    let page = payload["page"].as_i64().unwrap_or(1);
    let limit = payload["limit"].as_i64().unwrap_or(20);
    qq_get("/getSingerList", &[
        ("area", area.to_string()),
        ("sex", sex.to_string()),
        ("genre", genre.to_string()),
        ("page", page.to_string()),
        ("limit", limit.to_string()),
    ], &cookie).await
}

#[tauri::command]
pub async fn qq_singer_desc(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    let singermid = payload["singermid"].as_str().unwrap_or("");
    qq_get("/getSingerDesc", &[
        ("singermid", singermid.to_string()),
    ], &cookie).await
}

#[tauri::command]
pub async fn qq_singer_hotsong(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    let singermid = payload["singermid"].as_str().unwrap_or("");
    let limit = payload["limit"].as_i64().unwrap_or(20);
    let page = payload["page"].as_i64().unwrap_or(1);
    qq_get("/getSingerHotsong", &[
        ("singermid", singermid.to_string()),
        ("limit", limit.to_string()),
        ("page", page.to_string()),
    ], &cookie).await
}

#[tauri::command]
pub async fn qq_singer_album(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    let singermid = payload["singermid"].as_str().unwrap_or("");
    let limit = payload["limit"].as_i64().unwrap_or(20);
    let page = payload["page"].as_i64().unwrap_or(1);
    qq_get("/getSingerAlbum", &[
        ("singermid", singermid.to_string()),
        ("limit", limit.to_string()),
        ("page", page.to_string()),
    ], &cookie).await
}

#[tauri::command]
pub async fn qq_singer_mv(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    let singermid = payload["singermid"].as_str().unwrap_or("");
    let limit = payload["limit"].as_i64().unwrap_or(20);
    let order = payload["order"].as_str().unwrap_or("time");
    qq_get("/getSingerMv", &[
        ("singermid", singermid.to_string()),
        ("limit", limit.to_string()),
        ("order", order.to_string()),
    ], &cookie).await
}

#[tauri::command]
pub async fn qq_similar_singer(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    let singermid = payload["singermid"].as_str().unwrap_or("");
    qq_get("/getSimilarSinger", &[
        ("singermid", singermid.to_string()),
    ], &cookie).await
}

#[tauri::command]
pub async fn qq_singer_star_num(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    let singermid = payload["singermid"].as_str().unwrap_or("");
    qq_get("/getSingerStarNum", &[
        ("singermid", singermid.to_string()),
    ], &cookie).await
}

// ===================== 歌单类(5) =====================

#[tauri::command]
pub async fn qq_playlist_categories(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    qq_get("/getSongListCategories", &[], &cookie).await
}

#[tauri::command]
pub async fn qq_playlist_list(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    let category_id = payload["categoryId"].as_str().unwrap_or("");
    let sort_id = payload["sortId"].as_i64().unwrap_or(5);
    let limit = payload["limit"].as_i64().unwrap_or(19);
    let page = payload["page"].as_i64().unwrap_or(1);
    qq_get("/getSongLists", &[
        ("categoryId", category_id.to_string()),
        ("sortId", sort_id.to_string()),
        ("limit", limit.to_string()),
        ("page", page.to_string()),
    ], &cookie).await
}

#[tauri::command]
pub async fn qq_playlist_detail(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    let disstid = payload["disstid"].as_str().unwrap_or("");
    qq_get("/getSongListDetail", &[
        ("disstid", disstid.to_string()),
    ], &cookie).await
}

#[tauri::command]
pub async fn qq_batch_playlists(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    // categoryIds 默认 [10000000]
    let category_ids = payload.get("categoryIds").cloned().unwrap_or(json!([10000000]));
    let page = payload["page"].as_i64().unwrap_or(0);
    let limit = payload["limit"].as_i64().unwrap_or(19);
    let sort_id = payload["sortId"].as_i64().unwrap_or(5);
    let body = json!({
        "categoryIds": category_ids,
        "page": page,
        "limit": limit,
        "sortId": sort_id
    });
    qq_post("/batchGetSongLists", &body, &cookie).await
}

#[tauri::command]
pub async fn qq_new_disks(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    let limit = payload["limit"].as_i64().unwrap_or(20);
    let page = payload["page"].as_i64().unwrap_or(1);
    qq_get("/getNewDisks", &[
        ("limit", limit.to_string()),
        ("page", page.to_string()),
    ], &cookie).await
}

// ===================== 排行榜类(2) =====================

#[tauri::command]
pub async fn qq_ranks(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    let top_id = payload["topId"].as_str().unwrap_or("");
    let limit = payload["limit"].as_i64().unwrap_or(20);
    let page = payload["page"].as_i64().unwrap_or(1);
    qq_get("/getRanks", &[
        ("topId", top_id.to_string()),
        ("limit", limit.to_string()),
        ("page", page.to_string()),
    ], &cookie).await
}

#[tauri::command]
pub async fn qq_top_lists(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    qq_get("/getTopLists", &[], &cookie).await
}

// ===================== 评论类(1) =====================

#[tauri::command]
pub async fn qq_comments(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    // songid 缺失时,通过 songmid 调 song-detail 接口补全
    let mut songid = payload["songid"].as_i64().unwrap_or(0);
    if songid == 0 {
        let songmid = payload["songmid"].as_str().unwrap_or("");
        if !songmid.is_empty() {
            match fetch_qq_song_detail(songmid, &cookie).await {
                Ok(detail) => {
                    songid = detail.get("data").and_then(|d| d.get("track_info")).and_then(|t| t.get("id")).and_then(|v| v.as_i64()).unwrap_or(0);
                }
                Err(e) => return Ok(json!({ "code": -1, "message": format!("获取评论失败: {}", e) })),
            }
        }
    }
    let cmd = payload["cmd"].as_i64().unwrap_or(8);
    let pagenum = payload["pagenum"].as_i64().unwrap_or(0);
    let pagesize = payload["pagesize"].as_i64().unwrap_or(20);
    let lasthotcommentid = payload["lasthotcommentid"].as_str().unwrap_or("");
    match fetch_qq_comments_direct(songid, cmd, pagenum, pagesize, lasthotcommentid, &cookie).await {
        Ok(v) => Ok(v),
        Err(e) => Ok(json!({ "code": -1, "message": e })),
    }
}

// ===================== 用户类(7) =====================

#[tauri::command]
pub async fn qq_user_playlists(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    let uin = payload["uin"].as_str().unwrap_or("").to_string();
    // uin 也可能是数字
    let uin = if uin.is_empty() {
        payload["uin"].as_i64().map(|n| n.to_string()).unwrap_or_default()
    } else {
        uin
    };
    let offset = payload["offset"].as_i64().unwrap_or(0);
    let limit = payload["limit"].as_i64().unwrap_or(30);
    match fetch_user_playlists_direct(&uin, &cookie, offset, limit).await {
        Ok(v) => Ok(v),
        Err(e) => Ok(json!({ "code": -1, "message": e })),
    }
}

#[tauri::command]
pub async fn qq_liked_songs(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    let uin = payload["uin"].as_str().unwrap_or("").to_string();
    let uin = if uin.is_empty() {
        payload["uin"].as_i64().map(|n| n.to_string()).unwrap_or_default()
    } else {
        uin
    };
    let offset = payload["offset"].as_i64().unwrap_or(0);
    let limit = payload["limit"].as_i64().unwrap_or(100);
    // 绕过子进程 /user/getUserLikedSongs(其内部用全局 cookie,忽略 X-Custom-Cookie)
    // 直接调用上游 c6.y.qq.com,使用用户传入的 cookie
    match fetch_liked_songs_direct(&uin, &cookie, offset, limit).await {
        Ok(v) => Ok(v),
        Err(e) => {
            // 回退到子进程 API(可能仍会 502,但保留以兼容)
            qq_get("/user/getUserLikedSongs", &[
                ("uin", uin.clone()),
                ("offset", offset.to_string()),
                ("limit", limit.to_string()),
            ], &cookie).await.or(Ok(json!({ "code": -1, "message": e })))
        }
    }
}

#[tauri::command]
pub async fn qq_user_detail(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    let uin = payload["uin"].as_str().unwrap_or("").to_string();
    let uin = if uin.is_empty() {
        payload["uin"].as_i64().map(|n| n.to_string()).unwrap_or_default()
    } else {
        uin
    };
    // 绕过子进程 /user/getUserDetail(其内部用全局 cookie,忽略 X-Custom-Cookie)
    // 直接调用上游 c6.y.qq.com,使用用户传入的 cookie
    let info = fetch_qq_user_info(&cookie, &uin).await;
    let nickname = info.get("nickname").and_then(|v| v.as_str()).unwrap_or("");
    let avatar_url = info.get("avatarUrl").and_then(|v| v.as_str()).unwrap_or("");
    let is_vip = info.get("isVip").and_then(|v| v.as_bool()).unwrap_or(false);
    let vip_level = info.get("vipLevel").and_then(|v| v.as_i64()).unwrap_or(0);
    let vip_icon = info.get("vipIcon").and_then(|v| v.as_str()).unwrap_or("");
    Ok(json!({
        "code": 0,
        "data": {
            "nickname": nickname,
            "avatarUrl": avatar_url,
            "isVip": is_vip,
            "vipLevel": vip_level,
            "vipIcon": vip_icon,
            "uin": uin
        }
    }))
}

#[tauri::command]
pub async fn qq_song_detail(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    let songmid = payload["songmid"].as_str().unwrap_or("");
    match fetch_qq_song_detail(songmid, &cookie).await {
        Ok(v) => Ok(v),
        Err(e) => Ok(json!({ "code": -1, "message": e })),
    }
}

#[tauri::command]
pub async fn qq_oper_mylike(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    let cmd = payload["cmd"].as_i64().unwrap_or(0);
    let songmid = payload["songmid"].as_str().unwrap_or("");
    let dissid = payload["dissid"].as_str().unwrap_or("");
    let songid = payload["songid"].as_i64().unwrap_or(0);
    match oper_mylike_songlist(cmd, songmid, &cookie, dissid, songid).await {
        Ok(v) => Ok(v),
        Err(e) => Ok(json!({ "code": -1, "message": e })),
    }
}

#[tauri::command]
pub async fn qq_oper_songlist(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    let cmd = payload["cmd"].as_str().unwrap_or("");
    let dissid = payload["dissid"].as_str().unwrap_or("");
    let songmids = payload.get("songmid").cloned().unwrap_or(Value::Null);
    let name = payload["name"].as_str().unwrap_or("");
    match oper_songlist_direct(cmd, dissid, &songmids, name, &cookie).await {
        Ok(v) => Ok(v),
        Err(e) => Ok(json!({ "code": -1, "message": e })),
    }
}

#[tauri::command]
pub async fn qq_user_avatar(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    let uin = payload["uin"].as_str().unwrap_or("");
    let size = payload["size"].as_i64().unwrap_or(140);
    qq_get("/user/getUserAvatar", &[
        ("uin", uin.to_string()),
        ("size", size.to_string()),
    ], &cookie).await
}

// ===================== 登录类(3) =====================

#[tauri::command]
pub async fn qq_web_login(_payload: Value) -> Result<Value, String> {
    // 原 Electron 通过 BrowserWindow 打开 y.qq.com 扫码,采集 cookie 后返回。
    // Tauri 端此入口由前端调用 tauri-plugin-opener 打开外部浏览器或在 Webview 中加载,
    // 这里返回提示信息,前端应改走 qr-create/qr-check 流程或自行打开窗口。
    Ok(json!({
        "success": false,
        "message": "Tauri 端未实现 web-login,请使用 qq_qr_create / qq_qr_check 流程"
    }))
}

#[tauri::command]
pub async fn qq_qr_create(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    qq_get("/user/getQQLoginQr", &[], &cookie).await
}

#[tauri::command]
pub async fn qq_qr_check(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    let qrsig = payload["qrsig"].as_str().unwrap_or("");
    let ptqrtoken = payload["ptqrtoken"].as_str().unwrap_or("");
    let body = json!({
        "qrsig": qrsig,
        "ptqrtoken": ptqrtoken
    });
    qq_post("/user/checkQQLoginQr", &body, &cookie).await
}

// ===================== MV类(3) =====================

#[tauri::command]
pub async fn qq_mv_list(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    let area_id = if payload.get("area_id").is_none() { 15i64 } else { payload["area_id"].as_i64().unwrap_or(15) };
    let version_id = if payload.get("version_id").is_none() { 7i64 } else { payload["version_id"].as_i64().unwrap_or(7) };
    let limit = payload["limit"].as_i64().unwrap_or(20);
    let page = payload["page"].as_i64().unwrap_or(0);
    qq_get("/getMv", &[
        ("area_id", area_id.to_string()),
        ("version_id", version_id.to_string()),
        ("limit", limit.to_string()),
        ("page", page.to_string()),
    ], &cookie).await
}

#[tauri::command]
pub async fn qq_mv_play(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    let vid = payload["vid"].as_str().unwrap_or("");
    qq_get("/getMvPlay", &[
        ("vid", vid.to_string()),
    ], &cookie).await
}

#[tauri::command]
pub async fn qq_mv_by_tag(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    let tag = payload["tag"].as_str().unwrap_or("");
    let limit = payload["limit"].as_i64().unwrap_or(20);
    let page = payload["page"].as_i64().unwrap_or(1);
    qq_get("/getMvByTag", &[
        ("tag", tag.to_string()),
        ("limit", limit.to_string()),
        ("page", page.to_string()),
    ], &cookie).await
}

// ===================== 其他类(8) =====================

#[tauri::command]
pub async fn qq_image_url(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    let id = payload["id"].as_str().unwrap_or("");
    let size = payload["size"].as_str().unwrap_or("300x300");
    let max_age = payload["maxAge"].as_i64().unwrap_or(2592000);
    qq_get("/getImageUrl", &[
        ("id", id.to_string()),
        ("size", size.to_string()),
        ("maxAge", max_age.to_string()),
    ], &cookie).await
}

#[tauri::command]
pub async fn qq_digital_albums(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    let limit = payload["limit"].as_i64().unwrap_or(20);
    let page = payload["page"].as_i64().unwrap_or(1);
    qq_get("/getDigitalAlbumLists", &[
        ("limit", limit.to_string()),
        ("page", page.to_string()),
    ], &cookie).await
}

#[tauri::command]
pub async fn qq_download(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    let songmid = payload["songmid"].as_str().unwrap_or("");
    let quality = payload["quality"].as_str().unwrap_or("128");
    qq_get("/downloadQQMusic", &[
        ("songmid", songmid.to_string()),
        ("quality", quality.to_string()),
    ], &cookie).await
}

#[tauri::command]
pub async fn qq_radio_lists(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    qq_get("/getRadioLists", &[], &cookie).await
}

#[tauri::command]
pub async fn qq_recommend(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    qq_get("/getRecommend", &[], &cookie).await
}

#[tauri::command]
pub async fn qq_ticket_info(payload: Value) -> Result<Value, String> {
    let cookie = get_cookie(&payload);
    qq_get("/getTicketInfo", &[], &cookie).await
}
