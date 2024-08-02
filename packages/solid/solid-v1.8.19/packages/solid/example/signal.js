import "../dist/dev.js";
import { createSignal } from "../dist/solid.js";

console.log("Signal", createSignal);
debugger;
const [track, trigger] = createSignal(0);
console.log(track());
