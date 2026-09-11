import type { Plugin } from "vite";
import { handleApiRequest } from "./api-handler";
import type { IncomingMessage, ServerResponse } from "node:http";

export function apiDevPlugin(): Plugin {
  return {
    name: "smarta-api-dev-server",
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const urlString = req.url || "";
        if (!urlString.startsWith("/api/") && !urlString.startsWith("/uploads/")) {
          return next();
        }

        try {
          const host = req.headers.host || "localhost:8080";
          const protocol = "http";
          const fullUrl = new URL(urlString, `${protocol}://${host}`);

          // Read body if method has body
          let body: Buffer | null = null;
          if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method || "")) {
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
              chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
            }
            body = Buffer.concat(chunks);
          }

          // Build web Request headers
          const headers = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (value !== undefined) {
              if (Array.isArray(value)) {
                for (const v of value) headers.append(key, v);
              } else {
                headers.set(key, value);
              }
            }
          }

          const webRequest = new Request(fullUrl.toString(), {
            method: req.method,
            headers,
            body: body && body.length > 0 ? (body as any) : null,
            // @ts-ignore
            duplex: "half",
          });

          const webResponse = await handleApiRequest(webRequest);
          if (!webResponse) {
            return next();
          }

          // Write web Response to Node ServerResponse
          res.statusCode = webResponse.status;
          webResponse.headers.forEach((val, key) => {
            res.setHeader(key, val);
          });

          const resBuffer = Buffer.from(await webResponse.arrayBuffer());
          res.end(resBuffer);
        } catch (err: any) {
          console.error("Vite API Middleware error:", err);
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Internal Server Error", message: err.message }));
        }
      });
    },
  };
}
