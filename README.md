# Run Sentinel

A Claude Code plugin that watches a long run's log on a fixed interval, reports completions and failures, kills the run's process group when a timeout or failure pattern appears, and reports the rate of any metric command (for example a provider-call count) each tick.

## Why I built it

During a paid evaluation run, a driver timed out on one question after 30 minutes and started the next question on the same server, which was still processing the abandoned request. Monitoring went quiet, cost attribution became unreliable, and the overlap was only noticed by querying the provider telemetry by hand. The owner's rule for such runs was a five-minute check with a stop on the first decisive failure. This plugin is that rule as code: one timer, a log watch, a kill on a pattern, and the cost rate on the status line.

## What it does

- `/sentinel start <log> [--kill-on <regex>] [--report <regex>] [--metric "<cmd>"] [--pgid <n>]` arms a watch. Only lines written after arming are considered.
- Each tick (default 300 s): new log lines matching `report` are logged to the session; a line matching `kill-on` terminates process group `pgid` with SIGTERM and notifies (with no `pgid` it notifies and asks you to stop the run yourself); the metric command's number and its delta per tick go to the status line.
- `/sentinel status`, `/sentinel stop [<log>]`.

## Setup

Optional defaults in `.claude/run-sentinel.json`:

```json
{
  "report": "Traceback|Error|FAILED|\"outcome\"|RUN_DONE",
  "killOn": "\"outcome\": \"timeout\"",
  "metric": "docker exec db psql -U postgres -At -c \"select count(*) from llm_call_telemetry\""
}
```

The interval is set in the plugin's config menu (`intervalSeconds`). Start the run in its own process group (for example `setsid` or a subshell) and pass its id as `--pgid` so the kill reaches the server and the driver together.

## Why I'm sharing it

Long paid runs under an agent's supervision need a watchdog that is not the agent's attention: a fixed interval, a hard stop on a failure pattern, and a cost rate on the status line. I needed it the night a timed-out request kept a server busy under the next question. The log patterns, the kill rule and the metric command are yours to set; the plugin only keeps time and acts on what you declared.

## How to load it into a project

1. Install once, at the user scope, from a terminal session: `/plugin install run-sentinel --marketplace William-Harvey/run-sentinel` (answer `y` to add the marketplace, then pick the scope). From a shell: `claude plugin install run-sentinel --marketplace William-Harvey/run-sentinel`. In the desktop app: click + next to the prompt box, Plugins, Add marketplace `William-Harvey/run-sentinel`, then Add plugin.
2. Add the project's config file described under Setup (`.claude/run-sentinel.json`), committed with the project so every session and subagent sees the same values.
3. Start a session in the project; the plugin's commands appear in `/` and its hooks are active for the session and every subagent it launches.
4. To try it without installing: `claude --plugin-dir <path to this folder>`.

## Install

```
/plugin install run-sentinel --marketplace William-Harvey/run-sentinel
```

From a shell: `claude plugin install run-sentinel --marketplace William-Harvey/run-sentinel`. Desktop app: + next to the prompt box, Plugins, Add marketplace `William-Harvey/run-sentinel`, Add plugin. Development: `claude --plugin-dir <this folder>`.

## Notes

The timer is created at session start and survives individual commands; a plugin reload drops the armed watches (arm them again). Reading a very large log every tick is linear in its size; rotate logs for multi-day runs.
