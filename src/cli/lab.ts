import { runCli } from "./commands.js";

const code = await runCli(process.argv.slice(2), {
  out: (text) => console.log(text),
  err: (text) => console.error(text),
});
process.exitCode = code;
