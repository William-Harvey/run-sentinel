import type { Register } from 'claude-code'

// run-sentinel: a watchdog the orchestrating session arms over a long run's log file. One timer started at session.start ticks every
// `intervalSeconds`; each tick reads the new bytes of every armed log, reports lines matching `report` (completions, failures), and when a
// line matches `killOn` it terminates the run's process group (never a silent abandon) and says so. A metric command (any shell command that
// prints a number, e.g. a provider-call count) is run each tick and its delta per tick is reported, so cost rate is visible without the log.
// Defaults per project: <cwd>/.claude/run-sentinel.json = { "report": "regex", "killOn": "regex", "metric": "shell command", "pgid": null }
//   /sentinel start <log> [--kill-on <regex>] [--report <regex>] [--metric "<cmd>"] [--pgid <n>]
//   /sentinel status · /sentinel stop [<log>]

type Watch = { log: string; offset: number; report: RegExp; killOn?: RegExp; metric?: string; lastMetric?: number; pgid?: number; events: number; startedAt: number }

const watches = new Map<string, Watch>()
let cwd = ''
let cancel: (() => void) | undefined

function parseArgs(s: string) {
  const out: Record<string, string> = {}; const rest: string[] = []
  const toks = s.match(/"[^"]*"|\S+/g) ?? []
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t.startsWith('--')) { out[t.slice(2)] = (toks[i + 1] ?? '').replace(/^"|"$/g, ''); i++ } else rest.push(t)
  }
  return { out, rest }
}

async function tick($: any) {
  for (const w of watches.values()) {
    try {
      const text: string = await $.fs.read(w.log)
      const fresh = text.slice(w.offset)
      w.offset = text.length
      const hits = fresh.split('\n').filter(l => w.report.test(l))
      for (const l of hits) { w.events++; $.ui.log(`sentinel ${w.log.split('/').pop()}: ${l.slice(0, 200)}`) }
      const kill = w.killOn ? fresh.split('\n').find(l => w.killOn!.test(l)) : undefined
      if (kill) {
        let msg = `sentinel: kill pattern matched on ${w.log}: ${kill.slice(0, 160)}`
        if (w.pgid) { const r = await $.process.run(['kill', '-TERM', `-${w.pgid}`]); msg += r.exitCode === 0 ? ` → process group ${w.pgid} terminated` : ` → kill failed: ${r.stderr.trim()}` }
        else msg += ' → no --pgid given, nothing killed (stop the run yourself)'
        $.ui.notify(msg); watches.delete(w.log)
        continue
      }
      if (w.metric) {
        const r = await $.process.run(['sh', '-c', w.metric], { cwd })
        const n = Number((r.stdout.trim().match(/-?\d+(\.\d+)?/) ?? ['NaN'])[0])
        if (!Number.isNaN(n)) { const d = w.lastMetric === undefined ? 0 : n - w.lastMetric; w.lastMetric = n; $.ui.status(`sentinel ${w.log.split('/').pop()}: metric ${n} (+${d}/tick), ${w.events} events`) }
      }
    } catch (err) { $.ui.log(`sentinel: ${w.log} unreadable this tick (${String(err)})`) }
  }
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    const ms = Number((options as any)?.intervalSeconds ?? 300) * 1000
    cancel?.(); const t = $.clock.every(ms, () => { void tick($) }); cancel = () => t.cancel()
    await $.command.register({ name: 'sentinel', description: 'Watch a run log: report matches, kill the process group on a kill pattern, report a metric rate.', argumentHint: 'start <log> [--kill-on re] [--report re] [--metric "cmd"] [--pgid n] | status | stop [log]' })
    return next(e)
  })

  on('command.run', { command: 'sentinel' }, async ($, e) => {
    const { out, rest } = parseArgs(e.args)
    const [verb, logArg] = rest
    if (verb === 'status') return { text: watches.size ? [...watches.values()].map(w => `${w.log}: ${w.events} events, offset ${w.offset}, metric ${w.lastMetric ?? '-'}, since ${new Date(w.startedAt).toISOString()}`).join('\n') : 'no watches armed' }
    if (verb === 'stop') { if (logArg) watches.delete(logArg.startsWith('/') ? logArg : `${cwd}/${logArg}`); else watches.clear(); return { text: `stopped; ${watches.size} watch(es) remain` } }
    if (verb !== 'start' || !logArg) return { text: 'usage: /sentinel start <log> [--kill-on re] [--report re] [--metric "cmd"] [--pgid n] | status | stop [log]' }
    let defaults: any = {}
    try { const p = `${cwd}/.claude/run-sentinel.json`; if (await $.fs.exists(p)) defaults = JSON.parse(await $.fs.read(p)) } catch { defaults = {} }
    const log = logArg.startsWith('/') ? logArg : `${cwd}/${logArg}`
    const w: Watch = {
      log, offset: 0, events: 0, startedAt: Date.now(),
      report: new RegExp(out.report ?? defaults.report ?? 'Traceback|Error|FAILED|timeout|RUN_DONE|"outcome"'),
      killOn: (out['kill-on'] ?? defaults.killOn) ? new RegExp(out['kill-on'] ?? defaults.killOn) : undefined,
      metric: out.metric ?? defaults.metric, pgid: Number(out.pgid ?? defaults.pgid) || undefined,
    }
    try { w.offset = (await $.fs.read(log)).length } catch { w.offset = 0 }
    watches.set(log, w)
    return { text: `armed ${log}: report /${w.report.source}/, kill-on ${w.killOn ? '/' + w.killOn.source + '/' : 'none'}, metric ${w.metric ? `"${w.metric}"` : 'none'}, pgid ${w.pgid ?? 'none'}, every ${(options as any)?.intervalSeconds ?? 300}s (only lines written from now on are reported)` }
  })
}
