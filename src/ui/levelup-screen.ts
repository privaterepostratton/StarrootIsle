import { Input } from '../core/input'
import { coinIconHtml, iconHtml } from './icons'

/**
 * Full-screen level-up celebration.
 *
 * A toast is the wrong shape for this moment. Levelling is the game's biggest
 * scheduled payoff — it unlocks seeds, hands out plots and coins — and burying
 * that in a corner notification wastes it. This takes over the screen, reveals
 * each reward on a stagger so they land one at a time, and waits for the
 * player to dismiss it.
 *
 * Queued rather than replaced: a single huge harvest can cross two thresholds,
 * and the second level-up must not stomp the first mid-animation.
 */

export interface LevelUpReward {
  /** Content icon id (`carrot`, `sprout`, `plot`…) or `'coin'` for the coin asset. */
  iconId?: string
  emoji: string
  label: string
}

interface QueuedLevel {
  level: number
  headline: string
  rewards: LevelUpReward[]
}

function rewardIconHtml(reward: LevelUpReward): string {
  if (reward.iconId === 'coin') return coinIconHtml('lvl-reward-ico')
  if (reward.iconId) return iconHtml(reward.iconId, reward.emoji, 'lvl-reward-ico')
  return reward.emoji
}

export class LevelUpScreen {
  private readonly root: HTMLDivElement
  private readonly queue: QueuedLevel[] = []
  private showing = false

  /** Fired when the screen closes and nothing is left queued. */
  onDismissed: (() => void) | null = null

  constructor() {
    this.root = document.createElement('div')
    this.root.id = 'levelUpScreen'
    this.root.className = 'hidden'
    document.getElementById('ui')!.appendChild(this.root)
  }

  get open() {
    return this.showing
  }

  /** Queue a level-up. Shows immediately if nothing else is on screen. */
  show(level: number, headline: string, rewards: LevelUpReward[]) {
    this.queue.push({ level, headline, rewards })
    if (!this.showing) this.next()
  }

  private next() {
    const entry = this.queue.shift()
    if (!entry) {
      this.showing = false
      this.root.classList.add('hidden')
      this.root.innerHTML = ''
      this.onDismissed?.()
      return
    }

    this.showing = true
    Input.clear()

    // Confetti is generated rather than authored so the burst differs each
    // time — a fixed pattern becomes visibly repetitive by level three.
    const confetti = Array.from({ length: 34 }, (_, i) => {
      const left = Math.random() * 100
      const delay = Math.random() * 0.5
      const duration = 1.6 + Math.random() * 1.4
      const hue = [
        '#f2c14e', '#6fbf4a', '#e05c4a', '#5c9ce0', '#e8459b', '#a06ff2',
      ][i % 6]
      const size = 7 + Math.random() * 9
      const spin = Math.random() > 0.5 ? 'confettiSpinA' : 'confettiSpinB'
      return `<span class="confetti" style="
        left:${left}%;
        background:${hue};
        width:${size}px;
        height:${size * (0.4 + Math.random() * 0.8)}px;
        animation-delay:${delay}s;
        animation-duration:${duration}s, ${duration}s;
        animation-name:confettiFall, ${spin};
      "></span>`
    }).join('')

    this.root.innerHTML = `
      <div class="lvl-confetti">${confetti}</div>
      <div class="lvl-card">
        <div class="lvl-rays"></div>
        <div class="lvl-eyebrow">Level up!</div>
        <div class="lvl-badge"><span>${entry.level}</span></div>
        <div class="lvl-headline">${entry.headline}</div>
        <div class="lvl-rewards">
          ${entry.rewards
            .map(
              (r, i) => `
            <div class="lvl-reward" style="animation-delay:${0.35 + i * 0.13}s">
              <span class="lvl-reward-emoji">${rewardIconHtml(r)}</span>
              <span class="lvl-reward-label">${r.label}</span>
            </div>`,
            )
            .join('')}
        </div>
        <button class="lvl-continue">Continue</button>
      </div>`

    this.root.classList.remove('hidden')

    const dismiss = () => {
      // Guard against the click and the keypress both firing.
      if (!this.showing) return
      this.root.querySelector('.lvl-card')?.classList.add('leaving')
      window.setTimeout(() => this.next(), 180)
    }

    this.root.querySelector('.lvl-continue')!.addEventListener('click', dismiss)
    // Clicking the backdrop dismisses too — nobody should feel trapped here.
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) dismiss()
    })
  }

  /** Let Enter/Escape/Space close it from the main input loop. */
  dismissFromKey() {
    if (!this.showing) return false
    const btn = this.root.querySelector('.lvl-continue') as HTMLButtonElement | null
    btn?.click()
    return true
  }
}
