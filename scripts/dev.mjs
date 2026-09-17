import "dotenv/config";
import { spawn } from "node:child_process";

const services = [
  ["api", "npm", ["run", "dev:api"]],
  ["proxy", "npm", ["run", "dev:proxy"]],
  ["web", "npm", ["run", "dev:web"]]
];
const children = services.map(([name, command, args]) => {
  const child = spawn(command, args, { stdio: "inherit", env: process.env });
  child.on("error", (error) => console.error(`${name}: ${error.message}`));
  child.on("exit", (code) => { if (code && code !== 0) console.error(`${name} exited with code ${code}`); });
  return child;
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { for (const child of children) child.kill(signal); });
