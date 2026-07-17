import { frame } from "@cbj/vignette-frame";

const params = { parse: (input: unknown) => input as object };
const view = () => null;

export const one = frame({ params, view });
