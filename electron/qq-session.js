// A validated session is persisted only after authentication succeeds. The
// storage adapter uses Electron safeStorage; tests inject an in-memory adapter.
export class QQSession {
    constructor({ validate, load, save, clear }) {
        Object.assign(this, { validate, load, save, clear })
        this.revision = 0
    }
    async accept(cookie, uin = '', isCurrent = () => true) {
        const revision = this.revision
        const profile = await this.validate(cookie, uin)
        if (revision !== this.revision || !isCurrent()) throw new Error('登录已取消或账号已切换')
        this.save(JSON.stringify({ cookie, profile }))
        this.revision++
        return { cookie, profile }
    }
    async restore() {
        const revision = this.revision
        const saved = this.load()
        if (!saved) return { cookie: '', profile: null }
        let value
        try { value = JSON.parse(saved) } catch { throw new Error('已保存的 QQ 登录数据损坏，请重新登录') }
        if (!value.cookie || !value.profile?.userId) throw new Error('已保存的 QQ 登录数据不完整，请重新登录')
        const profile = await this.validate(value.cookie, value.profile.userId)
        if (revision !== this.revision) throw new Error('登录恢复已取消或账号已切换')
        return { cookie: value.cookie, profile }
    }
    logout() {
        this.revision++
        this.clear()
    }
}
