import { replaylock } from "replaylock/vite";

export default {
  plugins: [replaylock()],
  test: {
    globals: true,
    include: ["test/**/*.test.ts"],
  },
};
