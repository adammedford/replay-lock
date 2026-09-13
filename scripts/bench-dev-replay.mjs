// Imported by every replay child through NODE_OPTIONS to measure descendant peaks.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
if(process.env.REPLAYLOCK_BENCH_MEMORY_DIR)process.on('exit',()=>{
  try{writeFileSync(path.join(process.env.REPLAYLOCK_BENCH_MEMORY_DIR,`${process.pid}.json`),JSON.stringify({pid:process.pid,peakKiB:process.resourceUsage().maxRSS}));}catch{}
});
