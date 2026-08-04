import type { Quests, Quest, DailyChallenge, Objective } from '../game/quests'
import { Input } from '../core/input'
import { formatCoins } from './format'
import { coinIconHtml, iconHtml } from './icons'
import { backdropClickSwallowed } from '../core/click-guard'

/** Swap coin emoji in quest copy for the painted glyph. */
function withCoinIcon(text: string) {
  return text.replaceAll('🪙', coinIconHtml('inline-ico'))
}

/**
 * Quest journal plus the always-on tracker in the corner.
 *
 * The tracker shows only the active chain quest and any daily that is ready
 * to claim, because a permanent list of six objectives becomes wallpaper. The
 * full journal is one key away for players who want it.
 */

export interface QuestCallbacks {
  claimQuest(quest: Quest): void
  claimDaily(daily: DailyChallenge): void
}

export class QuestUi {
  private readonly root: HTMLDivElement
  private readonly body: HTMLDivElement
  private readonly tracker: HTMLDivElement

  open = false

  constructor(
    private readonly quests: Quests,
    private readonly callbacks: QuestCallbacks,
  ) {
    const ui = document.getElementById('ui')!

    this.tracker = document.createElement('div')
    this.tracker.id = 'questTracker'
    // Hidden with the rest of the HUD while a full-screen panel is up.
    this.tracker.className = 'hud-chrome'
    ui.appendChild(this.tracker)

    this.root = document.createElement('div')
    this.root.id = 'questJournal'
    this.root.className = 'hidden'
    this.root.innerHTML = `
      <div class="panel">
        <header><h2>${iconHtml('journal', '📜', 'title-ico')} Journal</h2><button id="questClose">✕</button></header>
        <div id="questBody"></div>
      </div>`
    ui.appendChild(this.root)

    this.body = this.root.querySelector('#questBody')!
    this.root.querySelector('#questClose')!.addEventListener('click', () => this.close())
    this.root.addEventListener('click', (e) => {
      // Not the tail of the tap that opened this — see click-guard.
      if (e.target === this.root && !backdropClickSwallowed()) this.close()
    })

    quests.onChange(() => this.refresh())
    this.refresh()
  }

  toggle() {
    this.open ? this.close() : this.show()
  }

  show() {
    this.open = true
    this.root.classList.remove('hidden')
    Input.clear()
    this.renderJournal()
  }

  close() {
    this.open = false
    this.root.classList.add('hidden')
    Input.clear()
  }

  refresh() {
    this.renderTracker()
    if (this.open) this.renderJournal()
  }

  private objectiveRow(objective: Objective, progress: number) {
    const done = progress >= objective.target
    const pct = Math.min(100, (progress / objective.target) * 100)
    return `
      <div class="obj${done ? ' done' : ''}">
        <div class="obj-bar"><div class="obj-fill" style="width:${pct}%"></div></div>
        <span class="obj-label">${done ? '✓' : ''} ${withCoinIcon(objective.label)}</span>
        <span class="obj-count">${formatCoins(Math.min(progress, objective.target))}/${formatCoins(objective.target)}</span>
      </div>`
  }

  private renderTracker() {
    const quest = this.quests.current
    const claimable = this.quests.claimableDailies()

    if (!quest && claimable.length === 0) {
      this.tracker.innerHTML = this.quests.allComplete
        ? `<div class="tracker-card"><div class="tracker-title">${iconHtml('journal', '📜', 'tracker-ico')} All quests complete</div></div>`
        : ''
      return
    }

    let html = ''

    if (quest) {
      const complete = this.quests.isCurrentComplete()
      html += `
        <div class="tracker-card${complete ? ' ready' : ''}">
          <div class="tracker-title">${iconHtml('journal', '📜', 'tracker-ico')} ${quest.name}</div>
          ${quest.objectives.map((o) => this.objectiveRow(o, this.quests.progressOf(o))).join('')}
          ${complete ? `<button class="claim" data-claim="quest">Claim</button>` : ''}
        </div>`
    }

    for (const daily of claimable) {
      html += `
        <div class="tracker-card ready">
          <div class="tracker-title">⭐ Daily complete</div>
          <div class="obj done"><span class="obj-label">✓ ${withCoinIcon(daily.objective.label)}</span></div>
          <button class="claim" data-claim="daily" data-id="${daily.id}">Claim</button>
        </div>`
    }

    this.tracker.innerHTML = html
    this.bindClaims(this.tracker)
  }

  private renderJournal() {
    const quest = this.quests.current
    let html = ''

    html += `<h3 class="journal-heading">Current quest</h3>`
    if (quest) {
      const complete = this.quests.isCurrentComplete()
      html += `
        <div class="journal-card${complete ? ' ready' : ''}">
          <div class="journal-name">${quest.name}</div>
          <div class="journal-blurb">${quest.blurb}</div>
          ${quest.objectives.map((o) => this.objectiveRow(o, this.quests.progressOf(o))).join('')}
          <div class="journal-reward">Reward: ${coinIconHtml('inline-ico')}${formatCoins(quest.reward.coins)} · ${quest.reward.xp} XP${
            quest.reward.seeds ? ` · ${quest.reward.seeds.map((s) => `${s.qty}× ${s.id}`).join(', ')}` : ''
          }</div>
          ${complete ? `<button class="claim" data-claim="quest">Claim</button>` : ''}
        </div>`
    } else {
      html += `<div class="empty-msg">Every quest is done. The valley is yours. 🌾</div>`
    }

    html += `<h3 class="journal-heading">Today's challenges</h3>`
    if (this.quests.dailies.length === 0) {
      html += `<div class="empty-msg">New challenges at dawn.</div>`
    } else {
      for (const daily of this.quests.dailies) {
        const done = daily.progress >= daily.objective.target
        html += `
          <div class="journal-card${daily.claimed ? ' claimed' : done ? ' ready' : ''}">
            ${this.objectiveRow(daily.objective, daily.progress)}
            <div class="journal-reward">${coinIconHtml('inline-ico')}${formatCoins(daily.reward.coins)} · ${daily.reward.xp} XP</div>
            ${
              daily.claimed
                ? `<div class="journal-blurb">Claimed ✓</div>`
                : done
                  ? `<button class="claim" data-claim="daily" data-id="${daily.id}">Claim</button>`
                  : ''
            }
          </div>`
        }
    }

    this.body.innerHTML = html
    this.bindClaims(this.body)
  }

  private bindClaims(root: HTMLElement) {
    for (const btn of root.querySelectorAll<HTMLButtonElement>('.claim')) {
      btn.addEventListener('click', () => {
        if (btn.dataset.claim === 'quest') {
          const quest = this.quests.current
          if (quest && this.quests.isCurrentComplete()) this.callbacks.claimQuest(quest)
        } else {
          const daily = this.quests.dailies.find((d) => d.id === btn.dataset.id)
          if (daily) this.callbacks.claimDaily(daily)
        }
        this.refresh()
      })
    }
  }
}
