import { createSignal, createEffect } from "../dist/solid.js";

const [s, set] = createSignal("start");

createEffect(() => console.log("something", s()));

set("end"); // "something"

console.log('-----------------')

set("final");
