import { cp } from "node:fs/promises";
await cp(
  new URL("./app/", import.meta.url),
  new URL("./dist/", import.meta.url),
  { recursive: true },
);
