import { LyricPlayer, LyricPlayerBase } from '@applemusic-like-lyrics/core'

// Keep this adapter local to Apple detail; do not patch the shared dependency.
export class AppleLyricPlayer extends LyricPlayer {
  nearbyOnly = true
  performanceMode = true
  sampleWordAnimation(animation, time) {
    if (animation.playState !== 'paused') animation.pause()
    if (animation.currentTime !== time) animation.currentTime = time
  }

  update(delta = 0) {
    if (!this.nearbyOnly && !this.performanceMode) return super.update(delta)
    if (!this.timelineState.initialLayoutFinished) return
    LyricPlayerBase.prototype.update.call(this, delta)
    if (!this.supportMaskImage) this.getElement().style.setProperty('--amll-player-time', `${this.getCurrentTime()}`)
    if (!this.isPageVisible) return
    const anchor = this.timelineState.scrollToIndex
    for (const [index, line] of this.currentLyricLineObjects.entries()) {
      const nearby = Math.abs(index - anchor) <= 3
      const visible = line.isInSight
      const height = this.lyricLinesSize.get(line)?.[1] || 0
      const entering = line.top <= this.size[1] + height && line.top + height >= -height
      // Animate lines entering/leaving the viewport, including manual scrolling.
      // Snap distant springs so a rapid sequence does not animate every lyric.
      if (!this.nearbyOnly || nearby || visible || entering) {
        line.update(delta / 1000)
      } else {
        line.lineTransforms.posY.setPosition(line.top)
        line.lineTransforms.scale.setPosition(line.scale)
        if (line.getElement().isConnected) line.hide()
      }
      if (this.performanceMode && this.timelineState.hotLines.has(index)) {
        // Sample active word animations on the same capped clock as the springs.
        // Finished lines retain AMLL's brief release animation before going static.
        const relativeTime = Math.max(0, this.getCurrentTime() - line.getLine().startTime)
        // Read AMLL 0.5's existing animation references directly. getAnimations()
        // forces style resolution, and masks are replaced when layout changes.
        for (const word of line.splittedWords || []) {
          for (const animation of word.maskAnimations) this.sampleWordAnimation(animation, relativeTime)
        }
      }
    }
  }
}
