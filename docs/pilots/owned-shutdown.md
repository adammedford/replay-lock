# Launched development-server shutdown

The pinned Epic Stack pilot completed its workflows and recorded seven unsupported-value blocks, but its detached `npm run dev` process group survived after the recording probe sent SIGTERM to the recording controller. The probe treated the controller's open output pipes as a reason to keep waiting. The application had inherited those pipes, so waiting for them to close could not substitute for waiting for the controller to finish its owned-process cleanup. The prior local pilot required manual termination of the npm group.

A public-CLI integration fixture reproduces the ownership path: `record -- npm run dev`, followed by an authenticated stop. It checks that the controller exits, the application port closes, discovery metadata disappears, and inherited output pipes close. The controller now waits for its launched command to exit after requesting termination, removes only the matching launch manifest, and leaves attached servers alone. The pilot waits for the controller to complete before attempting a fallback signal and records controller exit, pipe closure, discovery cleanup, and whether the probe itself signaled the controller.

A fresh synthetic Epic probe completed all four application workflows with zero candidates and seven recording blocks, as expected from the timer's function-valued result. Its cleanup record reported `controllerExited: true`, `outputPipesClosed: true`, `discoveryRemoved: true`, and `signaledByProbe: false`. That run remains a blocked characterization pilot because it produced no candidates. The historical packed pilot evidence is unchanged.

Interrupted startup, unresponsive descendants, idempotent overlapping shutdown, and cross-platform cleanup limits are tracked separately in ticket #67.
