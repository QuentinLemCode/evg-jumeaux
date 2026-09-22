#!/usr/bin/env bash
# Puts the agent toolchain on PATH. Sourced, never executed.
#
# The installers put these where only an interactive login shell looks:
# opencode lands in ~/.opencode/bin. So anything started by systemd — the
# gateway, the error watcher, every pipeline they launch — found no agent at
# all while the binary sat on disk, and failed in whatever way that particular
# caller happened to fail. The watcher's way was to report
# "diagnostic automatique indisponible" for weeks.
#
# One definition, sourced by lib.sh and by the scripts that deliberately do not
# use lib.sh. Two copies of this is how one of them gets fixed and the other
# does not.
for _agent_bin in "$HOME/.opencode/bin" "$HOME/.local/bin"; do
  case ":$PATH:" in
    *":$_agent_bin:"*) ;;
    *) [ -d "$_agent_bin" ] && PATH="$_agent_bin:$PATH" ;;
  esac
done
unset _agent_bin
export PATH
