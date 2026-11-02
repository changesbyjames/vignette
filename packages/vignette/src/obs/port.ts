import { createServer } from "node:net";
import { z } from "zod";

/** The address of a listening TCP server. */
const ListeningAddressSchema = z.object({ port: z.number() });
/** The address of a listening TCP server. */
type ListeningAddress = z.output<typeof ListeningAddressSchema>;

function listeningAddress(
  address: ReturnType<ReturnType<typeof createServer>["address"]>,
): ListeningAddress | undefined {
  return ListeningAddressSchema.safeParse(address).data;
}

/** A free local TCP port: the one the OS assigns to a listener on port 0, released at once. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = listeningAddress(server.address())?.port;
      server.close(() => {
        if (port === undefined) reject(new Error("No local port was assigned."));
        else resolve(port);
      });
    });
  });
}
