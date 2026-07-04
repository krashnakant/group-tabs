import assert from "node:assert";
import { byDomain } from "./grouping.js";

const tabs = [
  { id: 1, url: "https://github.com/foo" },
  { id: 2, url: "https://www.github.com/bar" },
  { id: 3, url: "https://gist.github.com/baz" },
  { id: 4, url: "https://news.ycombinator.com/" },
  { id: 5, url: "chrome://settings" },
  { id: 6, url: "not a url" },
];

const g = byDomain(tabs);
assert.deepStrictEqual(g.github, [1, 2, 3], "github tabs incl. www + subdomain");
assert.deepStrictEqual(g.ycombinator, [4]);
assert.ok(!Object.values(g).flat().includes(6), "invalid url skipped");

console.log("ok");
