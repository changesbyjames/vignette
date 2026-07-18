import { frame } from "@strangecyan/vignette-frame";

const params = { parse: (input: unknown) => input as object };
const view = () => null;

export const two = frame({ params, view });
