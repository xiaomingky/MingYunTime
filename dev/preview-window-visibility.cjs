// Only the application document may be revealed by preview launchers.
// HTML parsing and media resolution also create BrowserWindows and must stay hidden.
module.exports = function configurePreviewWindow(window) {
    window.webContents.setBackgroundThrottling(false)
    window.webContents.once('did-finish-load', () => {
        const url = window.webContents.getURL().replace(/\\/g, '/')
        if (!/^file:/i.test(url) || !/\/dist\/index\.html(?:[?#]|$)/i.test(url)) return
        window.restore()
        window.show()
        window.focus()
    })
}
