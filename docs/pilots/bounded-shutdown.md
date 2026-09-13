# Bounded launched-process cleanup

The public recording command now keeps its signal handler active through owned-process cleanup. If startup is interrupted before a development listener appears, the command reports `SESSION_INTERRUPTED`. The launched command's process group receives SIGTERM and has ten seconds to exit. On supported POSIX hosts, an unresponsive group then receives SIGKILL and has five more seconds to clear. The command reports `PROCESS_CLEANUP_FAILED` if it still cannot confirm exit. Attachment has no owned process group and never uses this cleanup path.

A deterministic integration fixture starts a child that deliberately ignores SIGTERM and never publishes a Vite listener. It sends repeated SIGTERM to the controller, verifies that the child is gone after the bounded escalation, and checks that an unrelated loopback listener still responds. The normal npm-launched stop fixture separately verifies port and discovery cleanup, output-pipe closure, and preserved reviewable observations. Windows direct-child termination remains a distinct supported-platform behavior; POSIX process-group evidence does not imply Windows descendant-tree cleanup.

The controlled fixture proves the interruption path; it does not convert the zero-candidate Epic Stack pilot into a successful characterization journey.
